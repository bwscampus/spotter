import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVENT_NAMES } from "@/lib/analytics/events";
import { cardRemovedProps } from "@/lib/game/liveEvents";
import { EMPTY_COUNTS, endedEventProps } from "@/lib/game/liveCounts";
import { savedRosterProps } from "@/lib/rosters/editor";

// The metric views are SQL in a migration, applied with the Supabase connector,
// so the guarantees that matter are held here by reading the file: they live
// where nobody using the app can reach, they count production only, and they
// read events and properties that Spotter really sends.

const SQL = readFileSync(new URL("../db/migrations/0005_metrics_views.sql", import.meta.url), "utf8");
const CODE = SQL.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

const VIEWS = ["metrics_activation", "metrics_prep", "metrics_names", "metrics_stats", "metrics_retention", "metrics_feedback"];

/** The text of one view, from its create statement to the next. */
function viewText(name: string): string {
  const start = CODE.indexOf(`create view admin.${name} as`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = CODE.indexOf("create view admin.", start + 1);
  return CODE.slice(start, next === -1 ? undefined : next);
}

describe("where the views live", () => {
  it("are the six in the spec, all in admin, and nothing is created in public", () => {
    expect([...CODE.matchAll(/create view ([a-z_.]+) as/g)].map((match) => match[1])).toEqual(VIEWS.map((view) => `admin.${view}`));
    expect(CODE).not.toMatch(/create (or replace )?(view|table|function) public\./);
  });

  it("closes the schema to everyone but the owner, now or later", () => {
    expect(CODE).toMatch(/revoke all on schema admin from public;/);
    expect(CODE).toMatch(/alter default privileges in schema admin revoke all on tables from public;/);
    expect(CODE).toMatch(/revoke all on all tables in schema admin from public;/);
  });

  it("is never granted to the app's role (scripts/migrate.mjs grants the public schema only)", () => {
    const migrate = readFileSync(new URL("../scripts/migrate.mjs", import.meta.url), "utf8");
    expect(migrate).not.toMatch(/schema admin/);
    expect(migrate).toMatch(/grant usage on schema public to app_rw;/);
  });

  it("never grants anything", () => {
    expect(CODE).not.toMatch(/\bgrant\b/i);
  });
});

describe("what they count", () => {
  for (const view of VIEWS.filter((name) => name !== "metrics_feedback")) {
    it(`${view} counts production events only, every time it reads app_events`, () => {
      const text = viewText(view);
      const reads = [...text.matchAll(/public\.app_events/g)].length;
      const filtered = [...text.matchAll(/env = 'production'/g)].length;
      expect(reads).toBeGreaterThan(0);
      expect(filtered).toBe(reads);
    });
  }

  it("metrics_feedback counts only games that have a production event, since feedback has no env of its own", () => {
    const text = viewText("metrics_feedback");
    expect(text).toContain("public.game_feedback");
    expect(text).toMatch(/exists \(\s*select 1 from public\.app_events e\s*where e\.env = 'production' and e\.game_id = f\.game_id/);
  });

  it("reads only event names Spotter has, and never a preview or localhost row", () => {
    const named = [...CODE.matchAll(/name = '([a-z_.]+)'/g)].map((match) => match[1]);
    const listed = [...CODE.matchAll(/name in \(([^)]*)\)/g)].flatMap((match) => match[1].match(/'([a-z_.]+)'/g) ?? []).map((quoted) => quoted.slice(1, -1));
    expect(named.length).toBeGreaterThan(0);
    for (const name of [...named, ...listed]) expect(EVENT_NAMES as readonly string[], name).toContain(name);
    expect(CODE).not.toMatch(/env = 'preview'|env <> 'production'/);
  });
});

describe("what they leave out", () => {
  it("does not read the note, names, emails or any player detail", () => {
    // The note is only ever counted, never selected as a value.
    expect(viewText("metrics_feedback")).not.toMatch(/\bf\.note\b[^\n]*,\s*$|\bnote as\b|w\.note,|w\.note\)/);
    expect(CODE).not.toMatch(/\bemail\b/);
    expect(CODE).not.toMatch(/roster_players|last_name|first_name|jersey|transcript/);
  });
});

describe("the properties they read are the ones Spotter sends", () => {
  const readKeys = (text: string) => new Set([...text.matchAll(/props->>'([a-z0-9_]+)'/g)].map((match) => match[1]));

  it("game.ended: the counts and latencies endedEventProps writes", () => {
    const sent = new Set(Object.keys(endedEventProps(EMPTY_COUNTS, new Date(0), new Date(0))));
    for (const key of ["cards_shown", "cards_removed", "card_latency_p50_ms", "card_latency_p95_ms"]) expect(sent.has(key), key).toBe(true);
    const names = viewText("metrics_names");
    for (const key of ["cards_shown", "cards_removed", "card_latency_p50_ms", "card_latency_p95_ms"]) expect(names).toContain(`props->>'${key}'`);
  });

  it("names.card_removed: key, cue, match and seconds since shown", () => {
    const sent = Object.keys(
      cardRemovedProps({ kind: "name", cue: null, score: 1, threshold: 0.85, confidence: 1, cards: 1, digits: null, sound: false, matchesBefore: 0 }, "x", 1, 3),
    );
    for (const key of ["key", "cue", "match", "seconds_since_shown"]) {
      expect(sent, key).toContain(key);
      expect(viewText("metrics_names")).toContain(`props->>'${key}'`);
    }
  });

  it("prep.roster_saved: the counts savedRosterProps writes", () => {
    const sent = Object.keys(savedRosterProps([], [], 0, 60_000));
    const read = readKeys(viewText("metrics_prep").replace(/props->>'(kind|format|ok|ms)'/g, ""));
    for (const key of read) expect(sent, key).toContain(key);
    expect(read.size).toBeGreaterThan(4);
  });

  it("game.started: stats", () => {
    expect(viewText("metrics_stats")).toContain("props->>'stats'");
  });
});
