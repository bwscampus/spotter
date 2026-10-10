import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// db/migrations/0019_suffix_only_surnames.sql against a real database: a name
// split one word too late ("First Middle" / "II") gets its surname back, the
// way withoutSuffix fixes an import, and a one-word first name is left alone.
// The rows are put in the old, wrong shape by hand, then the migration's own
// SQL is run again (it is a plain update the app's role may run, and it is
// idempotent, so running it on every row of a test database is harmless).

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

type User = { id: string; email: string; name: null; approved: boolean; isAdmin: boolean; signedInAt: Date };
let current: User | null = null;
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/session", () => ({ readSession: async () => current }));

import { PUT as saveRoster } from "@/app/api/rosters/route";
import { getPool, query, queryOne } from "@/lib/server/db";

const MIGRATION = readFileSync(new URL("../../db/migrations/0019_suffix_only_surnames.sql", import.meta.url), "utf8");
const call = (body: unknown) =>
  new Request("https://spotter.test/api/rosters", {
    method: "PUT",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

let owner: User;
let rosterId: string;

beforeAll(async () => {
  const row = await queryOne<{ id: string }>("insert into users (google_sub, email, approved) values ($1, $2, true) returning id", [
    `suffix-${randomUUID()}`,
    `suffix-${randomUUID()}@example.com`,
  ]);
  owner = { id: row!.id, email: "x@example.com", name: null, approved: true, isAdmin: false, signedInAt: new Date() };
  current = owner;
  const player = (jersey: string, first: string, last: string) => ({ jersey, first_name: first, last_name: last, pronunciations: [], spoken_forms: [], spot_mode: "normal" });
  const saved = await saveRoster(
    call({
      p_roster: { school: "Northfield", mascot: null, sport: "football", gender: "boys", level: "varsity", season: "2026" },
      p_players: [player("33", "Tobin", "Placeholder"), player("4", "Rafe", "Placeholder"), player("8", "Cy", "Placeholder"), player("9", "Ned", "Ostrander")],
    }),
  );
  rosterId = ((await saved.json()) as { id: string }).id;
  // The shape a roster saved before the suffix fix could have.
  const set = (jersey: string, first: string, last: string) =>
    query("update roster_players set first_name = $1, last_name = $2 where roster_id = $3 and jersey = $4", [first, last, rosterId, jersey]);
  await set("33", "Tobin Halvorsen", "II");
  await set("4", "Rafe Quill", "Jr.");
  await set("8", "Cy", "II");
});

afterAll(async () => {
  await query("delete from users where id = $1", [owner.id]);
  await getPool().end();
});

describe("0019: a surname that is only a suffix", () => {
  it("takes the first name's last word as the surname, and leaves a one-word first name alone", async () => {
    await query(MIGRATION);
    const rows = await query<{ jersey: string; first_name: string | null; last_name: string }>(
      "select jersey, first_name, last_name from roster_players where roster_id = $1 order by jersey",
      [rosterId],
    );
    const names = Object.fromEntries(rows.map((row) => [row.jersey, `${row.first_name} / ${row.last_name}`]));
    expect(names).toEqual({ "33": "Tobin / Halvorsen", "4": "Rafe / Quill", "8": "Cy / II", "9": "Ned / Ostrander" });
  });

  it("changes nothing when run again", async () => {
    await query(MIGRATION);
    const rows = await query<{ last_name: string }>("select last_name from roster_players where roster_id = $1 order by jersey", [rosterId]);
    expect(rows.map((row) => row.last_name)).toEqual(["Halvorsen", "Quill", "II", "Ostrander"]);
  });
});
