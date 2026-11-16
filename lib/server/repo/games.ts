import type { FeedbackRow } from "@/lib/game/feedback";
import { PAST_GAMES_LIMIT, toPastGame, type PastGameRow, type PastGamesResult } from "@/lib/game/pastGames";
import { toDraft, type Draft, type DraftFields, type DraftRow } from "@/lib/game/drafts";
import { query, withTransaction } from "../db";

// Games and their feedback, always scoped to their owner (API-1). Counts and
// codes only: nothing here says who was spotted.

export type StartedGame = {
  id: string;
  home_roster_id: string;
  away_roster_id: string;
  home_school: string;
  away_school: string;
  sport: string | null;
  stats_enabled: boolean;
};

export type EndedGame = {
  ended_at: string;
  mic_seconds: number;
  reconnects: number;
  cards_shown: number;
  cards_removed: number;
  stat_plays_added: number;
  stat_plays_undone: number;
  /** Booth partners (Nov 15): cards the partner's mic put up here, and events that were one card. Absent from an older browser. */
  remote_cards_shown?: number;
  deduped_cards?: number;
};

/**
 * Records a game. The id is made in the browser so the browser log has a game
 * to belong to; on conflict nothing is overwritten. The composite foreign keys
 * refuse a roster id that is not this owner's (Postgres 23503).
 */
export async function insertGame(ownerId: string, game: StartedGame): Promise<boolean> {
  return withTransaction(async (client) => {
    const rows = await query(
      `insert into called_games (id, owner_id, status, home_roster_id, away_roster_id, home_school, away_school, sport, stats_enabled)
       values ($1, $2, 'live', $3, $4, $5, $6, $7, $8)
       on conflict (id) do nothing
       returning id`,
      [game.id, ownerId, game.home_roster_id, game.away_roster_id, game.home_school, game.away_school, game.sport, game.stats_enabled],
      client,
    );
    // Booth partners (Nov 15): saved partners join every new game, up to two.
    if (rows.length > 0) await query("select public.booth_auto_add($1, $2)", [ownerId, game.id], client);
    return rows.length > 0;
  });
}

/** Writes End game's counts. False when the game is not this account's. */
export async function endGame(ownerId: string, id: string, ended: EndedGame): Promise<boolean> {
  const rows = await query(
    `update called_games
        set status = 'ended', ended_at = $3, mic_seconds = $4, reconnects = $5, cards_shown = $6, cards_removed = $7,
            stat_plays_added = $8, stat_plays_undone = $9, remote_cards_shown = $10, deduped_cards = $11
      where id = $1 and owner_id = $2 and status <> 'draft'
      returning id`,
    [
      id,
      ownerId,
      ended.ended_at,
      ended.mic_seconds,
      ended.reconnects,
      ended.cards_shown,
      ended.cards_removed,
      ended.stat_plays_added,
      ended.stat_plays_undone,
      ended.remote_cards_shown ?? 0,
      ended.deduped_cards ?? 0,
    ],
  );
  return rows.length > 0;
}

/** Deletes a game and, by cascade, its feedback. False when it is not this account's, or is a draft (deleteDraft). */
export async function deleteGame(ownerId: string, id: string): Promise<boolean> {
  const rows = await query("delete from called_games where id = $1 and owner_id = $2 and status <> 'draft' returning id", [id, ownerId]);
  return rows.length > 0;
}

/**
 * Saves or replaces this game's feedback: the game id is the key, so pressing
 * Save twice is still one row. False when the game is not this account's.
 */
export async function saveFeedback(ownerId: string, row: FeedbackRow): Promise<boolean> {
  const rows = await query(
    `insert into game_feedback (game_id, owner_id, rating, blockers, note)
     select $1, $2, $3, $4::text[], $5
      where exists (select 1 from called_games where id = $1 and owner_id = $2 and status <> 'draft')
     on conflict (game_id) do update
       set rating = excluded.rating, blockers = excluded.blockers, note = excluded.note
       where game_feedback.owner_id = excluded.owner_id
     returning game_id`,
    [row.game_id, ownerId, row.rating, row.blockers, row.note],
  );
  return rows.length > 0;
}

/**
 * The account's games, newest first. A failed read is a different answer from
 * no games, so the page can say so instead of showing an empty list.
 */
export async function listPastGames(ownerId: string): Promise<PastGamesResult> {
  try {
    const rows = await query<Omit<PastGameRow, "started_at" | "ended_at"> & { started_at: Date; ended_at: Date | null }>(
      `select g.id, g.home_school, g.away_school, g.sport, g.stats_enabled, g.started_at, g.ended_at,
              g.mic_seconds, g.reconnects, g.cards_shown, g.cards_removed, g.stat_plays_added, g.stat_plays_undone,
              case when f.rating is null then null else json_build_object('rating', f.rating) end as game_feedback,
              coalesce(nullif(bu.name, ''), bu.email) as hosted_by
         from called_games g
         left join game_feedback f on f.game_id = g.id
         left join booth_members bm on bm.guest_game_id = g.id and bm.guest_id = g.owner_id
         left join users bu on bu.id = bm.host_id
        where g.owner_id = $1 and g.status <> 'draft'
        order by g.started_at desc
        limit $2`,
      [ownerId, PAST_GAMES_LIMIT],
    );
    return {
      ok: true,
      games: rows.map((row) =>
        toPastGame({ ...row, started_at: row.started_at.toISOString(), ended_at: row.ended_at?.toISOString() ?? null }),
      ),
    };
  } catch {
    return { ok: false };
  }
}

// =============================================================================
// Draft games (Nov 3; db/migrations/0025_draft_games.sql): a called_games row
// with status 'draft'. Every function takes the owner first and filters by
// it, and touches only drafts. A roster id that is not this owner's is refused
// by the composite foreign keys (23503, a 404 through forUser).
// =============================================================================

// A guest's booth draft (Nov 15) reads its date, sport and schools from the
// host's game while he is an active guest of it, so a change the host makes
// shows here; its own roster ids are always null.
const DRAFT_COLUMNS = `g.id, coalesce(bh.game_date, g.game_date)::text as game_date, coalesce(bh.sport, g.sport) as sport,
       coalesce(bh.home_roster_id, g.home_roster_id) as home_roster_id, coalesce(bh.away_roster_id, g.away_roster_id) as away_roster_id,
       coalesce(bhr.school, h.school) as home_school, coalesce(bar.school, a.school) as away_school,
       g.wearing_home, g.wearing_away, g.share_log, g.status = 'live' as partner_started,
       case when bm.host_game_id is null then null
            else json_build_object('gameId', bm.host_game_id, 'hostLabel', coalesce(nullif(bu.name, ''), bu.email), 'hostLive', bh.status = 'live')
       end as booth`;
const DRAFT_FROM = `from called_games g
  left join rosters h on h.id = g.home_roster_id and h.owner_id = g.owner_id
  left join rosters a on a.id = g.away_roster_id and a.owner_id = g.owner_id
  left join booth_members bm on bm.guest_game_id = g.id and bm.guest_id = g.owner_id and bm.state = 'active'
  left join called_games bh on bh.id = bm.host_game_id and bh.owner_id = bm.host_id and bh.status in ('draft', 'live')
  left join users bu on bu.id = bm.host_id
  left join rosters bhr on bhr.id = bh.home_roster_id and bhr.owner_id = bh.owner_id
  left join rosters bar on bar.id = bh.away_roster_id and bar.owner_id = bh.owner_id`;

/**
 * A draft, or (Nov 15) a host's game his booth partner already started, which
 * stays in his upcoming games until his own Start joins it.
 */
const STARTABLE = "(g.status = 'draft' or (g.status = 'live' and g.started_by_guest and not g.booth_guest))";

export type DraftsResult = { ok: true; drafts: Draft[] } | { ok: false };

/** The account's drafts, soonest first. A failed read is a different answer from none. */
export async function listDrafts(ownerId: string): Promise<DraftsResult> {
  try {
    const rows = await query<DraftRow>(
      `select ${DRAFT_COLUMNS} ${DRAFT_FROM}
        where g.owner_id = $1 and ${STARTABLE}
        order by g.game_date asc, g.id asc`,
      [ownerId],
    );
    return { ok: true, drafts: rows.map(toDraft) };
  } catch {
    return { ok: false };
  }
}

/** One of the account's drafts, or null when it is not a draft of this account. */
export async function getDraft(ownerId: string, id: string): Promise<Draft | null> {
  const rows = await query<DraftRow>(
    `select ${DRAFT_COLUMNS} ${DRAFT_FROM}
      where g.id = $1 and g.owner_id = $2 and ${STARTABLE} and not g.booth_guest`,
    [id, ownerId],
  );
  return rows[0] ? toDraft(rows[0]) : null;
}

/** A new draft; the database makes its id. A draft starts with no time, no schools and no counts. */
export async function insertDraft(ownerId: string, draft: DraftFields & { game_date: string }): Promise<string> {
  return withTransaction(async (client) => {
    const rows = await query<{ id: string }>(
      `insert into called_games (owner_id, status, started_at, game_date, sport, home_roster_id, away_roster_id, wearing_home, wearing_away, share_log)
       values ($1, 'draft', null, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        ownerId,
        draft.game_date,
        draft.sport ?? null,
        draft.home_roster_id ?? null,
        draft.away_roster_id ?? null,
        draft.wearing_home ?? null,
        draft.wearing_away ?? null,
        draft.share_log ?? true,
      ],
      client,
    );
    // Booth partners (Nov 15): saved partners join every new game, up to two.
    await query("select public.booth_auto_add($1, $2)", [ownerId, rows[0].id], client);
    return rows[0].id;
  });
}

/** The columns an update may set, in a fixed order. Nothing else is ever written from a request. */
const DRAFT_UPDATABLE = ["game_date", "sport", "home_roster_id", "away_roster_id", "wearing_home", "wearing_away", "share_log"] as const;

/** Changes the fields given. False when it is not a draft of this account. */
export async function updateDraft(ownerId: string, id: string, fields: DraftFields): Promise<boolean> {
  const set: string[] = [];
  const params: unknown[] = [id, ownerId];
  for (const column of DRAFT_UPDATABLE) {
    if (fields[column] === undefined) continue;
    params.push(fields[column]);
    set.push(`${column} = $${params.length}`);
  }
  if (set.length === 0) {
    const rows = await query("select id from called_games where id = $1 and owner_id = $2 and status = 'draft' and not booth_guest", params);
    return rows.length > 0;
  }
  // A guest's booth draft is the host's game (Nov 15): nothing on it is his to change.
  const rows = await query(
    `update called_games set ${set.join(", ")} where id = $1 and owner_id = $2 and status = 'draft' and not booth_guest returning id`,
    params,
  );
  return rows.length > 0;
}

/** Deletes a draft. False when it is not a draft of this account. */
export async function deleteDraft(ownerId: string, id: string): Promise<boolean> {
  const rows = await query("delete from called_games where id = $1 and owner_id = $2 and status = 'draft' returning id", [id, ownerId]);
  return rows.length > 0;
}

/**
 * Starts a draft: the same row becomes the live game, with the time, both
 * schools and the sport copied in now, as a game started from setup always
 * was. The draft's id is the game's id; nothing is inserted. "started" when
 * this account's row is no longer a draft (started already, on this computer
 * or another), "missing" when there is no such row of this account's.
 */
export async function startDraft(ownerId: string, id: string, started: Omit<StartedGame, "id">): Promise<"ok" | "started" | "missing"> {
  const rows = await query(
    `update called_games
        set status = 'live', started_at = now(), home_roster_id = $3, away_roster_id = $4,
            home_school = $5, away_school = $6, sport = $7, stats_enabled = $8
      where id = $1 and owner_id = $2 and status = 'draft' and not booth_guest
      returning id`,
    [id, ownerId, started.home_roster_id, started.away_roster_id, started.home_school, started.away_school, started.sport, started.stats_enabled],
  );
  if (rows.length > 0) return "ok";
  // Booth partners (Nov 15): a guest started the host's game first. The host's
  // own Start joins that same game, once; it has already counted, against him.
  // A second Start of his (another computer) is "started", as before.
  const adopted = await query(
    `update called_games set started_by_guest = false
      where id = $1 and owner_id = $2 and status = 'live' and started_by_guest and not booth_guest
      returning id`,
    [id, ownerId],
  );
  if (adopted.length > 0) return "ok";
  // A guest's booth row (Nov 15) is not a draft of his to start this way: it reads as missing.
  const other = await query("select id from called_games where id = $1 and owner_id = $2 and not booth_guest", [id, ownerId]);
  return other.length > 0 ? "started" : "missing";
}
