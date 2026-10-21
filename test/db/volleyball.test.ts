import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// db/migrations/0020_volleyball_season_values.sql against a real database:
// a volleyball roster saves each player's stats as labelled values, a stats
// import replaces them, and a football roster saves exactly what it did
// before, with no values at all. Made-up names.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

type User = { id: string; email: string; name: null; approved: boolean; isAdmin: boolean; signedInAt: Date };
let current: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: async () => current }));

import { PUT as putStats } from "@/app/api/rosters/[id]/stats/route";
import { GET as gameRosters } from "@/app/api/rosters/game/route";
import { PUT as saveRoster } from "@/app/api/rosters/route";
import { getPool, query, queryOne } from "@/lib/server/db";
import { getRoster } from "@/lib/server/repo/rosters";

const call = (method: string, path: string, body?: unknown) =>
  new Request(`https://spotter.test${path}`, {
    method,
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const player = (jersey: string, first: string, last: string, position: string, extra: Record<string, unknown> = {}) => ({
  jersey,
  first_name: first,
  last_name: last,
  position,
  pronunciations: [],
  spoken_forms: [last.toLowerCase()],
  spot_mode: "normal",
  ...extra,
});

let owner: User;
let volleyball: string;
let football: string;

beforeAll(async () => {
  const row = await queryOne<{ id: string }>("insert into users (google_sub, email, approved) values ($1, $2, true) returning id", [
    `volleyball-${randomUUID()}`,
    `volleyball-${randomUUID()}@example.com`,
  ]);
  owner = { id: row!.id, email: "x@example.com", name: null, approved: true, isAdmin: false, signedInAt: new Date() };
  current = owner;

  const saved = await saveRoster(
    call("PUT", "/api/rosters", {
      p_roster: { school: "Lakeview", mascot: "Lions", sport: "volleyball", gender: "girls", level: "varsity", season: "26-27" },
      p_players: [
        player("4", "Tess", "Varga", "OH", {
          season_values: [
            { label: "K", value: "245" },
            { label: "PCT", value: ".301" },
            { label: "Kill %", value: "43.8" },
            { label: "k", value: "999" },
            { label: "", value: "1" },
            { label: "SA", value: 31 },
          ],
          stats_as_of: "2026-10-21",
        }),
        player("9", "Rosa", "Quint", "DS"),
      ],
    }),
  );
  expect(saved.status).toBe(200);
  volleyball = ((await saved.json()) as { id: string }).id;

  const savedFootball = await saveRoster(
    call("PUT", "/api/rosters", {
      p_roster: { school: "Lakeview", mascot: "Lions", sport: "football", gender: "boys", level: "varsity", season: "2026" },
      p_players: [player("22", "Sam", "Langan", "RB", { season_stats: { rush_att: 64, rush_yds: 420 }, stats_as_of: "2026-10-01" })],
    }),
  );
  football = ((await savedFootball.json()) as { id: string }).id;
});

afterAll(async () => {
  await query("delete from users where id = $1", [owner.id]);
  await getPool().end();
});

const valuesOf = async (rosterId: string) =>
  query<{ last_name: string; season_values: unknown; season_stats: unknown; stats_as_of: string | null }>(
    "select last_name, season_values, season_stats, stats_as_of::text from roster_players where roster_id = $1 order by sort_order",
    [rosterId],
  );

describe("a volleyball roster's stats", () => {
  it("are saved as labelled values, cleaned the way the browser cleans them", async () => {
    const rows = await valuesOf(volleyball);
    expect(rows[0].season_values).toEqual([
      { label: "K", value: "245" },
      { label: "PCT", value: ".301" },
      { label: "Kill %", value: "43.8" },
      { label: "SA", value: "31" },
    ]);
    // A player with a name and a number and nothing else is saved too.
    expect(rows[1]).toMatchObject({ last_name: "Quint", season_values: null });
  });

  it("come back on the team page and in a game's rosters", async () => {
    const roster = await getRoster(owner.id, volleyball);
    expect(roster?.players[0].season?.season_values?.[0]).toEqual({ label: "K", value: "245" });
    expect(roster?.players[1].season).toBeNull();
    const response = await gameRosters(call("GET", `/api/rosters/game?ids=${volleyball},${football}`));
    const { players } = (await response.json()) as { players: Array<{ last_name: string; season_values: unknown }> };
    expect(players.find((row) => row.last_name === "Varga")?.season_values).toHaveLength(4);
  });

  it("are replaced by a stats import, and cleared for a player it does not name", async () => {
    const ids = await query<{ id: string; last_name: string }>("select id, last_name from roster_players where roster_id = $1", [volleyball]);
    const quint = ids.find((row) => row.last_name === "Quint")!.id;
    const response = await putStats(
      call("PUT", `/api/rosters/${volleyball}/stats`, {
        as_of: "2026-10-22",
        players: [{ id: quint, stats: null, lines: [], values: [{ label: "DIG", value: "120" }] }],
      }),
      params(volleyball),
    );
    expect(await response.json()).toEqual({ matched: 1 });
    const rows = await valuesOf(volleyball);
    expect(rows[0]).toMatchObject({ last_name: "Varga", season_values: null, stats_as_of: null });
    expect(rows[1]).toMatchObject({ last_name: "Quint", season_values: [{ label: "DIG", value: "120" }], stats_as_of: "2026-10-22" });
  });
});

describe("a football roster", () => {
  it("saves its numbers as before, and no values", async () => {
    const [row] = await valuesOf(football);
    expect(row).toMatchObject({ season_stats: { rush_att: 64, rush_yds: 420 }, season_values: null, stats_as_of: "2026-10-01" });
  });
});
