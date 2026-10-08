import { describe, expect, it } from "vitest";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import { downloadName } from "@/lib/log/records";
import { foldStats, isStatsRecord, toStatsCsv, type LoggedPlay, type StatsRecord } from "@/lib/log/statsLog";

// Live stats in the browser log, and the stats .csv that Download writes
// beside the replay file and the match log. Made-up names only.

const GAME = "game-1";
const ROSTER: KeyedPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

const PLAY: LoggedPlay = {
  seqStart: 0,
  seqEnd: 1,
  quarter: 2,
  clock: "4:10",
  down: 3,
  distance: 4,
  offense: "home",
  playType: "run",
  nullified: false,
  touchdown: false,
  firstDown: false,
  confidence: 0.9,
  summary: "FENNIMORE 8 yd run",
  evidence: "fennimore up the middle, brought down by quillon",
  events: [],
};

const RUN = [
  { playerId: "H22-FENNIMORE", key: "rush_att" as const, amount: 1, estimated: false },
  { playerId: "H22-FENNIMORE", key: "rush_yds" as const, amount: 8, estimated: true },
  { playerId: "A17-QUILLON", key: "tkl" as const, amount: 1, estimated: false },
];

const records: Array<StatsRecord | { kind: string; [key: string]: unknown }> = [
  { kind: "game", gameId: GAME, at: 0, snapshot: { statsRoster: ROSTER } },
  { kind: "stats_play", gameId: GAME, at: 100, playId: "0-1", play: PLAY, changes: RUN, dropped: [] },
  {
    kind: "stats_play",
    gameId: GAME,
    at: 200,
    playId: "2-3",
    play: { ...PLAY, seqStart: 2, seqEnd: 3, summary: "=SUM(A1)", evidence: "incomplete" },
    changes: [],
    dropped: [{ playerId: "A17-QUILLON", action: "tackle", rule: "R2", reason: "no tackle on an incomplete pass" }],
  },
  { kind: "stats_play", gameId: GAME, at: 300, playId: "4-5", play: { ...PLAY, seqStart: 4, seqEnd: 5 }, changes: RUN, dropped: [] },
  { kind: "stats_decision", gameId: GAME, at: 400, playId: "0-1", decision: "ok" },
  { kind: "stats_decision", gameId: GAME, at: 410, playId: "0-1", decision: "edit", changes: [{ ...RUN[1], amount: null, estimated: false }] },
  { kind: "stats_decision", gameId: GAME, at: 420, playId: "2-3", decision: "discard" },
  // A decision about a play the log never read is ignored.
  { kind: "stats_decision", gameId: GAME, at: 430, playId: "9-9", decision: "ok" },
];

describe("folding the log", () => {
  it("leaves each play where its last decision put it, corrections included", () => {
    const folded = foldStats(records);
    expect(folded.map((play) => [play.playId, play.status, play.edited])).toEqual([
      ["0-1", "applied", true],
      ["2-3", "discarded", false],
      ["4-5", "pending", false],
    ]);
    expect(folded[0].changes).toEqual([{ ...RUN[1], amount: null, estimated: false }]);
    expect(folded[0].original).toEqual(RUN);
    expect(folded[0]).toMatchObject({ readAt: 100, decidedAt: 400 });
  });

  it("puts a play taken back with U back to waiting", () => {
    const folded = foldStats([...records, { kind: "stats_decision", gameId: GAME, at: 500, playId: "0-1", decision: "undo" }]);
    expect(folded[0]).toMatchObject({ status: "pending", decidedAt: 500 });
  });

  it("knows its own records from the rest of the log", () => {
    expect(isStatsRecord({ kind: "stats_switch" })).toBe(true);
    expect(isStatsRecord({ kind: "result" })).toBe(false);
  });
});

describe("the stats .csv", () => {
  const csv = toStatsCsv(records)!;
  const rows = csv.trim().split("\n");

  it("has one row per change, with the player's name, what was decided and what was heard", () => {
    expect(rows[0]).toBe(
      "time,quarter,clock,down,distance,play,status,corrected,player,side,jersey,stat,amount,worked_out,summary,heard,dropped",
    );
    expect(rows[1]).toMatch(
      /^\d\d:\d\d:\d\d,2,4:10,3,4,0-1,counted,yes,Reed Fennimore,home,22,Rush yds,\?,,FENNIMORE 8 yd run,"fennimore up the middle, brought down by quillon",$/,
    );
    // A play with nothing to change still has its row, so a discarded play and its rule are on record.
    expect(rows[2]).toMatch(/,2-3,discarded,no,,,,,,,'=SUM\(A1\),incomplete,R2 tackle$/);
    expect(rows.filter((row) => row.includes(",4-5,waiting,"))).toHaveLength(3);
    expect(rows[3]).toContain(",Reed Fennimore,home,22,Car,1,,");
    expect(rows[4]).toContain(",Rush yds,8,yes,");
    expect(rows[5]).toContain(",Marek Quillon,away,17,Tkl,1,,");
  });

  it("is not written for a game that read no plays", () => {
    expect(toStatsCsv([{ kind: "game" }, { kind: "result" }])).toBeNull();
  });

  it("is named beside the other two downloads", () => {
    expect(downloadName("stats", "0c5e7a1d-3b2f", new Date(2026, 9, 2, 19, 5))).toMatch(/^spotter-stats-20261002-1905-0c5e7a1d\.csv$/);
  });
});
