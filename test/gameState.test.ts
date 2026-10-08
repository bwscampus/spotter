import { describe, expect, it } from "vitest";
import {
  absoluteSpot,
  advance,
  gainIs,
  lateStatedYards,
  MAX_WORKED_OUT_YARDS,
  missedPlayBefore,
  NEAR_MIDFIELD,
  START_STATE,
  stateAfter,
  withGain,
  workOutYards,
  type GameState,
} from "@/lib/livestats/gameState";
import { EMPTY_SESSION, readPlays } from "@/lib/livestats/session";
import type { FieldSpot, StatsEvent, StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";

// Where the ball is, and the yards that follow from it (lib/livestats/gameState.ts).
// The offense is home throughout unless a test says otherwise; made-up names.

const spot = (yardLine: number, territory: FieldSpot["territory"] = "home"): FieldSpot => ({ yardLine, territory });
const ev = (playerId: string, action: StatsEvent["action"], yards: number | null = null, yardsSource: StatsEvent["yardsSource"] = yards === null ? null : "stated"): StatsEvent => ({
  playerId,
  action,
  yards,
  yardsSource,
  made: null,
});
function play(extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart: 10,
    seqEnd: 11,
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
    summary: "FENNIMORE run",
    evidence: "fennimore",
    events: [ev("H22-FENNIMORE", "rush")],
    ...extra,
  };
}
const at = (yards: number | null): GameState => ({ possession: "home", down: 1, distance: 10, spot: yards });

describe("spots", () => {
  it("reads a yard line as yards from the offense's own goal line", () => {
    expect(absoluteSpot(spot(19, "home"), "home")).toBe(19);
    expect(absoluteSpot(spot(29, "away"), "home")).toBe(71);
    expect(absoluteSpot(spot(29, "away"), "away")).toBe(29);
    expect(absoluteSpot(spot(50, "unknown"), "home")).toBe(50);
    expect(absoluteSpot(spot(30, "unknown"), "home")).toBeNull();
  });

  const gain = (startSpot: FieldSpot | null, endSpot: FieldSpot | null, state: GameState = START_STATE) =>
    workOutYards(play({ startSpot, endSpot }), state, null)?.yards ?? null;

  it('"from the 19 out near the 29" is 10', () => {
    expect(gain(spot(19), spot(29))).toBe(10);
  });

  it('"caught at the 30, down at the 31" starting from the 29 is 2, with or without whose 31 it is', () => {
    expect(gain(null, spot(31, "home"), at(29))).toBe(2);
    expect(gain(null, spot(31, "unknown"), at(29))).toBe(2);
    expect(gain(null, spot(31, "unknown"))).toBeNull();
  });

  it('4th and 7 at the 16 with "tackle at the 1" is 15', () => {
    expect(gain(spot(16, "away"), spot(1, "away"))).toBe(15);
    expect(gain(spot(16, "away"), spot(1, "unknown"))).toBe(15);
  });

  it(`works nothing out across the 50 with one side unknown (a known spot at the ${NEAR_MIDFIELD} or past it)`, () => {
    expect(gain(spot(45, "home"), spot(48, "unknown"))).toBeNull();
    expect(gain(spot(45, "unknown"), spot(48, "unknown"), at(45))).toBeNull();
    expect(gain(spot(45, "home"), spot(48, "away"))).toBe(7);
    expect(gain(spot(45, "home"), spot(40, "away"))).toBe(15);
  });

  it(`leaves a worked-out figure over ${MAX_WORKED_OUT_YARDS} unknown`, () => {
    expect(gain(spot(10, "home"), spot(5, "away"))).toBeNull();
    expect(gain(spot(10, "home"), spot(50, "midfield"))).toBe(40);
  });
});

describe("workOutYards", () => {
  it("takes the spots first, then the next play's down and distance, then the yards short", () => {
    const run = play({ startSpot: spot(20), endSpot: spot(26) });
    expect(workOutYards(run, START_STATE, null)).toEqual({ yards: 6, source: "spots" });

    const noSpots = play();
    const next = play({ seqStart: 12, seqEnd: 13, down: 2, distance: 4 });
    expect(workOutYards(noSpots, START_STATE, next)).toEqual({ yards: 6, source: "downs" });
    expect(workOutYards(noSpots, START_STATE, { ...next, offense: "away" })).toBeNull();
    expect(workOutYards(noSpots, START_STATE, { ...next, down: 1 })).toBeNull();

    const third = play({ down: 3, distance: 7, shortBy: 2 });
    expect(workOutYards(third, START_STATE, null)).toEqual({ yards: 5, source: "phrase" });
  });

  it("uses the next play's start spot as this play's end spot on the same possession", () => {
    const run = play({ startSpot: spot(20) });
    const next = play({ seqStart: 12, seqEnd: 13, down: 2, startSpot: spot(27) });
    expect(workOutYards(run, START_STATE, next)).toEqual({ yards: 7, source: "spots" });
  });

  it("works nothing out without an offense", () => {
    expect(workOutYards(play({ offense: null, startSpot: spot(20), endSpot: spot(26) }), START_STATE, null)).toBeNull();
  });
});

describe("withGain", () => {
  it("writes the figure on the run, with its source and a note", () => {
    const { play: filled, notes } = withGain(play(), { yards: 6, source: "downs" }, "R23", "from the downs");
    expect(filled.events[0]).toMatchObject({ yards: 6, yardsSource: "downs" });
    expect(notes).toEqual([{ playerId: "H22-FENNIMORE", action: "rush", rule: "R23", reason: "from the downs", kind: "changed" }]);
    expect(gainIs(filled)).toBe("estimated");
  });

  it("writes a loss on both sack events as the positive number they carry, and no gain at all", () => {
    const sack = play({ playType: "sack", events: [ev("H7-CASTELLANE", "sacked"), ev("A17-DUNMORE", "sack")] });
    expect(withGain(sack, { yards: -7, source: "spots" }, "R23", "x").play.events.map((event) => event.yards)).toEqual([7, 7]);
    expect(withGain(sack, { yards: 3, source: "spots" }, "R23", "x").play).toBe(sack);
  });

  it("writes a catch's yards on the catch and the throw", () => {
    const pass = play({ playType: "pass", events: [ev("H7-CASTELLANE", "pass_complete"), ev("H81-PREWITT", "reception")] });
    expect(withGain(pass, { yards: 12, source: "spots" }, "R23", "x").play.events.map((event) => event.yards)).toEqual([12, 12]);
  });
});

describe("a yardage said late", () => {
  const said = (...texts: string[]) => texts.map((text, i) => ({ seq: 12 + i, text }));

  it("is read from the next few lines, and knows when the words look back at the play", () => {
    expect(lateStatedYards(said("that went for 48 yards"), 11)).toEqual({ yards: 48, seq: 12, lookingBack: true });
    expect(lateStatedYards(said("gain of 37"), 11)).toEqual({ yards: 37, seq: 12, lookingBack: false });
    expect(lateStatedYards(said("and a loss of 3 on the play"), 11)).toEqual({ yards: -3, seq: 12, lookingBack: false });
    expect(lateStatedYards(said("his catch of 11 a moment ago"), 11)).toEqual({ yards: 11, seq: 12, lookingBack: true });
  });

  it("stops at a down-and-distance call, at the next play, and after three lines", () => {
    expect(lateStatedYards(said("second and four", "that went for 48"), 11)).toBeNull();
    expect(lateStatedYards(said("nice block", "that went for 48"), 11, 13)).toBeNull();
    expect(lateStatedYards(said("a", "b", "c", "that went for 48"), 11)).toBeNull();
    expect(lateStatedYards(said("a", "b", "that went for 48"), 11)).toEqual({ yards: 48, seq: 14, lookingBack: true });
  });
});

describe("the state", () => {
  it("moves the ball by the yards said, takes an end spot when there is one, and loses it on a kick", () => {
    const first = play({ startSpot: spot(20), events: [ev("H22-FENNIMORE", "rush", 8)] });
    expect(advance(START_STATE, first)).toMatchObject({ possession: "home", down: 2, distance: 2, spot: 28 });
    const second = play({ seqStart: 12, seqEnd: 13, down: 2, distance: 2, endSpot: spot(35) });
    expect(stateAfter([first, second])).toMatchObject({ possession: "home", down: 1, distance: null, spot: 35 });
    const punt = play({ seqStart: 14, seqEnd: 15, down: 4, distance: 2, playType: "punt", events: [ev("H9-PELLAM", "punt", 40)] });
    expect(stateAfter([first, second, punt])).toMatchObject({ possession: "home", down: null, distance: null, spot: null });
  });

  it("does not carry a spot across a change of possession, and ignores a penalty-only play", () => {
    const first = play({ startSpot: spot(20), events: [ev("H22-FENNIMORE", "rush", 8)] });
    const theirs = play({ seqStart: 12, seqEnd: 13, offense: "away", events: [ev("A31-RENNICK", "rush", 3)] });
    expect(stateAfter([first, theirs])).toMatchObject({ possession: "away", down: 2, distance: 7, spot: null });
    // A flag with no new spot said: the spot is unknown until one is.
    const flag = play({ seqStart: 14, seqEnd: 14, down: null, distance: null, playType: "penalty_only", events: [] });
    expect(stateAfter([first, flag])).toMatchObject({ possession: "home", spot: null });
    const placed = play({ seqStart: 14, seqEnd: 14, down: 1, distance: 15, playType: "penalty_only", endSpot: spot(23), events: [] });
    expect(stateAfter([first, placed])).toMatchObject({ possession: "home", down: 1, distance: 15, spot: 23 });
  });
});

// Oct 6: the ball spot is trusted only while it is fresh.
describe("a fresh ball spot", () => {
  const run = (extra: Partial<StatsPlay>) => play({ events: [ev("H22-FENNIMORE", "rush")], ...extra });
  const opening = run({ down: 1, distance: 10, startSpot: spot(30), endSpot: spot(42) });
  const yardsAfter = (prior: StatsPlay[], next: StatsPlay) => workOutYards(next, stateAfter(prior), null);

  it('a run "to the 42" after "1st and 10 at the 30" is 12', () => {
    expect(workOutYards(opening, START_STATE, null)).toEqual({ yards: 12, source: "spots" });
  });

  it('the next run "to the 45" with nothing between is 3', () => {
    const settled = { ...opening, events: [ev("H22-FENNIMORE", "rush", 12, "spots")] };
    expect(yardsAfter([settled], run({ down: 1, distance: 10, endSpot: spot(45) }))).toEqual({ yards: 3, source: "spots" });
  });

  it("the same run after a penalty with no new spot said is blank; it is worked out again once a spot is said", () => {
    const settled = { ...opening, events: [ev("H22-FENNIMORE", "rush", 12, "spots")] };
    const flag = play({ playType: "penalty_only", down: null, distance: null, events: [], penalty: { on: "offense", noPlay: true, beforeSnap: true } });
    expect(yardsAfter([settled, flag], run({ down: 1, distance: 15, endSpot: spot(45) }))).toBeNull();
    expect(yardsAfter([settled, flag], run({ down: 2, distance: 20, startSpot: spot(35), endSpot: spot(45) }))).toEqual({ yards: 10, source: "spots" });
  });

  it('a stated "2nd and 22" when the state expected "2nd and 10" makes the yards blank, not negative', () => {
    const noGain = run({ down: 1, distance: 10, startSpot: spot(30), events: [ev("H22-FENNIMORE", "rush", 0)] });
    expect(stateAfter([noGain])).toMatchObject({ down: 2, distance: 10, spot: 30 });
    const missed = run({ down: 2, distance: 22, endSpot: spot(25) });
    expect(missedPlayBefore(missed, stateAfter([noGain]))).toBe(true);
    expect(yardsAfter([noGain], missed)).toBeNull();
    expect(yardsAfter([noGain], run({ down: 2, distance: 10, endSpot: spot(34) }))).toEqual({ yards: 4, source: "spots" });
  });

  it("a touchdown from a fresh spot at the 4 is 4; with no fresh spot it is blank", () => {
    const toTheFour = run({ down: 1, distance: 10, startSpot: spot(20, "away"), endSpot: spot(4, "away"), firstDown: true });
    expect(yardsAfter([toTheFour], run({ down: 1, distance: 4, touchdown: true }))).toEqual({ yards: 4, source: "spots" });
    expect(workOutYards(run({ down: 1, distance: 4, touchdown: true }), START_STATE, null)).toBeNull();
  });

  it("back-fill from the next play's down and distance still works", () => {
    const first = run({ down: 1, distance: 10 });
    expect(workOutYards(first, START_STATE, run({ down: 2, distance: 4 }))).toEqual({ yards: 6, source: "downs" });
    expect(workOutYards({ ...first, firstDown: true }, START_STATE, run({ down: 2, distance: 4 }))).toBeNull();
  });

  it("no back-fill across a wiped-out play or a flag, and back-fill with nothing between", () => {
    const roster: StatsRosterPlayer[] = [{ playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: null, last: "Fennimore", position: "RB" }];
    const first = run({ seqStart: 1, seqEnd: 2, down: 1, distance: 10 });
    const wiped = run({ seqStart: 3, seqEnd: 4, down: null, distance: null, nullified: true, penalty: { on: "offense", noPlay: true, beforeSnap: false } });
    const next = run({ seqStart: 5, seqEnd: 6, down: 2, distance: 4 });
    const across = readPlays(EMPTY_SESSION, [first, wiped, next], roster, 1).session.plays[0];
    expect(across.play.events[0].yards).toBeNull();
    const direct = readPlays(EMPTY_SESSION, [first, next], roster, 1).session.plays[0];
    expect(direct.play.events[0]).toMatchObject({ yards: 6, yardsSource: "downs" });
  });

  it("nothing is worked out across a wiped-out play", () => {
    const settled = { ...opening, events: [ev("H22-FENNIMORE", "rush", 12, "spots")] };
    const wiped = run({ down: 1, distance: 10, endSpot: spot(48), nullified: true, penalty: { on: "offense", noPlay: true, beforeSnap: false } });
    expect(yardsAfter([settled, wiped], run({ down: 1, distance: 20, endSpot: spot(45) }))).toBeNull();
  });
});

describe("kick lengths from the spots", () => {
  it("measures a punt from the line of scrimmage to where it came down, past the 40 yard cap", () => {
    const punt = play({ playType: "punt", startSpot: spot(35), endSpot: spot(15, "away"), events: [ev("H9-P", "punt")] });
    expect(workOutYards(punt, START_STATE, null)).toEqual({ yards: 50, source: "spots" });
  });

  it("measures a punt that ended in a touchback to the goal line", () => {
    const punt = play({ playType: "punt", startSpot: spot(45), summary: "PELLAM punt, touchback", events: [ev("H9-P", "punt")] });
    expect(workOutYards(punt, START_STATE, null)).toEqual({ yards: 55, source: "spots" });
  });

  it("measures a field goal as the yards to the goal line plus 17", () => {
    const kick = play({ playType: "field_goal", startSpot: spot(25, "away"), events: [{ ...ev("H3-K", "field_goal"), made: true }] });
    // The away 25 is 75 from the home goal line: 25 + 17 = 42.
    expect(workOutYards(kick, START_STATE, null)).toEqual({ yards: 42, source: "spots" });
    expect(gainIs(kick)).toBe("unknown");
  });

  it("leaves a kick alone when there is no spot", () => {
    expect(workOutYards(play({ playType: "punt", events: [ev("H9-P", "punt")] }), START_STATE, null)).toBeNull();
  });
});
