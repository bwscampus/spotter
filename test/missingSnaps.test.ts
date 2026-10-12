import { describe, expect, it } from "vitest";
import { GAP_REREADS_PER_GAME, StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { GAP_REREAD_PROMPT, volatileContent } from "@/lib/livestats/extract";
import { readGap, readRequest } from "@/lib/livestats/request";
import { addInferredIncompletion, EMPTY_SESSION, inferredIncompletion, ledgerGaps, okPlay, readPlays, restoreFromLog, type StatsSession } from "@/lib/livestats/session";
import { NO_PENALTY, NO_USAGE, type Action, type ExtractStatsRequest, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";

// =============================================================================
// Missing snaps (fix 6, Part 3): the ledger's gaps, the gap re-read (R44) and
// the incomplete pass inferred for a gap that moved nothing (R45). Made-up
// names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Dax", last: "Prewitt", position: "WR" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}
function play(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
    quarter: 1,
    clock: null,
    down: 1,
    distance: 10,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: "a play",
    evidence: events.map((e) => e.playerId.split("-")[1].toLowerCase()).join(" "),
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: NO_PENALTY,
    ...extra,
  };
}
const run = (seqStart: number, seqEnd: number, yards: number | null, extra: Partial<StatsPlay> = {}) => play(seqStart, seqEnd, [ev("H22-FENNIMORE", "rush", yards)], extra);

function counted(plays: StatsPlay[]): StatsSession {
  let session = EMPTY_SESSION;
  for (const each of plays) {
    const read = readPlays(session, [each], ROSTER, 1000);
    session = read.session;
    for (const added of read.added) session = okPlay(session, 1001, added.playId).session;
  }
  return session;
}

describe("the gaps the ledger reports", () => {
  it("a first down made and then a 2nd down: the 1st-down snap was never read", () => {
    // 3rd and 2, a 5-yard run (the first down), then a play at 2nd and 10.
    const session = counted([run(1, 2, 5, { down: 3, distance: 2 }), run(8, 9, 3, { down: 2, distance: 10 })]);
    const gaps = ledgerGaps(session, ROSTER);
    expect(gaps).toEqual([
      { offense: "home", beforeId: "1-2", afterId: "8-9", before: { down: 1, distance: 10, spot: null }, after: { down: 2, distance: 10, spot: null }, yards: 0, snaps: 1 },
    ]);
  });

  it("downs that skip one, a gap with a yard change, and no gap when the downs follow", () => {
    const skipped = counted([run(1, 2, 3, { down: 1, distance: 10 }), run(8, 9, 2, { down: 3, distance: 3 })]);
    expect(ledgerGaps(skipped, ROSTER)).toEqual([expect.objectContaining({ before: { down: 2, distance: 7, spot: null }, after: { down: 3, distance: 3, spot: null }, yards: 4, snaps: 1 })]);
    expect(ledgerGaps(counted([run(1, 2, 3, { down: 1, distance: 10 }), run(8, 9, 2, { down: 2, distance: 7 })]), ROSTER)).toEqual([]);
    // A 1st down after a 3rd down with the gain unknown: a first down made, not a gap.
    expect(ledgerGaps(counted([run(1, 2, null, { down: 3, distance: 2 }), run(8, 9, 2, { down: 1, distance: 10 })]), ROSTER)).toEqual([]);
  });

  it("knows an incomplete pass from a gap that moved nothing, and nothing else", () => {
    const gap = { offense: "home" as const, beforeId: "1-2", afterId: "8-9", before: { down: 1, distance: 10, spot: 30 }, after: { down: 2, distance: 10, spot: 30 }, yards: 0, snaps: 1 };
    expect(inferredIncompletion(gap, "castellane looking throws it away")).toBe(true);
    expect(inferredIncompletion(gap, "fennimore stopped for no gain")).toBe(false);
    expect(inferredIncompletion(gap, "there is a flag on the play")).toBe(false);
    expect(inferredIncompletion({ ...gap, after: { ...gap.after, distance: 6 } }, "")).toBe(false);
    expect(inferredIncompletion({ ...gap, after: { ...gap.after, spot: 34 } }, "")).toBe(false);
    expect(inferredIncompletion({ ...gap, snaps: 2 }, "")).toBe(false);
    const step = addInferredIncompletion(EMPTY_SESSION, gap, { seqFrom: 3, seqTo: 7 }, ROSTER, 5000);
    expect(step.play?.playId).toBe("gap-3-7");
    expect(step.play?.play).toMatchObject({ seqStart: 3, seqEnd: 7, down: 1, distance: 10, playType: "pass", confidence: 0.5 });
    expect(step.play?.changes).toEqual([{ playerId: "H7-CASTELLANE", key: "pass_att", amount: 1, estimated: true }]);
    expect(step.play?.dropped[0]).toMatchObject({ rule: "R45", kind: "filled", to: "H7-CASTELLANE" });
  });
});

describe("the loop", () => {
  const START = 1_800_000_000_000;
  function harness(log: readonly { kind: string }[] = []) {
    let now = START;
    const requests: ExtractStatsRequest[] = [];
    const answers: Array<(reply: ExtractReply) => void> = [];
    const logged: StatsRecord[] = [];
    const controller = new StatsController({
      gameId: "g1",
      startedAt: START,
      roster: ROSTER,
      autoOk: true,
      deps: {
        extract: (request) => {
          requests.push(request);
          return new Promise((resolve) => answers.push(resolve));
        },
        log: (record) => logged.push(record),
        readLog: async () => log,
        track: () => undefined,
        now: () => now,
      },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    return {
      controller,
      requests,
      logged,
      say(text: string, ms = 1000) {
        now += ms;
        controller.heard(text, now);
      },
      async answer(reply: ExtractReply) {
        answers.shift()!(reply);
        await settle();
      },
      pending: () => answers.length,
      gapRequests: () => requests.filter((request) => request.look === "gap"),
    };
  }

  /** A first down made on 3rd and 2, four lines nobody read, then a play at 2nd and 10 (or `after`). */
  async function withAGap(h: ReturnType<typeof harness>, after: Partial<StatsPlay> = { down: 2, distance: 10 }) {
    await h.controller.start();
    h.say("third and two fennimore for 5 and the first down"); // 0
    await h.answer({ ok: true, plays: [run(0, 0, 5, { down: 3, distance: 2 })], usage: NO_USAGE });
    h.say("first and ten"); // 1
    h.say("castellane looking looking throws it away"); // 2
    h.say("nobody open on that one"); // 3
    h.say("second and ten"); // 4
    h.say("fennimore for 3", 11_000); // 5
    h.say("third and seven", 11_000); // 6
    await h.answer({ ok: true, plays: [run(5, 5, 3, after)], usage: NO_USAGE });
  }

  it("re-reads the gap's lines once, with the game state and one sentence about the missing snap (R44)", async () => {
    const h = harness();
    await withAGap(h);
    const gaps = h.gapRequests();
    expect(gaps).toHaveLength(1);
    const request = gaps[0];
    // The lines between the two plays, with a margin each side.
    expect(request.utterances.map((u) => u.seq)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(request.recentPlays.map((p) => p.playId).sort()).toEqual(["0-0", "5-5"]);
    expect(request.gap).toEqual({ offense: "home", before: { down: 1, distance: 10, spot: null }, after: { down: 2, distance: 10, spot: null }, yards: 0 });
    const content = volatileContent(request);
    expect(content).toContain(GAP_REREAD_PROMPT);
    expect(content).toContain("MISSING SNAP");
    expect(content).toContain("went from 1st and 10 to 2nd and 10, so one snap of about 0 yards is missing");
    expect(h.controller.bridge.counts().gapRereads).toBe(1);
    // The play it finds fills the gap, noted R44, and the gap is not read again.
    await h.answer({ ok: true, plays: [play(2, 3, [ev("H7-CASTELLANE", "pass_incomplete")], { playType: "pass", down: 1, distance: 10 })], usage: NO_USAGE });
    const added = h.controller.getView().session.plays.find((p) => p.playId === "2-3")!;
    expect(added.status).toBe("applied");
    expect(added.dropped).toContainEqual(expect.objectContaining({ rule: "R44" }));
    expect(h.gapRequests()).toHaveLength(1);
    expect(h.controller.bridge.counts().gapFills).toBe(0);
  });

  it("infers one incomplete pass when nothing comes back and the snap moved nothing (R45), and nothing when the yards changed", async () => {
    const h = harness();
    await withAGap(h);
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    const inferred = h.controller.getView().session.plays.find((p) => p.playId.startsWith("gap-"))!;
    expect(inferred).toBeDefined();
    expect(inferred.status).toBe("applied");
    expect(inferred.changes).toEqual([{ playerId: "H7-CASTELLANE", key: "pass_att", amount: 1, estimated: true }]);
    expect(h.logged.filter((r) => r.kind === "stats_play").map((r) => (r as { playId: string }).playId)).toContain(inferred.playId);
    expect(h.controller.bridge.counts().gapFills).toBe(1);
    expect(h.gapRequests()).toHaveLength(1);

    const moved = harness();
    await withAGap(moved, { down: 2, distance: 6 });
    expect(moved.gapRequests()[0].gap?.yards).toBe(4);
    await moved.answer({ ok: true, plays: [], usage: NO_USAGE });
    expect(moved.controller.getView().session.plays.some((p) => p.playId.startsWith("gap-"))).toBe(false);
    expect(moved.controller.bridge.counts().gapFills).toBe(0);
  });

  it("comes back from a reload knowing which gaps it looked at and what it inferred", async () => {
    const h = harness();
    await withAGap(h);
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    const restored = restoreFromLog(h.logged);
    expect(restored.gapRereads).toBe(1);
    expect(restored.gapFills).toBe(1);
    expect(restored.gapsSeen).toEqual(["0|5"]);
    const again = harness(h.logged);
    await again.controller.start();
    expect(again.gapRequests()).toHaveLength(0);
    expect(again.controller.bridge.counts()).toMatchObject({ gapRereads: 1, gapFills: 1 });
  });

  it("stops at the cap", async () => {
    const h = harness();
    await h.controller.start();
    // Each pair: a first down made, then a 3rd-down play, so two snaps are missing between them, a gap each time.
    let seq = 0;
    for (let i = 0; i < GAP_REREADS_PER_GAME + 3; i++) {
      h.say("third and two fennimore for 5 first down", i === 0 ? 1000 : 11_000);
      const first = seq;
      seq += 1;
      h.say("and a flag");
      seq += 1;
      await h.answer({ ok: true, plays: [run(first, first, 5, { down: 3, distance: 2 })], usage: NO_USAGE });
      h.say("third and seven fennimore for 3", 11_000);
      const third = seq;
      seq += 1;
      await h.answer({ ok: true, plays: [run(third, third, 3, { down: 3, distance: 7 })], usage: NO_USAGE });
      while (h.pending() > 0) await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    }
    expect(h.gapRequests().length).toBe(GAP_REREADS_PER_GAME);
    expect(h.controller.bridge.counts().gapRereads).toBe(GAP_REREADS_PER_GAME);
  });

  it("the route reads the gap field by field", () => {
    expect(readGap({ offense: "home", before: { down: 1, distance: 10, spot: { yardLine: 30, territory: "home" } }, after: { down: 2, distance: 10, spot: null }, yards: 0 })).toEqual({
      offense: "home",
      before: { down: 1, distance: 10, spot: { yardLine: 30, territory: "home" } },
      after: { down: 2, distance: 10, spot: null },
      yards: 0,
    });
    expect(readGap({ offense: "nobody" })).toBeNull();
    const parsed = readRequest({ utterances: [{ seq: 1, text: "x", offsetMs: 0 }], rosters: ROSTER, recentPlays: [], look: "gap", gap: { offense: "away", before: {}, after: {}, yards: null } });
    expect(parsed).toMatchObject({ look: "gap", gap: { offense: "away", yards: null } });
  });
});
