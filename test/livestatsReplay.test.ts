import { describe, expect, it } from "vitest";
import { applyPlay } from "@/lib/livestats/apply";
import { describeDrop, describePlay, header } from "@/lib/livestats/describe";
import { readReplayLog, ReplayLogError } from "@/lib/livestats/replayLog";
import { statsRoster } from "@/lib/livestats/roster";
import type { StatsEvent, StatsPlay } from "@/lib/livestats/types";

// =============================================================================
// What the replay harness reads and prints. The log is made up, with made-up
// names; a real log names minors and is never committed.
// =============================================================================

function player(jersey: string, first: string, last: string, position: string, side: "H" | "A") {
  return { jersey, first_name: first, last_name: last, position, grade: "12", height: null, weight: null, side, stat_lines: [] };
}

function gameRecord(at: number, watchlist: unknown[], extra: Record<string, unknown> = {}) {
  return {
    kind: "game",
    gameId: "g1",
    at,
    snapshot: {
      home: { id: "h", name: "Northfield", wearing: null },
      away: { id: "a", name: "Southpoint", wearing: null },
      sport: "football",
      watchlist,
      keyterms: [],
      teamCues: [],
      statsEnabled: false,
      ...extra,
    },
  };
}

const WATCHLIST = [
  { name: "Tarrow", aliases: [], players: [player("22", "Sam", "Tarrow", "RB", "H")] },
  { name: "Keslow", aliases: [], players: [player("44", "Abe", "Keslow", "LB", "A")] },
];

function utterance(at: number, text: string, offsetMs: number) {
  return { kind: "utterance", gameId: "g1", at, connectionId: 1, text, offsetMs };
}

const START = Date.parse("2026-10-01T19:00:00Z");

const LOG = {
  format: "spotter-v3-log",
  version: 1,
  gameId: "g1",
  exportedAt: "2026-10-01T21:00:00.000Z",
  records: [
    gameRecord(START - 1_000, WATCHLIST),
    utterance(START, "first and ten", 1_000),
    { kind: "result", gameId: "g1", at: START, connectionId: 1, is_final: true, speech_final: true, start: 0, duration: 1, transcript: "x", confidence: 1, words: [] },
    utterance(START + 5_000, "tarrow picks up 8 brought down by keslow", 6_000),
    // Refresh rosters: the game is rebuilt, and offsetMs starts again from zero.
    gameRecord(START + 9_000, [...WATCHLIST, { name: "Quell", aliases: [], players: [player("81", "Rio", "Quell", "WR", "H")] }]),
    utterance(START + 10_000, "second and two", 500),
    utterance(START + 12_000, "   ", 2_500),
  ],
};

describe("readReplayLog", () => {
  const game = readReplayLog(LOG);

  it("numbers what was said in the order it was said, skipping empty lines", () => {
    expect(game.utterances.map((u) => [u.seq, u.text])).toEqual([
      [0, "first and ten"],
      [1, "tarrow picks up 8 brought down by keslow"],
      [2, "second and two"],
    ]);
  });

  it("keeps a clock that only moves forward across a Refresh rosters", () => {
    expect(game.utterances.map((u) => u.offsetMs)).toEqual([0, 5_000, 10_000]);
  });

  it("follows the rosters as they were loaded", () => {
    expect(game.rosters).toHaveLength(2);
    expect(game.utterances.map((u) => u.roster)).toEqual([0, 0, 1]);
    expect(game.rosters[1].players.map((p) => p.playerId)).toEqual(["H22-TARROW", "H81-QUELL", "A44-KESLOW"]);
    expect(game.rosters.every((roster) => !roster.fullRoster)).toBe(true);
    expect(game).toMatchObject({ home: "Northfield", away: "Southpoint", sport: "football" });
  });

  it("uses both full rosters when a game record carries them", () => {
    const full = [
      { playerId: "H22-TARROW", side: "home", jersey: "22", first: "Sam", last: "Tarrow", position: "RB" },
      { playerId: "H66-HOLLIS", side: "home", jersey: "66", first: "Big", last: "Hollis", position: "OL" },
    ];
    const withFull = readReplayLog({ ...LOG, records: [gameRecord(START, WATCHLIST, { statsRoster: full }), ...LOG.records.slice(1)] });
    expect(withFull.rosters[0]).toEqual({ players: full, fullRoster: true });
  });

  it("refuses a file that is not a V3 log, or has nothing to replay", () => {
    expect(() => readReplayLog({ nope: true })).toThrow(ReplayLogError);
    expect(() => readReplayLog({ ...LOG, version: 2 })).toThrow(/version 2/);
    expect(() => readReplayLog({ ...LOG, records: LOG.records.filter((r) => r.kind !== "game") })).toThrow(/no game record/);
    expect(() => readReplayLog({ ...LOG, records: [LOG.records[0]] })).toThrow(/nothing said/);
  });
});

describe("the change strip text", () => {
  const roster = statsRoster(
    [{ jersey: "22", first_name: "Sam", last_name: "Langan", position: "RB" }],
    [{ jersey: "17", first_name: "Jo", last_name: "Ossuetta", position: "DB" }],
  );
  const ev = (playerId: string, action: StatsEvent["action"], yards: number | null = null, source: StatsEvent["yardsSource"] = yards === null ? null : "stated"): StatsEvent => ({
    playerId,
    action,
    yards,
    yardsSource: source,
    made: null,
  });
  const play = (events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay => ({
    seqStart: 1, seqEnd: 1, quarter: 2, clock: null, down: 3, distance: 4, offense: "home", playType: "run",
    nullified: false, touchdown: false, firstDown: false, confidence: 1, summary: "", evidence: "", events, ...extra,
  });

  it("reads like the spec's example", () => {
    const applied = applyPlay(play([ev("H22-LANGAN", "rush", 8), ev("A17-OSSUETTA", "tackle")]), roster);
    expect(describePlay(applied, roster)).toBe("Q2 3rd & 4 · LANGAN #22 +1 CAR +8 YDS · OSSUETTA #17 +1 TKL");
  });

  it("shows worked-out yards with ~, unknown yards as YDS ?, and a dropped event's rule", () => {
    const phrase = applyPlay(play([ev("H22-LANGAN", "rush", 2, "phrase")]), roster);
    expect(describePlay(phrase, roster)).toBe("Q2 3rd & 4 · LANGAN #22 +1 CAR ~2 YDS");
    const unknown = applyPlay(play([ev("H22-LANGAN", "rush"), ev("A12-NOBODY", "tackle")]), roster);
    expect(describePlay(unknown, roster)).toBe("Q2 3rd & 4 · LANGAN #22 +1 CAR YDS ? ! R9");
    expect(describeDrop(unknown.dropped[0], roster)).toBe("tackle by A12-NOBODY: R9, not on either roster");
  });

  it("says as much of the down and distance as was said", () => {
    expect(header({ quarter: null, down: null, distance: null })).toBe("");
    expect(header({ quarter: 5, down: 1, distance: null })).toBe("OT 1st down");
  });
});
