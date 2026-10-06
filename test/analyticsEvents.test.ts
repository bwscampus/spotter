import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EVENT_NAMES,
  MAX_EVENTS_PER_REQUEST,
  MAX_PROPS_CHARS,
  parseBatch,
  sanitizeProps,
  sizeBucket,
  type DroppedProp,
} from "@/lib/analytics/events";
import { isLocalHost } from "@/lib/analytics/localHost";

const SESSION = "0b8f9f5e-7c1d-4f7a-9d3e-2a1b3c4d5e6f";
const GAME = "d6a4c3b2-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const NOW = new Date("2026-10-02T02:00:00.000Z");

describe("sanitizeProps", () => {
  it("keeps counts, flags, and a declared enum", () => {
    expect(sanitizeProps("account.signed_up", { method: "google", retries: 0, first: true })).toEqual({
      method: "google",
      retries: 0,
      first: true,
    });
  });

  it("drops a string that is not one of that key's declared values", () => {
    // A surname in lowercase is short and looks like a code. Only the enum list
    // can tell it apart, which is why strings must be declared.
    expect(sanitizeProps("account.signed_up", { method: "ossuetta" })).toEqual({});
    // game.started declares sport, and only Spotter's sports; school is not declared at all.
    expect(sanitizeProps("game.started", { sport: "ossuetta", school: "football" })).toEqual({});
  });

  it("drops a string longer than 40 characters even if someone declared it", () => {
    expect(sanitizeProps("account.signed_up", { method: "g".repeat(41) })).toEqual({});
  });

  it("drops roster text, objects and arrays, which is how player data would leak", () => {
    const roster = "22 Langan RB 11 5-10 180, 17 Ossuetta LB 12 6-0 205";
    expect(
      sanitizeProps("prep.roster_saved", {
        text: roster,
        players: [{ last_name: "Langan" }] as never,
        team: { school: "Estancia" } as never,
        players_count: 44,
      }),
    ).toEqual({ players_count: 44 });
  });

  it("drops null, undefined, NaN and Infinity", () => {
    expect(sanitizeProps("game.ended", { a: null, b: undefined, c: NaN, d: Infinity, e: 3 })).toEqual({ e: 3 });
  });

  it("drops keys that are not short snake_case codes", () => {
    expect(
      sanitizeProps("game.ended", { "Langan #22": 1, CamelCase: 1, ["x".repeat(41)]: 1, ok_key: 2 }),
    ).toEqual({ ok_key: 2 });
  });

  it("rounds numbers to three decimals", () => {
    expect(sanitizeProps("game.ended", { minutes: 1234.56789 })).toEqual({ minutes: 1234.568 });
  });

  it("stops adding keys before the props get large", () => {
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`count_${"n".repeat(20)}_${i}`, i]));
    const safe = sanitizeProps("game.ended", many);
    expect(JSON.stringify(safe).length).toBeLessThanOrEqual(MAX_PROPS_CHARS);
    expect(Object.keys(safe).length).toBeGreaterThan(0);
  });

  it("returns nothing for props that are not an object", () => {
    expect(sanitizeProps("game.ended", "Langan")).toEqual({});
    expect(sanitizeProps("game.ended", [1, 2])).toEqual({});
    expect(sanitizeProps("game.ended", null)).toEqual({});
  });

  it("reports the key and the reason for a drop, never the value", () => {
    const dropped: DroppedProp[] = [];
    sanitizeProps("account.signed_up", { method: "langan", note: { x: 1 } as never }, (d) => dropped.push(d));
    expect(dropped).toEqual([
      { key: "method", reason: "not_enum" },
      { key: "note", reason: "type" },
    ]);
    expect(JSON.stringify(dropped)).not.toContain("langan");
  });
});

describe("EVENT_NAMES", () => {
  // Re-enabled in security/db-auth, when the migrations move to db/migrations/.
  it.skip("matches the app_events check constraint exactly", () => {
    const dir = join(__dirname, "..", "supabase", "migrations");
    const sql = readdirSync(dir)
      .filter((file) => file.endsWith("_v3_app_events.sql"))
      .map((file) => readFileSync(join(dir, file), "utf8"))
      .join("\n");
    const block = sql.match(/name text not null check \(\s*name in \(([\s\S]*?)\)\s*\)/);
    expect(block).not.toBeNull();
    const inSql = [...block![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...EVENT_NAMES].sort());
  });
});

describe("parseBatch", () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    name: "account.signed_up",
    at: "2026-10-02T01:59:50.000Z",
    game_id: null,
    props: { method: "email" },
    ...overrides,
  });

  it("accepts a well-formed batch", () => {
    const parsed = parseBatch({ session_id: SESSION, app_version: "abc1234", events: [event()] }, NOW);
    expect(parsed).toEqual({
      sessionId: SESSION,
      appVersion: "abc1234",
      events: [{ name: "account.signed_up", at: "2026-10-02T01:59:50.000Z", game_id: null, props: { method: "email" } }],
    });
  });

  it("refuses a batch with no session id or no events list", () => {
    expect(parseBatch({ app_version: "abc1234", events: [] }, NOW)).toBeNull();
    expect(parseBatch({ session_id: "tab-1", events: [] }, NOW)).toBeNull();
    expect(parseBatch({ session_id: SESSION }, NOW)).toBeNull();
    expect(parseBatch("nope", NOW)).toBeNull();
  });

  it("drops events with names that are not in the vocabulary", () => {
    const parsed = parseBatch(
      { session_id: SESSION, events: [event({ name: "player.spotted" }), event(), "junk"] },
      NOW,
    );
    expect(parsed?.events).toHaveLength(1);
  });

  it("filters props again on the server, whatever the browser sent", () => {
    const parsed = parseBatch(
      { session_id: SESSION, events: [event({ props: { method: "email", surname: "langan", heard: "are gonna" } })] },
      NOW,
    );
    expect(parsed?.events[0].props).toEqual({ method: "email" });
  });

  it("keeps a valid game id and drops anything else", () => {
    const parsed = parseBatch(
      { session_id: SESSION, events: [event({ game_id: GAME }), event({ game_id: "Estancia vs Brentwood" })] },
      NOW,
    );
    expect(parsed?.events.map((e) => e.game_id)).toEqual([GAME, null]);
  });

  it("replaces an implausible timestamp with the server's clock", () => {
    const parsed = parseBatch(
      {
        session_id: SESSION,
        events: [event({ at: "1999-01-01T00:00:00Z" }), event({ at: "2030-01-01T00:00:00Z" }), event({ at: 7 })],
      },
      NOW,
    );
    expect(parsed?.events.map((e) => e.at)).toEqual([NOW.toISOString(), NOW.toISOString(), NOW.toISOString()]);
  });

  it("says unknown for an app version that is not a commit", () => {
    expect(parseBatch({ session_id: SESSION, app_version: "<script>", events: [] }, NOW)?.appVersion).toBe("unknown");
  });

  it("takes at most MAX_EVENTS_PER_REQUEST events", () => {
    const events = Array.from({ length: MAX_EVENTS_PER_REQUEST + 10 }, () => event({ name: "game.ended", props: {} }));
    expect(parseBatch({ session_id: SESSION, events }, NOW)?.events).toHaveLength(MAX_EVENTS_PER_REQUEST);
  });
});

describe("isLocalHost", () => {
  it("knows a development machine, port or no port", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1", "127.0.0.1:3000", "::1", "[::1]:3000", "0.0.0.0:3000"]) {
      expect(isLocalHost(host)).toBe(true);
    }
  });

  it("knows the names a phone uses to reach a dev server on the same network", () => {
    expect(isLocalHost("jeds-macbook.local:3000")).toBe(true);
    expect(isLocalHost("app.localhost")).toBe(true);
    expect(isLocalHost("spotter.test")).toBe(true);
  });

  it("lets the real thing through", () => {
    expect(isLocalHost("spotter-git-v3-jedsandler.vercel.app")).toBe(false);
    expect(isLocalHost("localhost.example.com")).toBe(false);
    expect(isLocalHost(null)).toBe(false);
  });
});

describe("prep import events", () => {
  it("keep their declared codes and counts", () => {
    expect(
      sanitizeProps("prep.import_finished", {
        kind: "roster",
        format: "xlsx",
        route: "text",
        ok: false,
        fail_code: "too_many_images",
        players_found: 0,
        ms: 1234,
      }),
    ).toEqual({ kind: "roster", format: "xlsx", route: "text", ok: false, fail_code: "too_many_images", players_found: 0, ms: 1234 });
    expect(sanitizeProps("prep.import_started", { kind: "roster", format: "image", size_bucket: "under_4mb", pages: 3 })).toEqual({
      kind: "roster",
      format: "image",
      size_bucket: "under_4mb",
      pages: 3,
    });
  });

  it("drop a file name, a surname or anything else that is not a declared code", () => {
    expect(
      sanitizeProps("prep.import_started", { kind: "roster", format: "Estancia Roster.pdf", file: "Estancia Roster.pdf" }),
    ).toEqual({ kind: "roster" });
    expect(sanitizeProps("prep.import_finished", { fail_code: "langan", format: "pdf" })).toEqual({ format: "pdf" });
  });

  it("buckets sizes so a size never identifies a file", () => {
    expect([50_000, 500_000, 3_000_000, 9_000_000].map(sizeBucket)).toEqual(["under_100kb", "under_1mb", "under_4mb", "4mb_plus"]);
  });
});

