import { describe, expect, it } from "vitest";
import type { ConnectionEventKind } from "@/lib/game/connectionWatch";
import { GAP_MARK_MS, gapLabel, gapsBetween, gapsOf, withGaps } from "@/lib/log/gaps";
import { toReplayFile, type ConnectionRecord } from "@/lib/log/records";
import { buildStatsReport, type ReportSheet } from "@/lib/log/statsReport";

// =============================================================================
// The connection record (Part 6, Oct 4): every event lands in the browser log
// and on the export's Events sheet, and a stretch with nothing heard gets a
// marker in the play by play. Made-up names only.
// =============================================================================

const START = 1_800_000_000_000;
const MINUTE = 60_000;

const KINDS: ConnectionEventKind[] = [
  "socket_open",
  "socket_closed",
  "reconnect",
  "mic_ended",
  "mic_muted",
  "mic_unmuted",
  "tab_hidden",
  "tab_visible",
  "wakelock_lost",
  "wakelock_regained",
  "alarm_on",
  "alarm_off",
  "timer_jump",
  "idle_stop",
];

function connection(at: number, event: ConnectionEventKind, extra: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return { kind: "connection", gameId: "game-1", at, event, ...extra };
}

const play = (seqStart: number, seqEnd: number) => ({
  seqStart,
  seqEnd,
  quarter: 2,
  clock: null,
  down: 1,
  distance: 10,
  offense: "home",
  playType: "run",
  nullified: false,
  touchdown: false,
  firstDown: false,
  confidence: 0.9,
  summary: `play ${seqStart}`,
  evidence: "",
  events: [],
});

const LOG = [
  { kind: "game", gameId: "game-1", at: START, snapshot: { home: { name: "Northfield" }, away: { name: "Westmere" }, statsRoster: [] } },
  { kind: "utterance", gameId: "game-1", at: START + 1_000, connectionId: 1, text: "vexley up the middle", offsetMs: 0 },
  { kind: "stats_play", gameId: "game-1", at: START + 2_000, playId: "0-0", play: play(0, 0), changes: [], dropped: [] },
  { kind: "stats_decision", gameId: "game-1", at: START + 2_000, playId: "0-0", decision: "ok" },
  connection(START + 3_000, "socket_closed", { code: 1006 }),
  connection(START + 13_000, "alarm_on", { reason: "socket_closed" }),
  connection(START + 13_000, "reconnect", { attempt: 1, reason: "socket_closed" }),
  { kind: "utterance", gameId: "game-1", at: START + 25 * MINUTE, connectionId: 2, text: "pruett makes the catch", offsetMs: 25 * MINUTE },
  connection(START + 25 * MINUTE, "alarm_off"),
  { kind: "stats_play", gameId: "game-1", at: START + 26 * MINUTE, playId: "1-1", play: play(1, 1), changes: [], dropped: [] },
  { kind: "stats_decision", gameId: "game-1", at: START + 26 * MINUTE, playId: "1-1", decision: "ok" },
];

function sheet(records: readonly { kind: string }[], name: string): ReportSheet {
  const found = buildStatsReport(records)?.sheets.find((each) => each.name === name);
  if (!found) throw new Error(`no ${name} sheet`);
  return found;
}

describe("gaps between words", () => {
  it("finds the stretches longer than a minute, oldest first, and not one of exactly a minute", () => {
    expect(gapsBetween([START, START + 10_000, START + 10_000 + GAP_MARK_MS, START + 5 * MINUTE])).toEqual([
      { from: START + 10_000 + GAP_MARK_MS, to: START + 5 * MINUTE },
    ]);
    expect(gapsBetween([START + 5 * MINUTE, START])).toEqual([{ from: START, to: START + 5 * MINUTE }]);
    expect(gapsBetween([])).toEqual([]);
  });

  it("reads them from a log's utterances with words", () => {
    expect(gapsOf(LOG)).toEqual([{ from: START + 1_000, to: START + 25 * MINUTE }]);
  });

  it("labels one as nothing heard between two clock times", () => {
    const label = gapLabel({ from: START + 1_000, to: START + 25 * MINUTE });
    expect(label).toMatch(/^Nothing heard .+ to .+$/);
    expect(label).toBe(
      `Nothing heard ${new Date(START + 1_000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} to ${new Date(START + 25 * MINUTE).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`,
    );
  });

  it("puts a gap where it fell in a newest-first list, and leaves out one older than the whole list", () => {
    const plays = [{ id: "c", at: START + 30 * MINUTE }, { id: "b", at: START + 26 * MINUTE }, { id: "a", at: START + 2_000 }];
    const placed = withGaps(plays, (each) => each.at, [
      { from: START + 1_000, to: START + 25 * MINUTE },
      { from: START - 10 * MINUTE, to: START - MINUTE },
    ]);
    expect(placed.map((entry) => (entry.kind === "gap" ? "gap" : entry.item.id))).toEqual(["c", "b", "gap", "a"]);
  });
});

describe("the export", () => {
  it("has an Events sheet with every kind of event in plain words", () => {
    const records = [...LOG, ...KINDS.map((kind, index) => connection(START + 40 * MINUTE + index * 1_000, kind))];
    const rows = sheet(records, "Events").rows;
    expect(rows).toHaveLength(4 + KINDS.length);
    expect(rows[0].slice(1)).toEqual(["Speech recognition connection closed", "close code 1006"]);
    expect(rows[1].slice(1)).toEqual(["Not hearing you", "the speech recognition connection is closed"]);
    expect(rows[2].slice(1)).toEqual(["Reconnect", "attempt 1, the speech recognition connection is closed"]);
    expect(rows[3].slice(1)).toEqual(["Hearing again", ""]);
    const words = rows.slice(4).map((row) => row[1]);
    expect(new Set(words).size).toBe(KINDS.length);
    expect(words).toContain("Clock jumped");
  });

  it("says why listening stopped on its own", () => {
    const rows = sheet([...LOG, connection(START + 50 * MINUTE, "idle_stop", { idle: "quiet", ms: 20 * MINUTE })], "Events").rows;
    expect(rows.at(-1)?.slice(1)).toEqual(["Listening stopped on its own", "1200 s, no words for too long"]);
  });

  it("marks a stretch with nothing heard in the play by play, between the plays around it", () => {
    const rows = sheet(LOG, "Play by play").rows;
    expect(rows.map((row) => row[9])).toEqual(["play 0", gapLabel({ from: START + 1_000, to: START + 25 * MINUTE }), "play 1"]);
    expect(rows[1][8]).toBe("nothing heard");
    expect(rows[1][0]).toBeNull();
  });

  it("carries connection records in the .json a replay reads", () => {
    const file = toReplayFile("game-1", LOG as never, new Date(START));
    expect(file.records.filter((record) => record.kind === "connection")).toHaveLength(4);
  });
});
