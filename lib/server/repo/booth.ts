import { randomInt } from "node:crypto";
import type { GamePlayerRow, GameRosterRow } from "@/lib/game/buildGame";
import type { ScheduleRow } from "@/lib/schedule/types";
import { makeCode, normalizeCode, isBoothToken } from "@/lib/booth/code";
import { query, queryOne, withTransaction } from "../db";
import { hashToken, newSessionToken } from "../session";
import { getGameRosters } from "./rosters";

// =============================================================================
// Booth partners (Nov 15; db/migrations/0031_booth.sql). Every function takes
// the signed-in account first, from the session, and decides from the rows
// whether that account is the game's host, an active guest, or nobody. A
// guest never names a roster: his reads find the host's two rosters through
// the host's game row, and only while it is a draft or live.
//
// PRIVACY: who is in a booth, never who was spotted.
// =============================================================================

export type BoothRole =
  | { role: "host"; slot: 0; status: "draft" | "live" }
  | { role: "guest"; slot: 1 | 2; status: "draft" | "live"; hostId: string; guestGameId: string };

/**
 * What this account is to this game, while the game is a draft or live:
 * the host, an active guest, or null (anything else, an ended game included).
 */
export async function boothRole(userId: string, gameId: string): Promise<BoothRole | null> {
  const row = await queryOne<{ owner_id: string; status: string; slot: number | null; guest_game_id: string | null }>(
    `select g.owner_id, g.status, m.slot, m.guest_game_id
       from called_games g
       left join booth_members m on m.host_game_id = g.id and m.guest_id = $1 and m.state = 'active'
      where g.id = $2 and not g.booth_guest and g.status in ('draft', 'live')`,
    [userId, gameId],
  );
  if (!row) return null;
  const status = row.status as "draft" | "live";
  if (row.owner_id === userId) return { role: "host", slot: 0, status };
  if ((row.slot === 1 || row.slot === 2) && row.guest_game_id) {
    return { role: "guest", slot: row.slot, status, hostId: row.owner_id, guestGameId: row.guest_game_id };
  }
  return null;
}

/**
 * The host's two teams for this game, read the way the host's own Start reads
 * them, for a guest. Null for anyone who is not an active guest of a draft or
 * live game. Roster ids never come from the request.
 */
export async function getBoothRosters(
  guestId: string,
  gameId: string,
): Promise<{ rosters: GameRosterRow[]; players: GamePlayerRow[]; schedules: ScheduleRow[]; homeId: string | null; awayId: string | null } | null> {
  const role = await boothRole(guestId, gameId);
  if (!role || role.role !== "guest") return null;
  const game = await queryOne<{ home_roster_id: string | null; away_roster_id: string | null }>(
    "select home_roster_id, away_roster_id from called_games where id = $1 and owner_id = $2",
    [gameId, role.hostId],
  );
  if (!game) return null;
  const ids = [game.home_roster_id, game.away_roster_id].filter((id): id is string => id !== null);
  const read = ids.length > 0 ? await getGameRosters(role.hostId, ids) : { rosters: [], players: [], schedules: [] };
  return { ...read, homeId: game.home_roster_id, awayId: game.away_roster_id };
}

// -----------------------------------------------------------------------------
// The host's side: the code, the link, who is in.
// -----------------------------------------------------------------------------

export interface BoothGuest {
  slot: 1 | 2;
  /** The guest's name from Google, else his email: the host decides who stays. */
  label: string;
  method: "code" | "link" | "partner";
}

export interface HostBooth {
  code: string;
  /** The code was made just now, by this read: the host's first look at his booth (booth.invite_created). */
  created: boolean;
  hasLink: boolean;
  guests: BoothGuest[];
  /** Saved partners who would be added to a new game (Settings), and whether they are on this one. */
  partnersSaved: number;
  partnersOn: boolean;
}

/** True when this account hosts this game and it is a draft or live. */
async function hosts(hostId: string, gameId: string): Promise<boolean> {
  const role = await boothRole(hostId, gameId);
  return role?.role === "host";
}

/** A code no other game holds. Collisions are rare (31^4 codes); a few tries is plenty. */
async function insertCode(hostId: string, gameId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode(randomInt);
    const rows = await query<{ code: string }>(
      `insert into booth_invites (game_id, owner_id, code) values ($1, $2, $3)
       on conflict do nothing returning code`,
      [gameId, hostId, code],
    );
    if (rows[0]) return rows[0].code;
    const existing = await queryOne<{ code: string }>("select code from booth_invites where game_id = $1 and owner_id = $2", [gameId, hostId]);
    if (existing) return existing.code;
  }
  throw Object.assign(new Error("no free code"), { code: "booth_code" });
}

/** The host's view of his booth, the game's code made if it has none. Null when he does not host this game. */
export async function hostBooth(hostId: string, gameId: string): Promise<HostBooth | null> {
  if (!(await hosts(hostId, gameId))) return null;
  const invite = await queryOne<{ code: string; token_hash: string | null }>(
    "select code, token_hash from booth_invites where game_id = $1 and owner_id = $2",
    [gameId, hostId],
  );
  const code = invite?.code ?? (await insertCode(hostId, gameId));
  const guests = await query<{ slot: 1 | 2; label: string; method: BoothGuest["method"] }>(
    `select m.slot, coalesce(nullif(u.name, ''), u.email) as label, m.method
       from booth_members m join users u on u.id = m.guest_id
      where m.host_game_id = $1 and m.host_id = $2 and m.state = 'active'
      order by m.slot`,
    [gameId, hostId],
  );
  const saved = await queryOne<{ n: number }>(
    "select count(*)::int as n from booth_partners where owner_id = $1 and partner_id is not null and auto_add",
    [hostId],
  );
  return {
    code,
    created: !invite,
    hasLink: Boolean(invite?.token_hash),
    guests,
    partnersSaved: saved?.n ?? 0,
    partnersOn: guests.some((guest) => guest.method === "partner"),
  };
}

/** A new link for the game, the old one dead. The token is returned once; only its hash is kept. */
export async function resetLink(hostId: string, gameId: string): Promise<string | null> {
  if (!(await hosts(hostId, gameId))) return null;
  await hostBooth(hostId, gameId);
  const { token, hash } = newSessionToken();
  const rows = await query("update booth_invites set token_hash = $3 where game_id = $1 and owner_id = $2 returning game_id", [gameId, hostId, hash]);
  return rows.length > 0 ? token : null;
}

/** A new code for the game, the old one dead. */
export async function resetCode(hostId: string, gameId: string): Promise<string | null> {
  if (!(await hosts(hostId, gameId))) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode(randomInt);
    try {
      const rows = await query<{ code: string }>(
        "update booth_invites set code = $3 where game_id = $1 and owner_id = $2 returning code",
        [gameId, hostId, code],
      );
      if (rows[0]) return rows[0].code;
      return insertCode(hostId, gameId);
    } catch (err) {
      if ((err as { code?: string }).code !== "23505") throw err;
    }
  }
  return null;
}

/** Takes a guest out of the booth: he cannot come back by the code or the link, and a draft of his is deleted. */
export async function removeGuest(hostId: string, gameId: string, slot: number): Promise<boolean> {
  if (!(await hosts(hostId, gameId))) return false;
  return withTransaction(async (client) => {
    const rows = await query<{ guest_game_id: string | null; guest_id: string }>(
      `update booth_members set state = 'removed', ended_at = now()
        where host_game_id = $1 and host_id = $2 and slot = $3 and state = 'active'
        returning guest_game_id, guest_id`,
      [gameId, hostId, slot],
      client,
    );
    const row = rows[0];
    if (!row) return false;
    if (row.guest_game_id) {
      await query("delete from called_games where id = $1 and owner_id = $2 and status = 'draft' and booth_guest", [row.guest_game_id, row.guest_id], client);
    }
    return true;
  });
}

/**
 * The host's saved partners on this game, or off it. Off takes out the guests
 * who came in as saved partners (they may still join by the code); on adds
 * every saved partner with auto-add, as a new game would, up to two guests.
 */
export async function setPartnersOnGame(hostId: string, gameId: string, on: boolean): Promise<{ removed: Array<1 | 2> } | null> {
  if (!(await hosts(hostId, gameId))) return null;
  if (on) {
    await query("select public.booth_auto_add($1, $2)", [hostId, gameId]);
    return { removed: [] };
  }
  return withTransaction(async (client) => {
    const rows = await query<{ guest_game_id: string | null; guest_id: string; slot: 1 | 2 }>(
      `update booth_members set state = 'left', ended_at = now()
        where host_game_id = $1 and host_id = $2 and method = 'partner' and state = 'active'
        returning guest_game_id, guest_id, slot`,
      [gameId, hostId],
      client,
    );
    for (const row of rows) {
      if (row.guest_game_id) {
        await query("delete from called_games where id = $1 and owner_id = $2 and status = 'draft' and booth_guest", [row.guest_game_id, row.guest_id], client);
      }
    }
    return { removed: rows.map((row) => row.slot) };
  });
}

/** The slots in the booth right now: the host's 0 and each active guest's. */
export async function boothSlots(gameId: string): Promise<Array<0 | 1 | 2>> {
  const rows = await query<{ slot: 1 | 2 }>("select slot from booth_members where host_game_id = $1 and state = 'active' order by slot", [gameId]);
  return [0, ...rows.map((row) => row.slot)];
}

// -----------------------------------------------------------------------------
// The guest's side: joining, his draft, his Start.
// -----------------------------------------------------------------------------

export type JoinStatus = "ok" | "missing" | "own_game" | "over" | "full" | "removed";
export type JoinResult = { status: JoinStatus; gameId: string | null; guestGameId: string | null; live: boolean };

async function join(guestId: string, gameId: string, method: "code" | "link" | "partner"): Promise<JoinResult> {
  const row = await queryOne<{ status: JoinStatus; guest_game_id: string | null }>(
    "select status, guest_game_id from public.booth_join($1, $2, $3)",
    [guestId, gameId, method],
  );
  const status = row?.status ?? "missing";
  if (status !== "ok") return { status, gameId: status === "missing" ? null : gameId, guestGameId: null, live: false };
  const host = await queryOne<{ status: string }>("select status from called_games where id = $1", [gameId]);
  return { status, gameId, guestGameId: row?.guest_game_id ?? null, live: host?.status === "live" };
}

/** Joins the game this code belongs to. A code nobody holds is "missing", which costs the caller a guess. */
export async function joinByCode(guestId: string, typed: unknown): Promise<JoinResult> {
  const code = normalizeCode(typed);
  if (!code) return { status: "missing", gameId: null, guestGameId: null, live: false };
  const invite = await queryOne<{ game_id: string }>("select game_id from booth_invites where code = $1", [code]);
  if (!invite) return { status: "missing", gameId: null, guestGameId: null, live: false };
  return join(guestId, invite.game_id, "code");
}

/** Joins the game this link belongs to. */
export async function joinByToken(guestId: string, token: unknown): Promise<JoinResult> {
  if (!isBoothToken(token)) return { status: "missing", gameId: null, guestGameId: null, live: false };
  const invite = await queryOne<{ game_id: string }>("select game_id from booth_invites where token_hash = $1", [hashToken(token)]);
  if (!invite) return { status: "missing", gameId: null, guestGameId: null, live: false };
  return join(guestId, invite.game_id, "link");
}

/** The sport of the game a link or code belongs to, for an invited sign-up's one question. */
export async function inviteSport(token: unknown): Promise<string | null> {
  if (!isBoothToken(token)) return null;
  const row = await queryOne<{ sport: string | null }>(
    `select g.sport from booth_invites i join called_games g on g.id = i.game_id where i.token_hash = $1`,
    [hashToken(token)],
  );
  return row?.sport ?? null;
}

export interface GuestGame {
  gameId: string;
  guestGameId: string;
  /** The host's name from Google, else his email. */
  hostLabel: string;
  gameDate: string | null;
  sport: string | null;
  homeId: string | null;
  awayId: string | null;
  homeSchool: string | null;
  awaySchool: string | null;
  /** The host's game. */
  hostStatus: "draft" | "live";
  /** The guest's own row. */
  guestStatus: "draft" | "live" | "ended";
  share: boolean;
}

/** One booth game as its guest sees it, while he is an active guest of a draft or live game. */
export async function guestGame(guestId: string, gameId: string): Promise<GuestGame | null> {
  const row = await queryOne<{
    guest_game_id: string;
    host_label: string;
    game_date: string | null;
    sport: string | null;
    home_roster_id: string | null;
    away_roster_id: string | null;
    home_school: string | null;
    away_school: string | null;
    host_status: "draft" | "live";
    guest_status: "draft" | "live" | "ended";
    share_log: boolean;
  }>(
    `select m.guest_game_id, coalesce(nullif(u.name, ''), u.email) as host_label,
            h.game_date::text as game_date, h.sport, h.home_roster_id, h.away_roster_id,
            hr.school as home_school, ar.school as away_school, h.status as host_status,
            g.status as guest_status, g.share_log
       from booth_members m
       join called_games h on h.id = m.host_game_id and h.owner_id = m.host_id
       join called_games g on g.id = m.guest_game_id and g.owner_id = m.guest_id
       join users u on u.id = m.host_id
       left join rosters hr on hr.id = h.home_roster_id and hr.owner_id = h.owner_id
       left join rosters ar on ar.id = h.away_roster_id and ar.owner_id = h.owner_id
      where m.host_game_id = $2 and m.guest_id = $1 and m.state = 'active' and h.status in ('draft', 'live')`,
    [guestId, gameId],
  );
  if (!row) return null;
  return {
    gameId,
    guestGameId: row.guest_game_id,
    hostLabel: row.host_label,
    gameDate: row.game_date,
    sport: row.sport,
    homeId: row.home_roster_id,
    awayId: row.away_roster_id,
    homeSchool: row.home_roster_id ? row.home_school : null,
    awaySchool: row.away_roster_id ? row.away_school : null,
    hostStatus: row.host_status,
    guestStatus: row.guest_status,
    share: row.share_log,
  };
}

export type BoothStartResult = { status: "ok"; guestGameId: string } | { status: "missing" | "teams" };

/** A guest's Start: his row live, and the host's too if it is still a draft (it counts once, against the host). */
export async function boothStart(guestId: string, gameId: string): Promise<BoothStartResult> {
  const row = await queryOne<{ status: "ok" | "missing" | "teams"; guest_game_id: string | null }>(
    "select status, guest_game_id from public.booth_start($1, $2)",
    [guestId, gameId],
  );
  if (row?.status === "ok" && row.guest_game_id) return { status: "ok", guestGameId: row.guest_game_id };
  return { status: row?.status === "teams" ? "teams" : "missing" };
}

// -----------------------------------------------------------------------------
// Saved booth partners (Settings).
// -----------------------------------------------------------------------------

export interface SavedPartner {
  id: string;
  email: string;
  /** The partner's name once accepted, else null. */
  label: string | null;
  accepted: boolean;
  autoAdd: boolean;
}

export async function listPartners(ownerId: string): Promise<SavedPartner[]> {
  const rows = await query<{ id: string; email: string; label: string | null; accepted: boolean; auto_add: boolean }>(
    `select p.id, p.email, nullif(u.name, '') as label, p.partner_id is not null as accepted, p.auto_add
       from booth_partners p left join users u on u.id = p.partner_id
      where p.owner_id = $1
      order by p.created_at asc`,
    [ownerId],
  );
  return rows.map((row) => ({ id: row.id, email: row.email, label: row.label, accepted: row.accepted, autoAdd: row.auto_add }));
}

/** Most saved partners an account keeps. Two fit in a booth; a few more cover a change of crew. */
export const MAX_SAVED_PARTNERS = 6;

export type AddPartnerResult = { status: "ok"; token: string } | { status: "self" | "exists" | "too_many" };

/** Adds a partner by email, waiting for him to accept. The token goes into the email and nowhere else. */
export async function addPartner(owner: { id: string; email: string }, email: string): Promise<AddPartnerResult> {
  if (email.toLowerCase() === owner.email.toLowerCase()) return { status: "self" };
  const count = await queryOne<{ n: number }>("select count(*)::int as n from booth_partners where owner_id = $1", [owner.id]);
  if ((count?.n ?? 0) >= MAX_SAVED_PARTNERS) return { status: "too_many" };
  const { token, hash } = newSessionToken();
  const rows = await query(
    `insert into booth_partners (owner_id, email, token_hash) values ($1, $2, $3)
     on conflict (owner_id, lower(email)) do nothing returning id`,
    [owner.id, email, hash],
  );
  if (rows.length === 0) {
    // Already added and not yet accepted: a fresh link, so "send again" works.
    const again = await query(
      "update booth_partners set token_hash = $3 where owner_id = $1 and lower(email) = lower($2) and partner_id is null returning id",
      [owner.id, email, hash],
    );
    return again.length > 0 ? { status: "ok", token } : { status: "exists" };
  }
  return { status: "ok", token };
}

export async function removePartner(ownerId: string, id: string): Promise<boolean> {
  const rows = await query("delete from booth_partners where id = $1 and owner_id = $2 returning id", [id, ownerId]);
  return rows.length > 0;
}

export async function setPartnerAutoAdd(ownerId: string, id: string, autoAdd: boolean): Promise<boolean> {
  const rows = await query("update booth_partners set auto_add = $3 where id = $1 and owner_id = $2 returning id", [id, ownerId, autoAdd]);
  return rows.length > 0;
}

export interface PartnerInvite {
  id: string;
  /** Who asked: his name from Google, else his email. */
  hostLabel: string;
}

/** Invites waiting for this account, found by its confirmed email only, so nobody can claim an address he has not opened. */
export async function invitesFor(user: { id: string; email: string; emailVerified: boolean }): Promise<PartnerInvite[]> {
  if (!user.emailVerified) return [];
  return query<PartnerInvite>(
    `select p.id, coalesce(nullif(u.name, ''), u.email) as "hostLabel"
       from booth_partners p join users u on u.id = p.owner_id
      where lower(p.email) = lower($1) and p.partner_id is null and p.owner_id <> $2
      order by p.created_at asc`,
    [user.email, user.id],
  );
}

export type AcceptResult = "ok" | "missing" | "self" | "already";

async function accept(partnerId: string, where: string, value: string, extra: unknown[] = []): Promise<AcceptResult> {
  return withTransaction(async (client) => {
    const row = await queryOne<{ id: string; owner_id: string }>(
      `select id, owner_id from booth_partners where ${where} and partner_id is null for update`,
      [value, ...extra],
      client,
    );
    if (!row) return "missing";
    if (row.owner_id === partnerId) return "self";
    const taken = await queryOne("select id from booth_partners where owner_id = $1 and partner_id = $2", [row.owner_id, partnerId], client);
    if (taken) {
      await query("delete from booth_partners where id = $1", [row.id], client);
      return "already";
    }
    await query("update booth_partners set partner_id = $2, accepted_at = now(), token_hash = null where id = $1", [row.id, partnerId], client);
    return "ok";
  });
}

/** Accepts by the emailed link: whoever opens it, signed in, is the partner. */
export async function acceptPartnerByToken(partnerId: string, token: unknown): Promise<AcceptResult> {
  if (!isBoothToken(token)) return "missing";
  return accept(partnerId, "token_hash = $1", hashToken(token));
}

/** Accepts an invite shown in Settings, which only an account with that confirmed email sees. */
export async function acceptPartnerById(user: { id: string; email: string; emailVerified: boolean }, id: string): Promise<AcceptResult> {
  if (!user.emailVerified) return "missing";
  return accept(user.id, "id = $1 and lower(email) = lower($2)", id, [user.email]);
}

export async function declinePartner(user: { id: string; email: string; emailVerified: boolean }, id: string): Promise<boolean> {
  if (!user.emailVerified) return false;
  const rows = await query("delete from booth_partners where id = $1 and lower(email) = lower($2) and partner_id is null returning id", [id, user.email]);
  return rows.length > 0;
}

/** Partners who accepted this account: the hosts whose new games he joins. For Settings. */
export async function hostsOf(partnerId: string): Promise<Array<{ id: string; hostLabel: string }>> {
  return query(
    `select p.id, coalesce(nullif(u.name, ''), u.email) as "hostLabel"
       from booth_partners p join users u on u.id = p.owner_id
      where p.partner_id = $1
      order by p.accepted_at asc`,
    [partnerId],
  );
}

/** Stops being a host's saved partner, from the partner's side. */
export async function leaveHost(partnerId: string, id: string): Promise<boolean> {
  const rows = await query("delete from booth_partners where id = $1 and partner_id = $2 returning id", [id, partnerId]);
  return rows.length > 0;
}

/** The hourly booth cleanup: a host's booth game nobody ended is ended 12 hours after it started. */
export async function endStaleBoothGames(): Promise<void> {
  await query("select public.end_stale_booth_games()");
}

/** Who sent this saved-partner invite, while it is open: for its page, shown only to a signed-in visitor. */
export async function partnerInviteHost(token: string): Promise<string | null> {
  if (!isBoothToken(token)) return null;
  const row = await queryOne<{ label: string }>(
    `select coalesce(nullif(u.name, ''), u.email) as label
       from booth_partners p join users u on u.id = p.owner_id
      where p.token_hash = $1 and p.partner_id is null`,
    [hashToken(token)],
  );
  return row?.label ?? null;
}
