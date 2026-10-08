import { describe, expect, it } from "vitest";
import { tallyChanges } from "@/lib/cards/tonight";
import { StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { EMPTY_SESSION, readPlays, restoreFromLog, type StatsSession } from "@/lib/livestats/session";
import { NO_USAGE, type Action, type FieldSpot, type StatsEvent, type StatsPlay, type StatsRosterPlayer, type YardsSource } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";

// =============================================================================
// Yards from where the ball is, and plays updated after they were read
// (lib/livestats/gameState.ts through readPlays; the controller's
// stats_update record; the log folding it back). Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB", season: { pass_att: 120 } },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR" },
  { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
];

function ev(playerId: string, action: Action, yards: number | null = null, yardsSource: YardsSource | null = yards === null ? null : "stated"): StatsEvent {
  return { playerId, action, yards, yardsSource, made: null };
}
const spot = (yardLine: number, territory: FieldSpot["territory"] = "home"): FieldSpot => ({ yardLine, territory });
function play(seqStart: number, seqEnd: number, summary: string, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
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
    summary,
    evidence: events.map((event) => event.playerId.split("-")[1].toLowerCase()).join(" "),
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    ...extra,
  };
}
const said = (...lines: Array<[number, string]>) => lines.map(([seq, text]) => ({ seq, text }));
const gain = (p: StatsPlay) => p.events.find((event) => event.action === "rush" || event.action === "reception")!;

describe("yards from where the ball is", () => {
  it("fills a play's yards from its own spots when it is read", () => {
    const run = play(10, 11, "FENNIMORE from the 19 out near the 29", [ev("H22-FENNIMORE", "rush")], { startSpot: spot(19), endSpot: spot(29) });
    const { added } = readPlays(EMPTY_SESSION, [run], ROSTER, 1000);
    expect(gain(added[0].play)).toMatchObject({ yards: 10, yardsSource: "spots" });
    expect(added[0].changes).toEqual([
      { playerId: "H22-FENNIMORE", key: "rush_att", amount: 1, estimated: false },
      { playerId: "H22-FENNIMORE", key: "rush_yds", amount: 10, estimated: true },
    ]);
    expect(added[0].dropped).toEqual([{ playerId: "H22-FENNIMORE", action: "rush", rule: "R23", reason: "yards worked out from the yard lines", kind: "changed" }]);
  });

  it("starts from where the last play left the ball", () => {
    const first = play(10, 11, "FENNIMORE run to the 29", [ev("H22-FENNIMORE", "rush")], { endSpot: spot(29) });
    const second = play(13, 14, "PREWITT catch, down at the 31", [ev("H7-CASTELLANE", "pass_complete"), ev("H81-PREWITT", "reception")], {
      playType: "pass",
      down: 2,
      distance: 8,
      endSpot: spot(31, "unknown"),
    });
    let session: StatsSession = readPlays(EMPTY_SESSION, [first], ROSTER, 1000).session;
    const read = readPlays(session, [second], ROSTER, 2000, { utterances: said([12, "second and eight"]) });
    session = read.session;
    expect(gain(read.added[0].play)).toMatchObject({ yards: 2, yardsSource: "spots" });
    expect(read.added[0].play.events[0]).toMatchObject({ yards: 2, yardsSource: "spots" });
  });

  it("back-fills the previous play from the next down and distance, marked estimated", () => {
    const first = play(10, 11, "FENNIMORE run", [ev("H22-FENNIMORE", "rush")]);
    const second = play(13, 14, "FENNIMORE run again", [ev("H22-FENNIMORE", "rush", 3)], { down: 2, distance: 4 });
    const after = readPlays(readPlays(EMPTY_SESSION, [first], ROSTER, 1000).session, [second], ROSTER, 2000, { utterances: said([12, "second and four"]) });
    expect(after.session.plays).toHaveLength(2);
    expect(after.updated.map((p) => p.playId)).toEqual(["10-11"]);
    const refilled = after.updated[0];
    expect(gain(refilled.play)).toMatchObject({ yards: 6, yardsSource: "downs" });
    expect(refilled.changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 6, estimated: true });
    expect(refilled.dropped).toEqual([{ playerId: "H22-FENNIMORE", action: "rush", rule: "R23", reason: "yards worked out from the next down and distance", kind: "changed" }]);
    expect(refilled.updated).toBe(1);
  });

  it("back-fills from the next play's start spot, and from the yards short of the first down", () => {
    const first = play(10, 11, "FENNIMORE run", [ev("H22-FENNIMORE", "rush")], { startSpot: spot(20) });
    const second = play(13, 14, "FENNIMORE run", [ev("H22-FENNIMORE", "rush", 3)], { down: 2, startSpot: spot(27) });
    const after = readPlays(readPlays(EMPTY_SESSION, [first], ROSTER, 1000).session, [second], ROSTER, 2000, { utterances: said([12, "second and three"]) });
    expect(gain(after.updated[0].play)).toMatchObject({ yards: 7, yardsSource: "spots" });

    const third = play(20, 21, "FENNIMORE run, two yards short", [ev("H22-FENNIMORE", "rush")], { down: 3, distance: 7, shortBy: 2 });
    const { added } = readPlays(EMPTY_SESSION, [third], ROSTER, 1000);
    expect(gain(added[0].play)).toMatchObject({ yards: 5, yardsSource: "phrase" });
  });

  it('a late "that went for 48" replaces a wrong 13, and counts as stated', () => {
    const first = play(10, 11, "CASTELLANE to PREWITT for 13", [ev("H7-CASTELLANE", "pass_complete", 13), ev("H81-PREWITT", "reception", 13)], { playType: "pass" });
    // The late line arrives after the first read, with the next play.
    const utterances = said([12, "that went for 48 yards"], [13, "first and ten"]);
    const second = play(14, 15, "FENNIMORE run for 2", [ev("H22-FENNIMORE", "rush", 2)]);
    const after = readPlays(readPlays(EMPTY_SESSION, [first], ROSTER, 1000).session, [second], ROSTER, 2000, { utterances });
    const [refilled] = after.updated;
    expect(refilled.playId).toBe("10-11");
    expect(refilled.play.events.map((event) => event.yards)).toEqual([48, 48]);
    expect(tallyChanges(refilled.changes).get("H81-PREWITT")).toEqual({ stats: { rec: 1, rec_yds: 48 }, estimated: [] });
    expect(refilled.dropped[0]).toMatchObject({ rule: "R23", reason: "yards said 1 line after the play" });
  });

  it("a plain number a few lines later fills unknown yards but does not replace a stated one", () => {
    const unknown = play(10, 11, "FENNIMORE run", [ev("H22-FENNIMORE", "rush")]);
    const filled = readPlays(EMPTY_SESSION, [unknown], ROSTER, 1000, { utterances: said([12, "gain of 7 on the play"]) });
    expect(gain(filled.added[0].play)).toMatchObject({ yards: 7, yardsSource: "stated" });
    const stated = play(10, 11, "FENNIMORE run for 4", [ev("H22-FENNIMORE", "rush", 4)]);
    const kept = readPlays(EMPTY_SESSION, [stated], ROSTER, 1000, { utterances: said([12, "gain of 7 on the play"]) });
    expect(gain(kept.added[0].play)).toMatchObject({ yards: 4 });
  });

  it("works nothing out across the 50 with one side unknown", () => {
    const run = play(10, 11, "FENNIMORE run from the 45 to the 48", [ev("H22-FENNIMORE", "rush")], { startSpot: spot(45), endSpot: spot(48, "unknown") });
    const { added } = readPlays(EMPTY_SESSION, [run], ROSTER, 1000);
    expect(gain(added[0].play).yards).toBeNull();
    expect(added[0].changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: null, estimated: false });
  });
});

describe("the loop and the log", () => {
  const START = 1_800_000_000_000;
  function harness() {
    let now = START;
    const logged: StatsRecord[] = [];
    const answers: Array<(reply: ExtractReply) => void> = [];
    const controller = new StatsController({
      gameId: "game-1",
      startedAt: START,
      roster: ROSTER,
      autoOk: true,
      deps: {
        extract: () => new Promise((resolve) => answers.push(resolve)),
        log: (record) => logged.push(record),
        readLog: async () => [],
        track: () => {},
        now: () => now,
      },
    });
    return {
      controller,
      logged,
      say(text: string, ms = 1000) {
        now += ms;
        controller.heard(text, now);
      },
      advance(ms: number) {
        now += ms;
      },
      async answer(plays: StatsPlay[]) {
        answers.shift()!({ ok: true, plays, usage: NO_USAGE });
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    };
  }

  it("logs an updated play as stats_update, which the log folds back after a reload", async () => {
    const h = harness();
    await h.controller.start();
    h.say("first and ten");
    // The down-and-distance call asks at once; nothing finished yet.
    await h.answer([]);
    h.say("fennimore up the middle");
    h.advance(70_000);
    h.say("brought down by dunmore");
    await h.answer([play(1, 1, "FENNIMORE run", [ev("H22-FENNIMORE", "rush")])]);
    h.advance(70_000);
    h.say("fennimore picks up 8 there dunmore on the tackle");
    await h.answer([{ ...play(2, 3, "FENNIMORE 8 yd run, DUNMORE tackle", [ev("H22-FENNIMORE", "rush", 8), ev("A17-DUNMORE", "tackle")]), updates: "1-1" }]);

    expect(h.logged.map((record) => record.kind)).toEqual(["stats_reply", "stats_reply", "stats_play", "stats_decision", "stats_reply", "stats_update"]);
    const update = h.logged[5];
    expect(update).toMatchObject({ kind: "stats_update", playId: "1-1" });
    const session = h.controller.getView().session;
    expect(session.plays).toHaveLength(1);
    expect(session.plays[0]).toMatchObject({ status: "applied", updated: 1 });
    expect(h.controller.bridge.lines().get("A17-DUNMORE")).toBeDefined();

    const restored = restoreFromLog(h.logged);
    expect(restored.session.plays[0]).toMatchObject({ playId: "1-1", status: "applied", updated: 1 });
    expect(restored.session.plays[0].play.events.map((event) => event.playerId)).toEqual(["H22-FENNIMORE", "A17-DUNMORE"]);
  });

  it("lets a later read of an applied play through by its id, whatever its lines", async () => {
    const h = harness();
    await h.controller.start();
    h.say("first and ten");
    await h.answer([]);
    h.say("fennimore up the middle");
    h.advance(70_000);
    h.say("second and four");
    await h.answer([play(1, 1, "FENNIMORE run", [ev("H22-FENNIMORE", "rush")])]);
    h.advance(70_000);
    h.say("fennimore just ran for 6 by the way");
    // seqEnd 1 is behind the watermark; the id carries it through.
    await h.answer([play(1, 1, "FENNIMORE ran for 6", [ev("H22-FENNIMORE", "rush", 6)], { updates: "1-1" })]);
    expect(h.logged.filter((record) => record.kind === "stats_update")).toHaveLength(1);
    expect(h.controller.getView().session.plays[0].play.events[0]).toMatchObject({ yards: 6, yardsSource: "stated" });
  });
});
