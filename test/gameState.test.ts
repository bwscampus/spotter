import { describe, expect, it } from "vitest";
import {
  absoluteSpot,
  advance,
  gainIs,
  isStatTalk,
  lateStatedYards,
  MAX_WORKED_OUT_YARDS,
  missedPlayBefore,
  NEAR_MIDFIELD,
  START_STATE,
  stateAfter,
  withGain,
  workOutYards,

} from "@/lib/livestats/gameState";
import type { FieldSpot, StatsEvent, StatsPlay } from "@/lib/livestats/types";

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

describe("spots", () => {
  it("reads a yard line as yards from the offense's own goal line", () => {
    expect(absoluteSpot(spot(19, "home"), "home")).toBe(19);
    expect(absoluteSpot(spot(29, "away"), "home")).toBe(71);
    expect(absoluteSpot(spot(29, "away"), "away")).toBe(29);
    expect(absoluteSpot(spot(50, "unknown"), "home")).toBe(50);
    expect(absoluteSpot(spot(30, "unknown"), "home")).toBeNull();
  });
});

// Fix 6 (Part 2): a play from scrimmage is the drive ledger's
// (lib/livestats/ledger.ts, test/ledger.test.ts). workOutYards keeps only the
// kick lengths, and MAX_WORKED_OUT_YARDS still bounds nothing here but a punt.
describe("workOutYards", () => {
  it("works out kicks only; a play from scrimmage is the ledger's", () => {
    const run = play({ startSpot: spot(20), endSpot: spot(26) });
    expect(workOutYards(run, START_STATE)).toBeNull();
    expect(MAX_WORKED_OUT_YARDS).toBe(40);
    expect(NEAR_MIDFIELD).toBe(40);
  });

  it("works nothing out without an offense", () => {
    expect(workOutYards(play({ offense: null, playType: "punt", startSpot: spot(35), endSpot: spot(15, "away"), events: [ev("H9-P", "punt")] }), START_STATE)).toBeNull();
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
    // Past tense too (Oct 22): "picked up 9 great decision".
    expect(lateStatedYards(said("picked up 9 great decision"), 11)).toEqual({ yards: 9, seq: 12, lookingBack: false });
  });

  it("takes nothing from a line about a stat: a season, a day, another opponent, a running total (fix 6)", () => {
    expect(lateStatedYards(said("had a huge 47 yard gain against them two weeks ago"), 11)).toBeNull();
    expect(lateStatedYards(said("he has 29 yards rushing"), 11)).toBeNull();
    expect(lateStatedYards(said("gain of 7 on the season"), 11)).toBeNull();
    expect(lateStatedYards(said("gain of 7 on friday"), 11)).toBeNull();
    const teams = { home: { phrases: ["northfield", "bears"] }, away: { phrases: ["southpoint", "tigers"] } };
    expect(lateStatedYards(said("a 12 yard gain against the lions"), 11, undefined, teams)).toBeNull();
    expect(lateStatedYards(said("a 12 yard gain against the tigers defense"), 11, undefined, teams)).toEqual({ yards: 12, seq: 12, lookingBack: false });
    // Said as the play's gain, in words that are about this play.
    expect(lateStatedYards(said("fennimore for 11"), 11)).toEqual({ yards: 11, seq: 12, lookingBack: false });
    expect(lateStatedYards(said("fennimore for 11 yards on the night"), 11)).toBeNull();
    expect(isStatTalk("already has 3 catches")).toBe(true);
    expect(isStatTalk("brought down after 6")).toBe(false);
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

// Oct 6: the ball spot is trusted only while it is fresh. Since fix 6 the yards
// a fresh spot gives a play from scrimmage are the ledger's (test/ledger.test.ts);
// the state itself still carries the spot the same way.
describe("a fresh ball spot", () => {
  const run = (extra: Partial<StatsPlay>) => play({ events: [ev("H22-FENNIMORE", "rush")], ...extra });
  const opening = run({ down: 1, distance: 10, startSpot: spot(30), endSpot: spot(42) });

  it("carries the end spot of a run with nothing between, and loses it after a penalty with no new spot", () => {
    const settled = { ...opening, events: [ev("H22-FENNIMORE", "rush", 12, "spots")] };
    expect(stateAfter([settled])).toMatchObject({ possession: "home", down: 1, spot: 42 });
    const flag = play({ playType: "penalty_only", down: null, distance: null, events: [], penalty: { on: "offense", noPlay: true, beforeSnap: true } });
    expect(stateAfter([settled, flag]).spot).toBeNull();
  });

  it('a stated "2nd and 22" when the state expected "2nd and 10" means a play was missed', () => {
    const noGain = run({ down: 1, distance: 10, startSpot: spot(30), events: [ev("H22-FENNIMORE", "rush", 0)] });
    expect(stateAfter([noGain])).toMatchObject({ down: 2, distance: 10, spot: 30 });
    expect(missedPlayBefore(run({ down: 2, distance: 22, endSpot: spot(25) }), stateAfter([noGain]))).toBe(true);
    expect(missedPlayBefore(run({ down: 2, distance: 10, endSpot: spot(34) }), stateAfter([noGain]))).toBe(false);
  });

  it("a wiped-out play carries nothing", () => {
    const settled = { ...opening, events: [ev("H22-FENNIMORE", "rush", 12, "spots")] };
    const wiped = run({ down: 1, distance: 10, endSpot: spot(48), nullified: true, penalty: { on: "offense", noPlay: true, beforeSnap: false } });
    expect(stateAfter([settled, wiped]).spot).toBeNull();
  });
});

describe("kick lengths from the spots", () => {
  it("measures a punt from the line of scrimmage to where it came down, past the 40 yard cap", () => {
    const punt = play({ playType: "punt", startSpot: spot(35), endSpot: spot(15, "away"), events: [ev("H9-P", "punt")] });
    expect(workOutYards(punt, START_STATE)).toEqual({ yards: 50, source: "spots" });
  });

  it("measures a punt that ended in a touchback to the goal line", () => {
    const punt = play({ playType: "punt", startSpot: spot(45), summary: "PELLAM punt, touchback", events: [ev("H9-P", "punt")] });
    expect(workOutYards(punt, START_STATE)).toEqual({ yards: 55, source: "spots" });
  });

  it("measures a field goal as the yards to the goal line plus 17", () => {
    const kick = play({ playType: "field_goal", startSpot: spot(25, "away"), events: [{ ...ev("H3-K", "field_goal"), made: true }] });
    // The away 25 is 75 from the home goal line: 25 + 17 = 42.
    expect(workOutYards(kick, START_STATE)).toEqual({ yards: 42, source: "spots" });
    expect(gainIs(kick)).toBe("unknown");
  });

  it("leaves a kick alone when there is no spot", () => {
    expect(workOutYards(play({ playType: "punt", events: [ev("H9-P", "punt")] }), START_STATE)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Oct 10: two rules of football for the ball spot. A kick, a return or a
// turnover that ends at a stated spot (its half known, no flag) is where the
// next play starts, whichever team has it; an incomplete pass with no flag
// does not move the ball. Made-up names; home and away stand for the teams.
// -----------------------------------------------------------------------------

describe("the spot a kick, a return or a turnover leaves", () => {
  const punt = (endSpot: FieldSpot | null, extra: Partial<StatsPlay> = {}) =>
    play({ playType: "punt", down: 4, distance: 6, events: [ev("H9-PELLAM", "punt")], summary: "PELLAM punt", endSpot, ...extra });

  it("starts the next play where a punt was downed, for the other team", () => {
    expect(stateAfter([punt(spot(30, "away"))]).ballLeftAt).toEqual(spot(30, "away"));
  });

  it("carries nothing when the punt's half was not said", () => {
    expect(stateAfter([punt(spot(30, "unknown"))]).ballLeftAt).toBeUndefined();
  });

  it("starts the next play where a kickoff return ended", () => {
    const kickoff = play({ playType: "kickoff", down: null, distance: null, events: [ev("H3-BOOTHBY", "punt"), ev("A2-OAKES", "kick_return", 19)], endSpot: spot(22, "away") });
    expect(stateAfter([kickoff]).ballLeftAt).toEqual(spot(22, "away"));
  });

  it("starts the next play where an interception return ended", () => {
    const pick = play({
      playType: "pass",
      events: [ev("H7-CASTELLANE", "pass_intercepted"), ev("A24-ASHGROVE", "interception", 12)],
      endSpot: spot(40, "home"),
    });
    expect(stateAfter([pick]).ballLeftAt).toEqual(spot(40, "home"));
  });

  it("carries nothing from a punt with a flag", () => {
    expect(stateAfter([punt(spot(30, "away"), { penalty: { on: "defense", noPlay: false, beforeSnap: false } })]).ballLeftAt).toBeUndefined();
  });

  it("carries nothing from a punt that was returned: its end spot is where the ball came down", () => {
    const returned = punt(spot(30, "away"), { events: [ev("H9-PELLAM", "punt"), ev("A2-OAKES", "punt_return", 8)] });
    expect(stateAfter([returned]).ballLeftAt).toBeUndefined();
  });
});

describe("an incomplete pass does not move the ball", () => {
  const incomplete = (extra: Partial<StatsPlay> = {}) =>
    play({ playType: "pass", events: [ev("H7-CASTELLANE", "pass_incomplete")], summary: "CASTELLANE incomplete", startSpot: spot(30), ...extra });

  it("keeps the spot, and counts as a gain of 0 for the down and distance", () => {
    expect(advance(START_STATE, incomplete())).toEqual({ possession: "home", down: 2, distance: 10, spot: 30 });
    const ran = play({ down: 2, distance: 10, events: [ev("H22-FENNIMORE", "rush", 6, "spots")], endSpot: spot(36, "unknown") });
    expect(stateAfter([incomplete(), ran])).toMatchObject({ down: 3, distance: 4, spot: 36 });
  });

  it("carries nothing from an incomplete pass with a flag", () => {
    const flagged = incomplete({ penalty: { on: "defense", noPlay: false, beforeSnap: false } });
    expect(advance(START_STATE, flagged).spot).toBeNull();
  });
});
