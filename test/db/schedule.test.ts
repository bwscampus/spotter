import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A team's schedule (Oct 28, db/migrations/0020_team_schedule.sql) against a
// real database: Save replaces, so saving twice never doubles it; another
// account's team is a 404; deleting a team deletes its games; and the game's
// read hands each team only its own owner's schedule. The session is stubbed;
// the routes, the repo SQL and Postgres are real. Every school is made up.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

type User = { id: string; email: string; name: null; approved: boolean; isAdmin: boolean; signedInAt: Date };
let current: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: async () => current }));

import { DELETE as deleteRoster } from "@/app/api/rosters/[id]/route";
import { PUT as putSchedule } from "@/app/api/rosters/[id]/schedule/route";
import { GET as gameRosters } from "@/app/api/rosters/game/route";
import { PUT as saveRoster } from "@/app/api/rosters/route";
import { getPool, query, queryOne } from "@/lib/server/db";
import { getSchedule } from "@/lib/server/repo/schedule";
import { scheduleFor } from "@/lib/schedule/types";

const BASE = "https://spotter.test";
const HEADERS = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let alice: User;
let bob: User;
let delmar: string;
let kettle: string;

async function makeUser(label: string): Promise<User> {
  const row = await queryOne<{ id: string }>("insert into users (google_sub, email, approved) values ($1, $2, true) returning id", [
    `${label}-${randomUUID()}`,
    `${label}-${randomUUID()}@example.com`,
  ]);
  return { id: row!.id, email: "x@example.com", name: null, approved: true, isAdmin: false, signedInAt: new Date() };
}

const team = (school: string) => ({
  p_roster: { school, mascot: null, sport: "football", gender: "boys", level: "varsity", season: "2026" },
  p_players: [{ jersey: "7", first_name: "Cole", last_name: "Brandt", pronunciations: [], spoken_forms: ["brandt"], spot_mode: "normal" }],
});

const GAMES = [
  { game_date: "2026-08-29", opponent: "Harlow Ridge", site: "H", team_score: 28, opponent_score: 14, is_league: false },
  { game_date: "2026-09-05", opponent: "Kettle Creek", site: "A", team_score: 17, opponent_score: 20, is_league: true },
  { game_date: "2026-11-06", opponent: "Coastline", site: "N", team_score: null, opponent_score: null, is_league: true },
];

const save = (teamId: string, games: unknown) => putSchedule(call("PUT", `/api/rosters/${teamId}/schedule`, { games }), params(teamId));

beforeAll(async () => {
  alice = await makeUser("alice");
  bob = await makeUser("bob");
  current = alice;
  delmar = ((await (await saveRoster(call("PUT", "/api/rosters", team("Delmar")))).json()) as { id: string }).id;
  kettle = ((await (await saveRoster(call("PUT", "/api/rosters", team("Kettle Creek")))).json()) as { id: string }).id;
});

afterAll(async () => {
  await query("delete from users where id = any($1::uuid[])", [[alice.id, bob.id]]);
  await getPool().end();
});

describe("saving a schedule", () => {
  it("replaces the team's schedule: the same schedule saved twice is one copy", async () => {
    current = alice;
    const first = await save(delmar, GAMES);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ saved: 3 });
    const second = await save(delmar, GAMES);
    expect(await second.json()).toEqual({ saved: 3 });
    const rows = await getSchedule(alice.id, delmar);
    expect(rows).toHaveLength(3);
    expect(scheduleFor(rows, delmar).map((game) => [game.date, game.opponent, game.site, game.teamScore, game.opponentScore, game.league])).toEqual([
      ["2026-08-29", "Harlow Ridge", "H", 28, 14, false],
      ["2026-09-05", "Kettle Creek", "A", 17, 20, true],
      ["2026-11-06", "Coastline", "N", null, null, true],
    ]);
  });

  it("with fewer games, keeps only those", async () => {
    current = alice;
    expect(await (await save(delmar, GAMES.slice(0, 1))).json()).toEqual({ saved: 1 });
    expect(await getSchedule(alice.id, delmar)).toHaveLength(1);
    await save(delmar, GAMES);
  });

  it("refuses a game with one score and not the other, and keeps what was saved", async () => {
    current = alice;
    const response = await save(delmar, [{ ...GAMES[0], opponent_score: null }]);
    expect(response.status).toBe(400);
    expect(await getSchedule(alice.id, delmar)).toHaveLength(3);
  });
});

describe("another account", () => {
  it("gets a 404 saving over A's team, and A's games are untouched", async () => {
    current = bob;
    const response = await save(delmar, []);
    expect(response.status).toBe(404);
    expect(await getSchedule(alice.id, delmar)).toHaveLength(3);
    expect(await getSchedule(bob.id, delmar)).toEqual([]);
  });

  it("reads no schedule through the game's roster read", async () => {
    current = bob;
    const response = await gameRosters(call("GET", `/api/rosters/game?ids=${delmar},${kettle}`));
    expect(await response.json()).toEqual({ rosters: [], players: [], schedules: [] });
  });
});

describe("the game's read", () => {
  it("hands back both teams' schedules with the rosters", async () => {
    current = alice;
    await save(kettle, [{ ...GAMES[2], opponent: "Pinewood" }]);
    const body = (await (await gameRosters(call("GET", `/api/rosters/game?ids=${delmar},${kettle}`))).json()) as {
      schedules: Array<{ team_id: string; game_date: string }>;
    };
    expect(scheduleFor(body.schedules as never, delmar)).toHaveLength(3);
    expect(scheduleFor(body.schedules as never, kettle).map((game) => game.opponent)).toEqual(["Pinewood"]);
    expect(body.schedules.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.game_date))).toBe(true);
  });
});

describe("deleting the team", () => {
  it("deletes its games with it", async () => {
    current = alice;
    const response = await deleteRoster(call("DELETE", `/api/rosters/${kettle}`), params(kettle));
    expect(response.status).toBeLessThan(300);
    const left = await queryOne<{ count: number }>("select count(*)::int as count from schedule_games where team_id = $1", [kettle]);
    expect(left?.count).toBe(0);
  });
});
