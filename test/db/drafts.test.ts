import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Draft games and About you (Nov 3), against a real database: owner scoping on
// every new route (another account's draft or roster id is a 404), starting a
// draft keeps its row and id, Past games never lists a draft, and the daily
// cleanup takes only old drafts. The session is stubbed; routes, repo SQL and
// Postgres are real. Made-up schools and players.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

type User = { id: string; email: string; name: null; approved: boolean; isAdmin: boolean; emailVerified: boolean; signedInAt: Date; onboarded?: boolean };
let current: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: async () => current }));

import { GET as listDraftsRoute, POST as createDraftRoute } from "@/app/api/drafts/route";
import { DELETE as deleteDraftRoute, PATCH as patchDraftRoute } from "@/app/api/drafts/[id]/route";
import { POST as startDraftRoute } from "@/app/api/drafts/[id]/start/route";
import { DELETE as deleteGameRoute, PATCH as endGameRoute } from "@/app/api/games/[id]/route";
import { PUT as putFeedback } from "@/app/api/games/[id]/feedback/route";
import { POST as startGameRoute } from "@/app/api/games/route";
import { PATCH as patchMe } from "@/app/api/me/route";
import { PUT as saveRoster } from "@/app/api/rosters/route";
import { getPool, query, queryOne } from "@/lib/server/db";
import { deleteExpired, getAbout } from "@/lib/server/repo/account";
import { listDrafts, listPastGames } from "@/lib/server/repo/games";

const BASE = "https://spotter.test";
const HEADERS = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let alice: User;
let bob: User;
let away: string;
let home: string;
let bobRoster: string;

async function makeUser(label: string): Promise<User> {
  const row = await queryOne<{ id: string }>(
    "insert into users (google_sub, email, approved) values ($1, $2, true) returning id",
    [`${label}-${randomUUID()}`, `${label}-${randomUUID()}@example.com`],
  );
  return { id: row!.id, email: "x@example.com", name: null, approved: true, isAdmin: false, emailVerified: true, signedInAt: new Date() };
}

const team = (school: string) => ({
  p_roster: { school, mascot: null, sport: "football", gender: "boys", level: "varsity", season: "2026" },
  p_players: [{ jersey: "22", first_name: "Sam", last_name: "Quillon", pronunciations: [], spoken_forms: ["quillon"], spot_mode: "normal" }],
});
const saved = async (school: string) => ((await (await saveRoster(call("PUT", "/api/rosters", team(school)))).json()) as { id: string }).id;
const create = async (body: unknown) => createDraftRoute(call("POST", "/api/drafts", body));
const draftId = async (body: unknown) => ((await (await create(body)).json()) as { id: string }).id;
const started = (id: string, rosters = { away, home }) => ({
  id,
  home_roster_id: rosters.home,
  away_roster_id: rosters.away,
  home_school: "Harborview",
  away_school: "Millbrook",
  sport: "football",
  stats_enabled: false,
});

beforeAll(async () => {
  alice = await makeUser("alice-drafts");
  bob = await makeUser("bob-drafts");
  current = alice;
  away = await saved("Millbrook");
  home = await saved("Harborview");
  current = bob;
  bobRoster = await saved("Bobtown");
  current = alice;
});

afterAll(async () => {
  await query("delete from users where id = any($1::uuid[])", [[alice.id, bob.id]]);
  await getPool().end();
});

describe("draft games", () => {
  it("creates a draft with one team, lists it with its school, and never as a past game", async () => {
    current = alice;
    const response = await create({ game_date: "2026-11-06", sport: "football", away_roster_id: away });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const listed = await listDrafts(alice.id);
    expect(listed.ok && listed.drafts.find((draft) => draft.id === id)).toMatchObject({ gameDate: "2026-11-06", awayId: away, awaySchool: "Millbrook", homeId: null });
    const past = await listPastGames(alice.id);
    expect(past.ok && past.games.some((game) => game.id === id)).toBe(false);
    const viaRoute = (await (await listDraftsRoute(call("GET", "/api/drafts"))).json()) as { drafts: Array<{ id: string }> };
    expect(viaRoute.drafts.some((draft) => draft.id === id)).toBe(true);
  });

  it("refuses a draft with no date, or one naming another account's roster (a 404)", async () => {
    current = alice;
    expect((await create({ sport: "football" })).status).toBe(400);
    expect((await create({ game_date: "2026-11-06", away_roster_id: bobRoster })).status).toBe(404);
  });

  it("is another account's 404 to read, change, delete or start", async () => {
    current = alice;
    const id = await draftId({ game_date: "2026-11-06", away_roster_id: away, home_roster_id: home });
    current = bob;
    expect((await patchDraftRoute(call("PATCH", `/api/drafts/${id}`, { game_date: "2026-11-07" }), params(id))).status).toBe(404);
    expect((await deleteDraftRoute(call("DELETE", `/api/drafts/${id}`), params(id))).status).toBe(404);
    expect((await startDraftRoute(call("POST", `/api/drafts/${id}/start`, started(id)), params(id))).status).toBe(404);
    const bobs = (await (await listDraftsRoute(call("GET", "/api/drafts"))).json()) as { drafts: Array<{ id: string }> };
    expect(bobs.drafts.some((draft) => draft.id === id)).toBe(false);
    const row = await queryOne<{ game_date: string; status: string }>("select game_date::text, status from called_games where id = $1", [id]);
    expect(row).toEqual({ game_date: "2026-11-06", status: "draft" });
  });

  it("refuses to put another account's roster on one's own draft (a 404)", async () => {
    current = alice;
    const id = await draftId({ game_date: "2026-11-06" });
    expect((await patchDraftRoute(call("PATCH", `/api/drafts/${id}`, { home_roster_id: bobRoster }), params(id))).status).toBe(404);
    expect((await patchDraftRoute(call("PATCH", `/api/drafts/${id}`, { home_roster_id: home, wearing_home: "white" }), params(id))).status).toBe(200);
  });

  it("starts a draft in place: the same id, one row, live, with the schools copied in", async () => {
    current = alice;
    const id = await draftId({ game_date: "2026-11-06", away_roster_id: away, home_roster_id: home });
    const before = await queryOne<{ n: number }>("select count(*)::int as n from called_games where owner_id = $1", [alice.id]);
    expect((await startDraftRoute(call("POST", `/api/drafts/${id}/start`, started(id)), params(id))).status).toBe(200);
    const after = await queryOne<{ n: number }>("select count(*)::int as n from called_games where owner_id = $1", [alice.id]);
    expect(after!.n).toBe(before!.n);
    const row = await queryOne<{ status: string; started: boolean; home_school: string; game_date: string }>(
      "select status, started_at is not null as started, home_school, game_date::text from called_games where id = $1",
      [id],
    );
    expect(row).toEqual({ status: "live", started: true, home_school: "Harborview", game_date: "2026-11-06" });
    // It is a game now: in Past games, out of the drafts, and cannot be started twice.
    const past = await listPastGames(alice.id);
    expect(past.ok && past.games.some((game) => game.id === id)).toBe(true);
    const drafts = await listDrafts(alice.id);
    expect(drafts.ok && drafts.drafts.some((draft) => draft.id === id)).toBe(false);
    // Started already: a 409, so the browser records its game under a new id instead of this one.
    expect((await startDraftRoute(call("POST", `/api/drafts/${id}/start`, started(id)), params(id))).status).toBe(409);
    // And the ordinary game route will not take this row's id either.
    expect((await startGameRoute(call("POST", "/api/games", started(id)))).status).toBe(409);
    // A start body for another game id is refused.
    const other = await draftId({ game_date: "2026-11-06", away_roster_id: away, home_roster_id: home });
    expect((await startDraftRoute(call("POST", `/api/drafts/${other}/start`, started(id)), params(other))).status).toBe(400);
  });

  it("ends a started draft as a game, and never ends, rates or deletes a draft through the game routes", async () => {
    current = alice;
    const id = await draftId({ game_date: "2026-11-06", away_roster_id: away, home_roster_id: home });
    const ended = { ended_at: new Date().toISOString(), mic_seconds: 1, reconnects: 0, cards_shown: 0, cards_removed: 0, stat_plays_added: 0, stat_plays_undone: 0 };
    expect((await endGameRoute(call("PATCH", `/api/games/${id}`, ended), params(id))).status).toBe(404);
    expect((await putFeedback(call("PUT", `/api/games/${id}/feedback`, { rating: 4, blockers: [], note: null }), params(id))).status).toBe(404);
    expect((await deleteGameRoute(call("DELETE", `/api/games/${id}`), params(id))).status).toBe(404);
    await startDraftRoute(call("POST", `/api/drafts/${id}/start`, started(id)), params(id));
    expect((await endGameRoute(call("PATCH", `/api/games/${id}`, ended), params(id))).status).toBe(200);
    const row = await queryOne<{ status: string }>("select status from called_games where id = $1", [id]);
    expect(row!.status).toBe("ended");
  });

  it("still records a game started without a draft, as before", async () => {
    current = alice;
    const id = randomUUID();
    expect((await startGameRoute(call("POST", "/api/games", started(id)))).status).toBe(201);
    const row = await queryOne<{ status: string }>("select status from called_games where id = $1", [id]);
    expect(row!.status).toBe("live");
  });

  it("deletes a draft of one's own", async () => {
    current = alice;
    const id = await draftId({ game_date: "2026-11-06" });
    expect((await deleteDraftRoute(call("DELETE", `/api/drafts/${id}`), params(id))).status).toBe(204);
    expect(await queryOne("select id from called_games where id = $1", [id])).toBeNull();
  });

  it("the daily cleanup deletes drafts 15 days past their date, and nothing else", async () => {
    current = alice;
    const old = await draftId({ game_date: "2026-01-01" });
    const recent = await draftId({ game_date: "2099-01-01" });
    const game = randomUUID();
    await startGameRoute(call("POST", "/api/games", started(game)));
    await deleteExpired();
    expect(await queryOne("select id from called_games where id = $1", [old])).toBeNull();
    expect(await queryOne("select id from called_games where id = $1", [recent])).not.toBeNull();
    expect(await queryOne("select id from called_games where id = $1", [game])).not.toBeNull();
  });
});

describe("About you", () => {
  it("saves the signed-in account's answers only, and stamps it seen", async () => {
    current = bob;
    expect((await patchMe(call("PATCH", "/api/me", { sports: ["basketball"], roles: ["radio_pbp"] }))).status).toBe(200);
    expect(await getAbout(bob.id)).toEqual({ sports: ["basketball"], otherSports: [], roles: ["radio_pbp"], onboarded: true });
    expect((await getAbout(alice.id)).onboarded).toBe(false);
    expect((await patchMe(call("PATCH", "/api/me", { sports: ["curling"], roles: [] }))).status).toBe(400);
  });

  it("marks a skip as seen and keeps what was said before", async () => {
    current = bob;
    expect((await patchMe(call("PATCH", "/api/me", { skip: true }))).status).toBe(200);
    expect(await getAbout(bob.id)).toEqual({ sports: ["basketball"], otherSports: [], roles: ["radio_pbp"], onboarded: true });
  });

  it("keeps sports typed under Other (Nov 4), a listed one as its box, and other only while one is kept", async () => {
    current = bob;
    const body = { sports: ["basketball"], roles: ["radio_pbp"], other_sports: ["wrestling", "Volleyball", "Curling"] };
    expect((await patchMe(call("PATCH", "/api/me", body))).status).toBe(200);
    expect(await getAbout(bob.id)).toEqual({
      sports: ["volleyball", "basketball", "other"],
      otherSports: ["Wrestling", "Curling"],
      roles: ["radio_pbp"],
      onboarded: true,
    });
    expect((await patchMe(call("PATCH", "/api/me", { sports: ["basketball"], roles: [], other_sports: [] }))).status).toBe(200);
    expect(await getAbout(bob.id)).toMatchObject({ sports: ["basketball"], otherSports: [] });
    expect((await patchMe(call("PATCH", "/api/me", { sports: [], roles: [], other_sports: ["x".repeat(41)] }))).status).toBe(400);
  });

  it("refuses a signed-out request", async () => {
    current = null;
    expect((await patchMe(call("PATCH", "/api/me", { skip: true }))).status).toBe(401);
  });
});
