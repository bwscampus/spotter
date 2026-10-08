import { describe, expect, it } from "vitest";
import { cardLines, lineText } from "@/lib/cards/lines";
import { tallyChanges } from "@/lib/cards/tonight";
import type { StatsRecord } from "@/lib/log/statsLog";
import {
  changesOf,
  correctPlay,
  counted,
  discardPlay,
  EMPTY_SESSION,
  linesOf,
  okPlay,
  readPlays,
  recentSummaries,
  restoreFromLog,
  talliesOf,
  undoLast,
  waiting,
  watermarkOf,
  type StatsSession,
} from "@/lib/livestats/session";
import { applyPlay } from "@/lib/livestats/apply";
import type { StatsEvent, StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";

// One game's live stats as the announcer works them (docs/V3_DEFINITION.md
// 8.6, as Jed set it on Oct 2): every play waits for his OK, nothing is ever
// skipped, U puts the last OK back in line, and any word can be corrected.
// Made-up names only.

const ROSTER: StatsRosterPlayer[] = [
  {
    playerId: "H22-FENNIMORE",
    side: "home",
    jersey: "22",
    first: "Reed",
    last: "Fennimore",
    position: "RB",
    season: { gp: 5, rush_att: 71, rush_yds: 455, rush_td: 4 },
  },
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
  { playerId: "A24-ASHGROVE", side: "away", jersey: "24", first: "Penn", last: "Ashgrove", position: "DB" },
];

const ev = (playerId: string, action: StatsEvent["action"], yards: number | null = null, yardsSource: StatsEvent["yardsSource"] = yards === null ? null : "stated"): StatsEvent => ({
  playerId,
  action,
  yards,
  yardsSource,
  made: null,
});

function play(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
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
    summary: `play ${seqStart}-${seqEnd}`,
    // Names everyone on the play: the check drops a credit the words do not name (R18).
    evidence: `${events.map((event) => event.playerId.split("-")[1].toLowerCase()).join(" ")} up the middle`,
    events,
    ...extra,
  };
}

const RUN = play(0, 1, [ev("H22-FENNIMORE", "rush", 8), ev("A17-QUILLON", "tackle")]);
const PASS = play(2, 3, [ev("H7-CASTELLANE", "pass_complete", 12), ev("H81-PREWITT", "reception", 12), ev("A24-ASHGROVE", "tackle")], {
  playType: "pass",
  summary: "CASTELLANE to PREWITT for 12",
});
const SPOTS = play(4, 5, [ev("H22-FENNIMORE", "rush", 6, "spots")]);

function withPlays(...plays: StatsPlay[]): StatsSession {
  return readPlays(EMPTY_SESSION, plays, ROSTER, 1000).session;
}

describe("reading plays in", () => {
  it("puts every new play at the back of the line, waiting, one item per change", () => {
    const { session, added } = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000);
    expect(added).toHaveLength(1);
    expect(session.plays[0]).toMatchObject({ playId: "0-1", status: "pending", edited: false, readAt: 1000, decidedAt: null });
    // LANGAN #22 +1 CAR, +8 RUSH YDS, OSSUETTA #17 +1 TKL, in Jed's example's shape.
    expect(session.plays[0].changes).toEqual([
      { playerId: "H22-FENNIMORE", key: "rush_att", amount: 1, estimated: false },
      { playerId: "H22-FENNIMORE", key: "rush_yds", amount: 8, estimated: false },
      { playerId: "A17-QUILLON", key: "tkl", amount: 1, estimated: false },
    ]);
    expect(session.plays[0].original).toEqual(session.plays[0].changes);
  });

  it("marks worked-out yards, and leaves a ? for yards nobody said", () => {
    expect(changesOf(applyPlay(SPOTS, ROSTER))).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 6, estimated: true });
    const unknown = changesOf(applyPlay(play(6, 6, [ev("H22-FENNIMORE", "rush")]), ROSTER));
    expect(unknown).toEqual([
      { playerId: "H22-FENNIMORE", key: "rush_att", amount: 1, estimated: false },
      { playerId: "H22-FENNIMORE", key: "rush_yds", amount: null, estimated: false },
    ]);
  });

  it("keeps what the rules dropped beside the play, with the rule", () => {
    const broken = play(7, 7, [ev("H7-CASTELLANE", "pass_incomplete"), ev("A24-ASHGROVE", "pass_breakup"), ev("A17-QUILLON", "tackle")], {
      playType: "pass",
    });
    const { added } = readPlays(EMPTY_SESSION, [broken], ROSTER, 0);
    expect(added[0].dropped).toEqual([expect.objectContaining({ playerId: "A17-QUILLON", action: "tackle", rule: "R2" })]);
    expect(added[0].changes.map((change) => change.key)).not.toContain("tkl");
  });

  it("folds the same play read again into the first, and never gives two plays the same id", () => {
    // The same lines: a later read of the one play (lib/livestats/merge.ts).
    const again = readPlays(withPlays(RUN), [{ ...RUN, summary: "again" }], ROSTER, 2000);
    expect(again.session.plays.map((each) => each.playId)).toEqual(["0-1"]);
    expect(again.added).toEqual([]);
    // The same lines, whatever the play type: still that play (Oct 6).
    const other = readPlays(withPlays(RUN), [{ ...PASS, seqStart: 0, seqEnd: 1, down: 4 }], ROSTER, 2000);
    expect(other.session.plays.map((each) => each.playId)).toEqual(["0-1"]);
    // Once that play is thrown away, the same lines are a new play with its own id.
    const thrown = discardPlay(withPlays(RUN), 1500, "0-1").session;
    const fresh = readPlays(thrown, [{ ...PASS, seqStart: 0, seqEnd: 1 }], ROSTER, 2000);
    expect(fresh.session.plays.map((each) => each.playId)).toEqual(["0-1", "0-1-2"]);
  });
});

describe("the announcer's answers", () => {
  it("OKs the front of the line, or the play clicked", () => {
    const session = withPlays(RUN, PASS);
    const front = okPlay(session, 5000);
    expect(front.play?.playId).toBe("0-1");
    expect(front.play).toMatchObject({ status: "applied", decidedAt: 5000 });
    const clicked = okPlay(session, 5000, "2-3");
    expect(clicked.play?.playId).toBe("2-3");
    expect(waiting(clicked.session).map((each) => each.playId)).toEqual(["0-1"]);
  });

  it("does nothing when nothing is waiting, or the play clicked is not waiting", () => {
    expect(okPlay(EMPTY_SESSION, 1).play).toBeNull();
    const done = okPlay(withPlays(RUN), 1).session;
    expect(okPlay(done, 2, "0-1").play).toBeNull();
    expect(discardPlay(done, 2, "0-1").play).toBeNull();
    expect(okPlay(done, 2, "nope").play).toBeNull();
  });

  it("never skips a play: an unanswered one waits at the front however many come after it", () => {
    let session = withPlays(RUN);
    session = readPlays(session, [PASS, SPOTS], ROSTER, 9000).session;
    expect(waiting(session).map((each) => each.playId)).toEqual(["0-1", "2-3", "4-5"]);
    // Nothing counts until it is OK'd.
    expect(talliesOf(session).size).toBe(0);
    expect(linesOf(session, ROSTER).size).toBe(0);
  });

  it("counts only what was OK'd", () => {
    const session = okPlay(withPlays(RUN, PASS), 10).session;
    const tallies = talliesOf(session);
    expect(tallies.get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 8 });
    expect(tallies.get("A17-QUILLON")?.stats).toEqual({ tkl: 1 });
    expect(tallies.has("H81-PREWITT")).toBe(false);
  });

  it("throws a discarded play away: it never counts and Claude is not told about it again", () => {
    const step = discardPlay(withPlays(RUN, PASS), 10);
    expect(step.play).toMatchObject({ playId: "0-1", status: "discarded" });
    expect(talliesOf(step.session).size).toBe(0);
    expect(waiting(step.session).map((each) => each.playId)).toEqual(["2-3"]);
    expect(recentSummaries(step.session, 5)).toEqual(["CASTELLANE to PREWITT for 12"]);
  });

  it("takes back the last OK with U: it stops counting and goes back in line, and U again takes the one before", () => {
    let session = okPlay(withPlays(RUN, PASS), 10).session;
    session = okPlay(session, 20).session;
    expect(counted(session).map((each) => each.playId)).toEqual(["2-3", "0-1"]);

    const first = undoLast(session, 30);
    expect(first.play).toMatchObject({ playId: "2-3", status: "pending", decidedAt: 30 });
    expect(talliesOf(first.session).has("H81-PREWITT")).toBe(false);
    expect(talliesOf(first.session).get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 8 });

    const second = undoLast(first.session, 40);
    expect(second.play?.playId).toBe("0-1");
    expect(talliesOf(second.session).size).toBe(0);
    // Both back in line, in the order they were read.
    expect(waiting(second.session).map((each) => each.playId)).toEqual(["0-1", "2-3"]);
    expect(undoLast(second.session, 50).play).toBeNull();
  });

  it("with three plays OK'd in the same millisecond, U takes back the newest of them, then the one before (M6)", () => {
    // One reply of three plays, all counted at once: the same decidedAt.
    let session = withPlays(RUN, PASS, SPOTS);
    for (let i = 0; i < 3; i++) session = okPlay(session, 10).session;
    expect(counted(session).map((each) => each.playId)).toEqual(["4-5", "2-3", "0-1"]);

    const first = undoLast(session, 20);
    expect(first.play?.playId).toBe("4-5");
    expect(counted(first.session)[0].playId).toBe("2-3");
    const second = undoLast(first.session, 30);
    expect(second.play?.playId).toBe("2-3");
    expect(undoLast(second.session, 40).play?.playId).toBe("0-1");
  });

  it("still puts the most recently OK'd first when the times differ, whatever order the plays were read in", () => {
    let session = withPlays(RUN, PASS, SPOTS);
    session = okPlay(session, 30, "0-1").session;
    session = okPlay(session, 20, "4-5").session;
    session = okPlay(session, 10, "2-3").session;
    expect(counted(session).map((each) => each.playId)).toEqual(["0-1", "4-5", "2-3"]);
    expect(undoLast(session, 40).play?.playId).toBe("0-1");
  });

  it("undoing exactly reverses the play: the tallies are what they were before it was OK'd", () => {
    const before = okPlay(withPlays(RUN, PASS), 10).session;
    const after = okPlay(before, 20).session;
    expect(talliesOf(undoLast(after, 30).session)).toEqual(talliesOf(before));
  });
});

describe("corrections", () => {
  const session = withPlays(RUN);

  it("a new name moves every item of that player on the play, because a misheard name is misheard for the whole play", () => {
    const step = correctPlay(session, "0-1", { type: "player", index: 1, playerId: "H7-CASTELLANE" });
    expect(step.play?.edited).toBe(true);
    expect(step.play?.changes.map((change) => change.playerId)).toEqual(["H7-CASTELLANE", "H7-CASTELLANE", "A17-QUILLON"]);
    // What the rules first worked out stays, for the log.
    expect(step.play?.original.map((change) => change.playerId)).toEqual(["H22-FENNIMORE", "H22-FENNIMORE", "A17-QUILLON"]);
  });

  it("a stat changes just that item", () => {
    const step = correctPlay(session, "0-1", { type: "stat", index: 2, key: "pbu" });
    expect(step.play?.changes[2]).toEqual({ playerId: "A17-QUILLON", key: "pbu", amount: 1, estimated: false });
  });

  it("a typed amount is the announcer's own number, so it is no longer worked out", () => {
    const spots = withPlays(SPOTS);
    const index = spots.plays[0].changes.findIndex((change) => change.key === "rush_yds");
    const step = correctPlay(spots, "4-5", { type: "amount", index, amount: 9 });
    expect(step.play?.changes[index]).toEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 9, estimated: false });
    const unknown = correctPlay(spots, "4-5", { type: "amount", index, amount: null });
    expect(unknown.play?.changes[index].amount).toBeNull();
    expect(correctPlay(spots, "4-5", { type: "amount", index, amount: Number.NaN }).play?.changes[index].amount).toBeNull();
  });

  it("removes an item, and adds one Spotter missed", () => {
    const removed = correctPlay(session, "0-1", { type: "remove", index: 2 });
    expect(removed.play?.changes).toHaveLength(2);
    const added = correctPlay(session, "0-1", {
      type: "add",
      change: { playerId: "A24-ASHGROVE", key: "tkl", amount: 1, estimated: false },
    });
    expect(added.play?.changes.at(-1)).toEqual({ playerId: "A24-ASHGROVE", key: "tkl", amount: 1, estimated: false });
  });

  it("corrects a play already counted, and the tallies follow", () => {
    const applied = okPlay(session, 10).session;
    const step = correctPlay(applied, "0-1", { type: "amount", index: 1, amount: 3 });
    expect(step.play?.status).toBe("applied");
    expect(talliesOf(step.session).get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 3 });
  });

  it("will not correct a discarded play, a missing play or a missing item", () => {
    const discarded = discardPlay(session, 10).session;
    expect(correctPlay(discarded, "0-1", { type: "remove", index: 0 }).play).toBeNull();
    expect(correctPlay(session, "nope", { type: "remove", index: 0 }).play).toBeNull();
    expect(correctPlay(session, "0-1", { type: "remove", index: 9 }).play).toBeNull();
  });
});

describe("what it adds up to", () => {
  it("gives each player with something tonight the card lines: the season plus tonight, and tonight", () => {
    const session = okPlay(withPlays(RUN), 10).session;
    const lines = linesOf(session, ROSTER);
    const fennimore = lines.get("H22-FENNIMORE")!;
    expect(fennimore).toEqual(cardLines(ROSTER[0].season!, tallyChanges(session.plays[0].changes).get("H22-FENNIMORE")!));
    expect(lineText(fennimore.tonight)).toBe("1 car · 8 yds");
    // One stat a row (Oct 5): all three, the carries ranked last, so a card with two season rows drops them.
    expect(lineText(fennimore.season)).toBe("72 car · 463 yds · 4 TD");
    expect(fennimore.season.map((item) => item.rank)).toEqual([2, 0, 1]);
    // No season stats uploaded: tonight only.
    expect(lines.get("A17-QUILLON")?.season).toEqual([]);
    expect(lineText(lines.get("A17-QUILLON")?.tonight ?? [])).toBe("1 tkl");
    expect(lines.has("H81-PREWITT")).toBe(false);
  });

  it("knows how far reading has got, kept or not", () => {
    expect(watermarkOf(EMPTY_SESSION, -1)).toBe(-1);
    expect(watermarkOf(discardPlay(withPlays(RUN, PASS), 1).session, -1)).toBe(3);
  });

  it("tells Claude the last few plays it read, oldest first", () => {
    expect(recentSummaries(withPlays(RUN, PASS, SPOTS), 2)).toEqual(["CASTELLANE to PREWITT for 12", "play 4-5"]);
  });
});

describe("after a reload", () => {
  const GAME = "game";
  const records: Array<StatsRecord | { kind: string; [key: string]: unknown }> = [
    { kind: "utterance", gameId: GAME, at: 100, connectionId: 1, text: "fennimore up the middle", offsetMs: 0 },
    { kind: "utterance", gameId: GAME, at: 200, connectionId: 1, text: "   ", offsetMs: 100 },
    { kind: "utterance", gameId: GAME, at: 300, connectionId: 1, text: "brought down by quillon", offsetMs: 200 },
    { kind: "stats_reply", gameId: GAME, at: 400, ok: true, plays: [], tokensIn: 900, tokensOut: 120, tokensCached: 800 },
    { kind: "stats_reply", gameId: GAME, at: 410, ok: false, code: "claude_timeout", tokensIn: 5 },
    {
      kind: "stats_play",
      gameId: GAME,
      at: 400,
      playId: "0-1",
      play: RUN,
      changes: changesOf(applyPlay(RUN, ROSTER)),
      dropped: [],
    },
    { kind: "stats_play", gameId: GAME, at: 400, playId: "2-3", play: PASS, changes: changesOf(applyPlay(PASS, ROSTER)), dropped: [] },
    { kind: "stats_decision", gameId: GAME, at: 500, playId: "0-1", decision: "ok" },
    {
      kind: "stats_decision",
      gameId: GAME,
      at: 510,
      playId: "0-1",
      decision: "edit",
      changes: [{ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 5, estimated: false }],
    },
    { kind: "stats_decision", gameId: GAME, at: 520, playId: "2-3", decision: "ok" },
    { kind: "stats_decision", gameId: GAME, at: 530, playId: "2-3", decision: "undo" },
    { kind: "stats_switch", gameId: GAME, at: 600, on: false },
  ];

  it("rebuilds the line, the decisions, the corrections, the switch and the counts from the log", () => {
    const restored = restoreFromLog(records);
    expect(restored.session.plays.map((each) => [each.playId, each.status, each.edited])).toEqual([
      ["0-1", "applied", true],
      ["2-3", "pending", false],
    ]);
    expect(restored.session.plays[0].changes).toEqual([{ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 5, estimated: false }]);
    expect(talliesOf(restored.session).get("H22-FENNIMORE")?.stats).toEqual({ rush_yds: 5 });
    expect(restored).toMatchObject({
      on: false,
      offMidGame: true,
      playsApplied: 2,
      playsUndone: 1,
      // A failed call used nothing.
      tokensIn: 900,
      tokensOut: 120,
      tokensCached: 800,
    });
  });

  it("numbers what was said the way the replay does: blank finals are not utterances", () => {
    expect(restoreFromLog(records).utterances).toEqual([
      { text: "fennimore up the middle", at: 100 },
      { text: "brought down by quillon", at: 300 },
    ]);
  });

  it("starts a game with nothing in its log on, with nothing in line", () => {
    expect(restoreFromLog([])).toMatchObject({ on: true, offMidGame: false, playsApplied: 0, session: { plays: [] } });
  });
});
