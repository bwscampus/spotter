import type { FeedbackRow } from "@/lib/game/feedback";
import { PAST_GAMES_LIMIT, toPastGame, type PastGameRow, type PastGamesResult } from "@/lib/game/pastGames";
import { query } from "../db";

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
};

/**
 * Records a game. The id is made in the browser so the browser log has a game
 * to belong to; on conflict nothing is overwritten. The composite foreign keys
 * refuse a roster id that is not this owner's (Postgres 23503).
 */
export async function insertGame(ownerId: string, game: StartedGame): Promise<boolean> {
  const rows = await query(
    `insert into called_games (id, owner_id, home_roster_id, away_roster_id, home_school, away_school, sport, stats_enabled)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (id) do nothing
     returning id`,
    [game.id, ownerId, game.home_roster_id, game.away_roster_id, game.home_school, game.away_school, game.sport, game.stats_enabled],
  );
  return rows.length > 0;
}

/** Writes End game's counts. False when the game is not this account's. */
export async function endGame(ownerId: string, id: string, ended: EndedGame): Promise<boolean> {
  const rows = await query(
    `update called_games
        set ended_at = $3, mic_seconds = $4, reconnects = $5, cards_shown = $6, cards_removed = $7,
            stat_plays_added = $8, stat_plays_undone = $9
      where id = $1 and owner_id = $2
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
    ],
  );
  return rows.length > 0;
}

/** Deletes a game and, by cascade, its feedback. False when it is not this account's. */
export async function deleteGame(ownerId: string, id: string): Promise<boolean> {
  const rows = await query("delete from called_games where id = $1 and owner_id = $2 returning id", [id, ownerId]);
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
      where exists (select 1 from called_games where id = $1 and owner_id = $2)
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
              case when f.rating is null then null else json_build_object('rating', f.rating) end as game_feedback
         from called_games g
         left join game_feedback f on f.game_id = g.id
        where g.owner_id = $1
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
