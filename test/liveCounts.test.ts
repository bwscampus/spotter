import { describe, expect, it } from "vitest";
import { startedRow } from "@/lib/game/calledGames";
import type { LoadedGame } from "@/lib/game/buildGame";
import {
  cardsRemoved,
  countMicStretch,
  countReconnect,
  countRefresh,
  countRemoval,
  countResult,
  EMPTY_COUNTS,
  endedEventProps,
  endedRow,
  MAX_LATENCY_SAMPLES,
  parseCounts,
  percentile,
  type LiveCounts,
} from "@/lib/game/liveCounts";
import type { LogRow } from "@/lib/matching/matchLog";

// The counts called_games gets at End game (docs/V3_DEFINITION.md 9.1) and
// game.ended carries (10.2). Counts only: nothing here says who.

const row = (type: LogRow["type"]): LogRow => ({
  at: "2026-09-25T19:03:00.000Z",
  type,
  name: "Langan",
  word: "langan",
  score: 1,
  threshold: 0.85,
  confidence: 0.9,
  source: "interim",
  latencyMs: null,
  domMs: null,
});

describe("counting a game", () => {
  it("counts a card for every match row, and nothing for near misses, repeats or retractions", () => {
    const counts = countResult(EMPTY_COUNTS, [row("match"), row("near_miss"), row("repeat"), row("retracted")], 40);
    expect(counts.cardsShown).toBe(1);
    expect(counts.latenciesMs).toEqual([40]);
  });

  it("leaves the counts alone when a result put nothing up", () => {
    expect(countResult(EMPTY_COUNTS, [row("near_miss")], null)).toBe(EMPTY_COUNTS);
  });

  it("keeps no latency for a card that was never painted (the tab was hidden)", () => {
    expect(countResult(EMPTY_COUNTS, [row("match")], null).latenciesMs).toEqual([]);
  });

  it("stops keeping latencies past the cap, but keeps counting cards", () => {
    const full: LiveCounts = { ...EMPTY_COUNTS, latenciesMs: Array(MAX_LATENCY_SAMPLES).fill(10) };
    const next = countResult(full, [row("match")], 99);
    expect(next.latenciesMs).toHaveLength(MAX_LATENCY_SAMPLES);
    expect(next.cardsShown).toBe(1);
  });

  it("counts removals by the key that did it", () => {
    let counts = countRemoval(EMPTY_COUNTS, "x");
    counts = countRemoval(counts, "x");
    counts = countRemoval(counts, "2");
    expect(counts.removedByKey).toEqual({ x: 2, "1": 0, "2": 1, "3": 0 });
    expect(cardsRemoved(counts)).toBe(3);
  });

  it("adds up mic stretches in whole seconds, and never subtracts", () => {
    let counts = countMicStretch(EMPTY_COUNTS, 61.4);
    counts = countMicStretch(counts, 30.6);
    counts = countMicStretch(counts, -5);
    expect(counts.micSeconds).toBe(92);
  });

  it("counts reconnects and refreshes", () => {
    const counts = countRefresh(countReconnect(countReconnect(EMPTY_COUNTS)));
    expect(counts.reconnects).toBe(2);
    expect(counts.refreshes).toBe(1);
  });

  it("never changes the counts it was given", () => {
    countRemoval(EMPTY_COUNTS, "1");
    countResult(EMPTY_COUNTS, [row("match")], 5);
    expect(EMPTY_COUNTS).toEqual({
      micSeconds: 0,
      reconnects: 0,
      cardsShown: 0,
      removedByKey: { x: 0, "1": 0, "2": 0, "3": 0 },
      refreshes: 0,
      latenciesMs: [],
    });
  });
});

describe("percentile", () => {
  it("is nearest rank, and null with nothing to rank", () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([30, 10, 20], 0.5)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 100], 0.95)).toBe(19);
    expect(percentile([7], 0.95)).toBe(7);
  });
});

const played: LiveCounts = {
  micSeconds: 6300,
  reconnects: 2,
  cardsShown: 234,
  removedByKey: { x: 14, "1": 2, "2": 6, "3": 2 },
  refreshes: 1,
  latenciesMs: [900, 1100, 1200, 1300, 3000],
};

describe("what End game writes to called_games", () => {
  it("is ended_at and the section 9.1 counts, with stat plays zero until live stats exist", () => {
    expect(endedRow(played, new Date("2026-09-25T21:05:00.000Z"))).toEqual({
      ended_at: "2026-09-25T21:05:00.000Z",
      mic_seconds: 6300,
      reconnects: 2,
      cards_shown: 234,
      cards_removed: 24,
      stat_plays_added: 0,
      stat_plays_undone: 0,
    });
  });
});

describe("game.ended", () => {
  it("carries minutes, the counts, removals by key, and card latency p50 and p95", () => {
    const props = endedEventProps(played, new Date("2026-09-25T19:03:00.000Z"), new Date("2026-09-25T21:05:00.000Z"));
    expect(props).toEqual({
      minutes: 122,
      mic_seconds: 6300,
      reconnects: 2,
      cards_shown: 234,
      cards_removed: 24,
      cards_removed_x: 14,
      cards_removed_1: 2,
      cards_removed_2: 6,
      cards_removed_3: 2,
      refreshes: 1,
      plays_applied: 0,
      plays_undone: 0,
      stats_off_mid_game: false,
      card_latency_p50_ms: 1200,
      card_latency_p95_ms: 3000,
    });
  });

  it("has only numbers and booleans in it, and a null latency with no cards", () => {
    const props = endedEventProps(EMPTY_COUNTS, new Date(0), new Date(0));
    expect(props.card_latency_p50_ms).toBeNull();
    for (const value of Object.values(props)) expect(["number", "boolean", "object"]).toContain(typeof value);
  });
});

describe("the row Start writes", () => {
  const loaded = {
    home: { id: "home-id", school: "Brentwood", mascot: "Eagles", sport: "football", playerCount: 50, offCount: 8, statsAsOf: null },
    away: { id: "away-id", school: "Estancia", mascot: "Matadors", sport: "football", playerCount: 44, offCount: 7, statsAsOf: null },
    sport: "football",
  } as unknown as LoadedGame;

  it("is the matchup, the sport and stats off, under the id the browser made", () => {
    expect(startedRow(loaded, "game-id", false)).toEqual({
      id: "game-id",
      home_roster_id: "home-id",
      away_roster_id: "away-id",
      home_school: "Brentwood",
      away_school: "Estancia",
      sport: "football",
      stats_enabled: false,
    });
  });

  it("writes no sport the column does not know", () => {
    expect(startedRow({ ...loaded, sport: "cricket" } as LoadedGame, "game-id", false).sport).toBeNull();
  });
});

describe("the counts mirrored in this browser", () => {
  it("come back as they went in", () => {
    expect(parseCounts(JSON.stringify(played))).toEqual(played);
  });

  it("are refused when anything in them is not a count", () => {
    expect(parseCounts(null)).toBeNull();
    expect(parseCounts("not json")).toBeNull();
    expect(parseCounts(JSON.stringify({ ...played, micSeconds: -1 }))).toBeNull();
    expect(parseCounts(JSON.stringify({ ...played, removedByKey: { x: 1 } }))).toBeNull();
    expect(parseCounts(JSON.stringify({ ...played, latenciesMs: ["fast"] }))).toBeNull();
  });
});
