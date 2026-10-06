import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Production Standard API-1 (BOLA), proved against a real database: every route
// that takes an id, called by account B on account A's data, finds nothing.
// The session is stubbed; everything else (routes, repo SQL, Postgres) is real.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

type User = { id: string; email: string; name: null; approved: boolean; isAdmin: boolean; signedInAt: Date };
let current: User | null = null;
// Outside a request there is no cookie store; the session itself is stubbed below.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: async () => current }));

import { DELETE as deleteRoster } from "@/app/api/rosters/[id]/route";
import { PUT as putStats } from "@/app/api/rosters/[id]/stats/route";
import { GET as gameRosters } from "@/app/api/rosters/game/route";
import { GET as findRoster, PUT as saveRoster } from "@/app/api/rosters/route";
import { PATCH as endGame } from "@/app/api/games/[id]/route";
import { PUT as putFeedback } from "@/app/api/games/[id]/feedback/route";
import { POST as startGame } from "@/app/api/games/route";
import { getPool, query, queryOne } from "@/lib/server/db";
import { getRoster, listRosters } from "@/lib/server/repo/rosters";
import { listPastGames } from "@/lib/server/repo/games";

const BASE = "https://spotter.test";
const HEADERS = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let alice: User;
let bob: User;
let aliceRoster: string;
let aliceRoster2: string;
let aliceGame: string;

async function makeUser(label: string): Promise<User> {
  const row = await queryOne<{ id: string }>(
    "insert into users (google_sub, email, approved) values ($1, $2, true) returning id",
    [`${label}-${randomUUID()}`, `${label}-${randomUUID()}@example.com`],
  );
  return { id: row!.id, email: "x@example.com", name: null, approved: true, isAdmin: false, signedInAt: new Date() };
}

const team = (school: string) => ({
  p_roster: { school, mascot: null, sport: "football", gender: "boys", level: "varsity", season: "2026" },
  p_players: [{ jersey: "22", first_name: "Sam", last_name: "Langan", pronunciations: [], spoken_forms: ["langan"], spot_mode: "normal" }],
});

beforeAll(async () => {
  alice = await makeUser("alice");
  bob = await makeUser("bob");
  current = alice;
  aliceRoster = ((await (await saveRoster(call("PUT", "/api/rosters", team("Brentwood")))).json()) as { id: string }).id;
  aliceRoster2 = ((await (await saveRoster(call("PUT", "/api/rosters", team("Estancia")))).json()) as { id: string }).id;
  aliceGame = randomUUID();
  const started = await startGame(
    call("POST", "/api/games", {
      id: aliceGame,
      home_roster_id: aliceRoster,
      away_roster_id: aliceRoster2,
      home_school: "Brentwood",
      away_school: "Estancia",
      sport: "football",
      stats_enabled: false,
    }),
  );
  expect(started.status).toBe(201);
  current = bob;
});

afterAll(async () => {
  await query("delete from users where id = any($1::uuid[])", [[alice.id, bob.id]]);
  await getPool().end();
});

describe("account B cannot reach account A's data", () => {
  it("does not see A's teams, rosters or games", async () => {
    expect(await listRosters(bob.id)).toEqual([]);
    expect(await getRoster(bob.id, aliceRoster)).toBeNull();
    expect(await listPastGames(bob.id)).toEqual({ ok: true, games: [] });
    const lookup = await findRoster(call("GET", `/api/rosters?key=${encodeURIComponent("brentwood|football|boys|varsity|2026")}`));
    expect(await lookup.json()).toEqual({ id: null });
  });

  it("GET /api/rosters/game returns none of A's teams or players", async () => {
    const response = await gameRosters(call("GET", `/api/rosters/game?ids=${aliceRoster},${aliceRoster2}`));
    expect(await response.json()).toEqual({ rosters: [], players: [] });
  });

  it("PUT /api/rosters with A's id cannot rename A's team", async () => {
    const response = await saveRoster(call("PUT", "/api/rosters", { ...team("Hijacked"), p_roster: { ...team("Hijacked").p_roster, id: aliceRoster } }));
    expect(response.status).toBe(400);
    expect((await getRoster(alice.id, aliceRoster))?.team.school).toBe("Brentwood");
  });

  it("PUT /api/rosters/[id]/stats on A's team is 404", async () => {
    const response = await putStats(call("PUT", `/api/rosters/${aliceRoster}/stats`, { as_of: null, players: [] }), params(aliceRoster));
    expect(response.status).toBe(404);
  });

  it("DELETE /api/rosters/[id] on A's team is 404 and deletes nothing", async () => {
    const response = await deleteRoster(call("DELETE", `/api/rosters/${aliceRoster}`), params(aliceRoster));
    expect(response.status).toBe(404);
    expect(await getRoster(alice.id, aliceRoster)).not.toBeNull();
  });

  it("POST /api/games naming A's rosters is refused", async () => {
    const response = await startGame(
      call("POST", "/api/games", {
        id: randomUUID(),
        home_roster_id: aliceRoster,
        away_roster_id: aliceRoster2,
        home_school: "Brentwood",
        away_school: "Estancia",
        sport: "football",
        stats_enabled: false,
      }),
    );
    expect(response.status).toBe(404);
  });

  it("POST /api/games reusing A's game id does not touch A's game", async () => {
    current = bob;
    const bobs = ((await (await saveRoster(call("PUT", "/api/rosters", team("Bob High")))).json()) as { id: string }).id;
    await startGame(
      call("POST", "/api/games", {
        id: aliceGame,
        home_roster_id: bobs,
        away_roster_id: bobs,
        home_school: "Bob High",
        away_school: "Bob High",
        sport: "football",
        stats_enabled: false,
      }),
    );
    const [game] = await query<{ owner_id: string; home_school: string }>("select owner_id, home_school from called_games where id = $1", [aliceGame]);
    expect(game).toEqual({ owner_id: alice.id, home_school: "Brentwood" });
  });

  it("PATCH /api/games/[id] on A's game is 404", async () => {
    const counts = { ended_at: new Date().toISOString(), mic_seconds: 1, reconnects: 0, cards_shown: 999, cards_removed: 0, stat_plays_added: 0, stat_plays_undone: 0 };
    const response = await endGame(call("PATCH", `/api/games/${aliceGame}`, counts), params(aliceGame));
    expect(response.status).toBe(404);
    const [game] = await query<{ cards_shown: number }>("select cards_shown from called_games where id = $1", [aliceGame]);
    expect(game.cards_shown).toBe(0);
  });

  it("PUT /api/games/[id]/feedback on A's game is 404", async () => {
    const response = await putFeedback(call("PUT", `/api/games/${aliceGame}/feedback`, { rating: 1, blockers: ["slow"], note: "" }), params(aliceGame));
    expect(response.status).toBe(404);
    expect(await query("select 1 from game_feedback where game_id = $1", [aliceGame])).toEqual([]);
  });
});

describe("account A can use its own data", () => {
  it("ends its game, leaves feedback, and sees both", async () => {
    current = alice;
    const counts = { ended_at: new Date().toISOString(), mic_seconds: 60, reconnects: 1, cards_shown: 12, cards_removed: 1, stat_plays_added: 0, stat_plays_undone: 0 };
    expect((await endGame(call("PATCH", `/api/games/${aliceGame}`, counts), params(aliceGame))).status).toBe(200);
    expect((await putFeedback(call("PUT", `/api/games/${aliceGame}/feedback`, { rating: 5, blockers: [], note: "" }), params(aliceGame))).status).toBe(200);
    const past = await listPastGames(alice.id);
    expect(past.ok && past.games.map((g) => [g.cardsShown, g.rating])).toEqual([[12, 5]]);
  });

  it("deletes its own team", async () => {
    current = alice;
    expect((await deleteRoster(call("DELETE", `/api/rosters/${aliceRoster2}`), params(aliceRoster2))).status).toBe(204);
  });
});
