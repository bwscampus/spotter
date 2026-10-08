import { describe, expect, it } from "vitest";
import { replayRecorded } from "@/lib/livestats/recorded";
import type { StatsEvent, StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";

// The recorded replay (lib/livestats/recorded.ts): the replies a game got,
// through today's check and rules, beside what the game counted that night.
// Made-up names only; the log is built here, not downloaded.

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB", season: { pass_att: 120 } },
  { playerId: "H11-MARLOWE", side: "home", jersey: "11", first: "Ives", last: "Marlowe", position: "WR" },
  { playerId: "A24-MARLOWE", side: "away", jersey: "24", first: "Dane", last: "Marlowe", position: "CB" },
  { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
];

const ev = (playerId: string, action: StatsEvent["action"], yards: number | null = null): StatsEvent => ({
  playerId,
  action,
  yards,
  yardsSource: yards === null ? null : "stated",
  made: null,
});

function play(seqStart: number, seqEnd: number, summary: string, events: StatsEvent[], updates = ""): StatsPlay {
  return {
    seqStart,
    seqEnd,
    quarter: 1,
    clock: null,
    down: 1,
    distance: 10,
    offense: "home",
    playType: "pass",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary,
    evidence: "",
    events,
    updates,
  };
}

const CB_CATCH = play(0, 1, "CASTELLANE to MARLOWE for 9", [ev("H7-CASTELLANE", "pass_complete", 9), ev("A24-MARLOWE", "reception", 9)]);
const NO_PASSER = play(3, 4, "MARLOWE catch for 6", [ev("H11-MARLOWE", "reception", 6)]);
/** The replay of NO_PASSER: the reader said it updates 3-4, and that night's code counted it again anyway. */
const SECOND_READ = play(5, 5, "MARLOWE catch for 6, again", [ev("H11-MARLOWE", "reception", 6)], "3-4");

const GAME = "game-1";
const record = (kind: string, at: number, rest: Record<string, unknown>) => ({ kind, gameId: GAME, at, ...rest }) as unknown as StatsRecord;
const catchChanges = (playerId: string, yards: number) => [
  { playerId, key: "rec", amount: 1, estimated: false },
  { playerId, key: "rec_yds", amount: yards, estimated: false },
];

/** The log as the game wrote it that night: the old rules credited the other side's cornerback, charged no passer, and counted the replay again. */
function logOf(decisions: Array<"ok" | "discard">): StatsRecord[] {
  return [
    record("game", 0, { snapshot: { home: { id: "h", name: "Home" }, away: { id: "a", name: "Away" }, sport: "football", watchlist: [], keyterms: [], teamCues: [], statsEnabled: true, statsRoster: ROSTER } }),
    record("utterance", 10, { text: "castellane to marlowe for 9", offsetMs: 0, connectionId: 1 }),
    record("utterance", 11, { text: "brought down at the 40", offsetMs: 1000, connectionId: 1 }),
    record("utterance", 12, { text: "second and one", offsetMs: 2000, connectionId: 1 }),
    record("utterance", 13, { text: "marlowe catch for 6", offsetMs: 3000, connectionId: 1 }),
    record("utterance", 14, { text: "first down", offsetMs: 4000, connectionId: 1 }),
    record("utterance", 15, { text: "look at that marlowe catch again, six yards", offsetMs: 5000, connectionId: 1 }),
    record("stats_reply", 20, { ok: true, plays: [CB_CATCH], seqFrom: 0, seqTo: 1, tokensIn: 10, tokensOut: 5, tokensCached: 0 }),
    record("stats_play", 20, {
      playId: "0-1",
      play: CB_CATCH,
      changes: [
        { playerId: "H7-CASTELLANE", key: "pass_cmp", amount: 1, estimated: false },
        { playerId: "H7-CASTELLANE", key: "pass_att", amount: 1, estimated: false },
        { playerId: "H7-CASTELLANE", key: "pass_yds", amount: 9, estimated: false },
        ...catchChanges("A24-MARLOWE", 9),
      ],
      dropped: [],
    }),
    record("stats_decision", 21, { playId: "0-1", decision: decisions[0] }),
    // The second reply repeats the first play (the window overlaps; the watermark drops it) and adds one more.
    record("stats_reply", 40, { ok: true, plays: [CB_CATCH, NO_PASSER], seqFrom: 0, seqTo: 4, tokensIn: 10, tokensOut: 5, tokensCached: 0 }),
    record("stats_play", 40, { playId: "3-4", play: NO_PASSER, changes: catchChanges("H11-MARLOWE", 6), dropped: [] }),
    record("stats_decision", 41, { playId: "3-4", decision: decisions[1] }),
    // The third reply reads the replay as a new play.
    record("stats_reply", 60, { ok: true, plays: [SECOND_READ], seqFrom: 1, seqTo: 5, tokensIn: 10, tokensOut: 5, tokensCached: 0 }),
    record("stats_play", 60, { playId: "5-5", play: SECOND_READ, changes: catchChanges("H11-MARLOWE", 6), dropped: [] }),
    record("stats_decision", 61, { playId: "5-5", decision: decisions[2] }),
  ];
}

describe("replayRecorded", () => {
  it("counts what the game counted, then the same replies through today's code, and says what moved", () => {
    const result = replayRecorded(logOf(["ok", "ok", "ok"]), ROSTER);
    expect(result.replies).toBe(3);
    expect(result.readByGame).toBe(3);
    // The replay of the second catch folds into it: two plays, not three.
    expect(result.plays.map((play) => play.playId)).toEqual(["0-1", "3-4"]);

    // That night: the other side's cornerback got the catch, the second catch had no passer and was counted twice.
    expect(result.before.get("A24-MARLOWE")?.stats).toEqual({ rec: 1, rec_yds: 9 });
    expect(result.before.get("H7-CASTELLANE")?.stats).toEqual({ pass_cmp: 1, pass_att: 1, pass_yds: 9 });
    expect(result.before.get("H11-MARLOWE")?.stats).toEqual({ rec: 2, rec_yds: 12 });

    // Today: the cornerback's catch is dropped, not moved; a completion for each catch; each catch once.
    expect(result.after.has("A24-MARLOWE")).toBe(false);
    expect(result.after.get("H11-MARLOWE")?.stats).toEqual({ rec: 1, rec_yds: 6 });
    expect(result.after.get("H7-CASTELLANE")?.stats).toEqual({ pass_cmp: 2, pass_att: 2, pass_yds: 15 });
    expect(result.after.get("H7-CASTELLANE")?.estimated.sort()).toEqual(["pass_att", "pass_cmp", "pass_yds"]);

    expect(result.notes.map((entry) => `${entry.playId} ${entry.note.rule} ${entry.note.kind}`)).toEqual(["0-1 R12 dropped", "3-4 R16 filled"]);
  });

  it("applies the decisions the game made, by play id", () => {
    const result = replayRecorded(logOf(["ok", "discard", "ok"]), ROSTER);
    // A discarded play is not one a later read folds into, so the replay stands on its own, and counts as it did.
    expect(result.plays.map((play) => `${play.playId} ${play.status}`)).toEqual(["0-1 applied", "3-4 discarded", "5-5 applied"]);
    expect(result.after.get("H11-MARLOWE")?.stats).toEqual({ rec: 1, rec_yds: 6 });
  });

  it("says when a log has no recorded replies", () => {
    const result = replayRecorded(logOf(["ok", "ok", "ok"]).filter((entry) => entry.kind !== "stats_reply"), ROSTER);
    expect(result.replies).toBe(0);
    expect(result.plays).toEqual([]);
    expect(result.before.size).toBeGreaterThan(0);
  });
});

describe("replayRecorded reads the log's own lines", () => {
  it("checks each credit against the transcript lines the play was read from, not the summary", () => {
    const records = (logOf(["ok", "ok", "ok"]) as unknown as Array<{ kind: string; text?: string }>).map((record) =>
      record.kind === "utterance" && record.text === "marlowe catch for 6" ? { ...record, text: "a catch for 6" } : record,
    );
    const result = replayRecorded(records, ROSTER);
    // The summary still says MARLOWE, but the lines no longer do.
    expect(result.notes.map((entry) => `${entry.playId} ${entry.note.rule} ${entry.note.kind}`)).toContain("3-4 R18 dropped");
  });
});
