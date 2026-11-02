import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// set_season_stats against a real database (db/migrations/0021_season_stats_stale_ids.sql,
// audit Nov 1): stats read before the roster was saved again carry player ids the
// team no longer has, and saving them must change nothing, where it used to clear
// every player's stats. The session is stubbed; the routes, the SQL and Postgres
// are real. Every name is made up.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

type User = { id: string; email: string; name: null; approved: boolean; isAdmin: boolean; signedInAt: Date };
let current: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: async () => current }));

import { PUT as putStats } from "@/app/api/rosters/[id]/stats/route";
import { PUT as saveRoster } from "@/app/api/rosters/route";
import { getPool, query, queryOne } from "@/lib/server/db";

const BASE = "https://spotter.test";
const HEADERS = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
const call = (method: string, path: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

let teamId: string;

const roster = (id?: string) => ({
  p_roster: { ...(id ? { id } : {}), school: "Marlow Bay", mascot: null, sport: "football", gender: "boys", level: "varsity", season: "2026" },
  p_players: [
    { jersey: "7", first_name: "Cole", last_name: "Brandt", pronunciations: [], spoken_forms: ["brandt"], spot_mode: "normal" },
    { jersey: "22", first_name: "Ade", last_name: "Okonjo", pronunciations: [], spoken_forms: ["okonjo"], spot_mode: "normal" },
  ],
});

const playerIds = async () => (await query<{ id: string }>("select id from roster_players where roster_id = $1 order by jersey", [teamId])).map((row) => row.id);
const statsOf = async () =>
  (await query<{ season_stats: Record<string, number> | null }>("select season_stats from roster_players where roster_id = $1 order by jersey", [teamId])).map(
    (row) => row.season_stats,
  );

beforeAll(async () => {
  const row = await queryOne<{ id: string }>("insert into users (google_sub, email, approved) values ($1, $2, true) returning id", [
    `stats-${randomUUID()}`,
    `stats-${randomUUID()}@example.com`,
  ]);
  current = { id: row!.id, email: "x@example.com", name: null, approved: true, isAdmin: false, signedInAt: new Date() };
  teamId = ((await (await saveRoster(call("PUT", "/api/rosters", roster()))).json()) as { id: string }).id;
});

afterAll(async () => {
  if (current) await query("delete from users where id = $1", [current.id]);
  await getPool().end();
});

describe("basketball and volleyball numbers (0022, Nov 2)", () => {
  it("keeps each sport's keys and drops what no sport has", async () => {
    const saved = (await (
      await saveRoster(
        call("PUT", "/api/rosters", {
          p_roster: { school: "Marlow Bay", mascot: null, sport: "basketball", gender: "girls", level: "varsity", season: "2026-27" },
          p_players: [{ jersey: "22", first_name: "Ada", last_name: "Quintero", pronunciations: [], spoken_forms: ["quintero"], spot_mode: "normal" }],
        }),
      )
    ).json()) as { id: string };
    const [player] = await query<{ id: string }>("select id from roster_players where roster_id = $1", [saved.id]);
    const response = await putStats(
      call("PUT", `/api/rosters/${saved.id}/stats`, {
        as_of: "2026-11-02",
        players: [{ id: player.id, stats: { gp: 10, pts: 184, three_made: 22, kills: 3, ppg: 18.4 }, lines: [] }],
      }),
      params(saved.id),
    );
    expect(response.status).toBe(200);
    const [row] = await query<{ season_stats: Record<string, number> }>("select season_stats from roster_players where id = $1", [player.id]);
    // kills is volleyball's, kept by the shared cleaner but never read for a basketball team; ppg is nobody's.
    expect(row.season_stats).toEqual({ gp: 10, pts: 184, three_made: 22, kills: 3 });
  });
});

describe("saving season stats", () => {
  it("writes stats for the team's own players", async () => {
    const ids = await playerIds();
    const response = await putStats(
      call("PUT", `/api/rosters/${teamId}/stats`, { as_of: "2026-10-30", players: ids.map((id) => ({ id, stats: { rush_att: 10 }, lines: [] })) }),
      params(teamId),
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as { matched: number }).matched).toBe(2);
    expect(await statsOf()).toEqual([{ rush_att: 10 }, { rush_att: 10 }]);
  });

  it("changes nothing when the roster was saved again since the stats were read", async () => {
    const stale = await playerIds();
    // Saving the roster gives every player a new id; the stats saved above go with the old ones.
    await saveRoster(call("PUT", "/api/rosters", roster(teamId)));
    const ids = await playerIds();
    await putStats(
      call("PUT", `/api/rosters/${teamId}/stats`, { as_of: "2026-10-31", players: ids.map((id) => ({ id, stats: { rush_att: 3 }, lines: [] })) }),
      params(teamId),
    );
    expect(await statsOf()).toEqual([{ rush_att: 3 }, { rush_att: 3 }]);

    const response = await putStats(
      call("PUT", `/api/rosters/${teamId}/stats`, { as_of: "2026-11-01", players: stale.map((id) => ({ id, stats: { rush_att: 99 }, lines: [] })) }),
      params(teamId),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("Drop the stats sheet in again");
    // Nothing written, nothing cleared.
    expect(await statsOf()).toEqual([{ rush_att: 3 }, { rush_att: 3 }]);
  });
});
