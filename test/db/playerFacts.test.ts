import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// db/migrations/0029_player_facts.sql against a real database (Nov 15): a
// player's storyline becomes their first fact, and save_roster saves, keeps,
// clears and refuses facts. The rows are put in the old shape by hand (a
// storyline and no facts), then the migration's own backfill is run again: it
// is a plain update the app's role may run, and idempotent.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

type User = { id: string; email: string; name: null; approved: boolean; isAdmin: boolean; signedInAt: Date };
let current: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: async () => current }));

import { PUT as saveRoster } from "@/app/api/rosters/route";
import { getPool, query, queryOne } from "@/lib/server/db";

const MIGRATION = readFileSync(new URL("../../db/migrations/0029_player_facts.sql", import.meta.url), "utf8");
const BACKFILL = MIGRATION.slice(MIGRATION.indexOf("-- BACKFILL START"), MIGRATION.indexOf("-- BACKFILL END"));

const call = (body: unknown) =>
  new Request("https://spotter.test/api/rosters", {
    method: "PUT",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const TEAM = { school: "Northfield", mascot: null, sport: "ice_hockey", gender: "boys", level: "varsity", season: "2026" };
const player = (jersey: string, last: string, extra: Record<string, unknown> = {}) => ({
  jersey,
  first_name: "Ada",
  last_name: last,
  pronunciations: [],
  spoken_forms: [last.toLowerCase()],
  spot_mode: "normal",
  ...extra,
});

let owner: User;
let rosterId: string;

async function factsOf(): Promise<Record<string, string[]>> {
  const rows = await query<{ jersey: string; facts: string[] }>("select jersey, facts from roster_players where roster_id = $1 order by jersey", [rosterId]);
  return Object.fromEntries(rows.map((row) => [row.jersey, row.facts]));
}

beforeAll(async () => {
  const row = await queryOne<{ id: string }>("insert into users (google_sub, email, approved) values ($1, $2, true) returning id", [
    `facts-${randomUUID()}`,
    `facts-${randomUUID()}@example.com`,
  ]);
  owner = { id: row!.id, email: "x@example.com", name: null, approved: true, isAdmin: false, signedInAt: new Date() };
  current = owner;
  const saved = await saveRoster(call({ p_roster: TEAM, p_players: [player("9", "Smith"), player("7", "Jones"), player("3", "Okafor")] }));
  expect(saved.status).toBe(200);
  rosterId = ((await saved.json()) as { id: string }).id;
});

afterAll(async () => {
  await query("delete from users where id = $1", [owner.id]);
  await getPool().end();
});

describe("0029: storylines become facts", () => {
  it("makes every saved storyline the player's first fact, and leaves the rest alone", async () => {
    // The shape a roster saved before facts has: a storyline, no facts.
    await query("update roster_players set storyline = 'Committed to Fresno State', facts = '{}' where roster_id = $1 and jersey = '9'", [rosterId]);
    await query("update roster_players set storyline = '', facts = '{}' where roster_id = $1 and jersey = '7'", [rosterId]);
    await query("update roster_players set storyline = 'Old line', facts = '{\"Typed since\"}' where roster_id = $1 and jersey = '3'", [rosterId]);
    await query(BACKFILL);
    expect(await factsOf()).toEqual({ "9": ["Committed to Fresno State"], "7": [], "3": ["Typed since"] });
  });

  it("changes nothing when run again", async () => {
    await query(BACKFILL);
    expect(await factsOf()).toEqual({ "9": ["Committed to Fresno State"], "7": [], "3": ["Typed since"] });
  });
});

describe("save_roster with facts", () => {
  it("saves every fact typed, empty ones dropped, and the first as the storyline", async () => {
    const saved = await saveRoster(
      call({
        p_roster: { ...TEAM, id: rosterId },
        p_players: [player("9", "Smith", { facts: ["Committed to Fresno State", "", "4-year starter"] }), player("7", "Jones", { facts: [] }), player("3", "Okafor")],
      }),
    );
    expect(saved.status).toBe(200);
    expect(await factsOf()).toEqual({ "9": ["Committed to Fresno State", "4-year starter"], "7": [], "3": ["Typed since"] });
    const first = await queryOne<{ storyline: string }>("select storyline from roster_players where roster_id = $1 and jersey = '9'", [rosterId]);
    expect(first?.storyline).toBe("Committed to Fresno State");
  });

  it("keeps a player's facts when an older page sends no facts, and takes an old storyline as one fact", async () => {
    await saveRoster(call({ p_roster: { ...TEAM, id: rosterId }, p_players: [player("9", "Smith"), player("7", "Jones", { storyline: "Back from injury" }), player("3", "Okafor")] }));
    expect(await factsOf()).toEqual({ "9": ["Committed to Fresno State", "4-year starter"], "7": ["Back from injury"], "3": ["Typed since"] });
  });

  it("refuses six facts, or one over 80 characters, and saves nothing", async () => {
    for (const facts of [["a", "b", "c", "d", "e", "f"], ["x".repeat(81)]]) {
      const refused = await saveRoster(call({ p_roster: { ...TEAM, id: rosterId }, p_players: [player("9", "Smith", { facts })] }));
      expect(refused.status).toBeGreaterThanOrEqual(400);
    }
    expect((await factsOf())["9"]).toEqual(["Committed to Fresno State", "4-year starter"]);
  });
});
