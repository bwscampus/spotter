import { describe, expect, it } from "vitest";
import { passResultFromDowns } from "@/lib/livestats/check";
import { correctPlay, EMPTY_SESSION, okPlay, readPlays, talliesOf, type StatsSession } from "@/lib/livestats/session";
import { NO_PENALTY, type Action, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// R52 (Oct 22, the v6 push): a pass's result from the next snap's down and
// distance. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-ALDERWICK", side: "home", jersey: "7", first: "Tam", last: "Alderwick", position: "QB", season: { pass_att: 140 } },
  { playerId: "H81-HARLOW", side: "home", jersey: "81", first: "Joss", last: "Harlow", position: "WR" },
  { playerId: "H22-WEXCOMBE", side: "home", jersey: "22", first: "Bram", last: "Wexcombe", position: "RB" },
  { playerId: "A5-MARDEN", side: "away", jersey: "5", first: "Cy", last: "Marden", position: "LB" },
  { playerId: "A9-PAK", side: "away", jersey: "9", first: "Lou", last: "Pak", position: "DB" },
];

function ev(playerId: string, action: Action, yards: number | null = null, yardsSource: StatsEvent["yardsSource"] = yards === null ? null : "stated"): StatsEvent {
  return { playerId, action, yards, yardsSource, made: null };
}
function play(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return { seqStart, seqEnd, quarter: 2, clock: null, down: 2, distance: 7, offense: "home", playType: "pass", nullified: false, touchdown: false, firstDown: false, confidence: 0.9, summary: "pass", evidence: "", events, updates: "", startSpot: null, endSpot: null, shortBy: null, penalty: NO_PENALTY, ...extra };
}
const CAUGHT = play(10, 11, [ev("H7-ALDERWICK", "pass_complete"), ev("H81-HARLOW", "reception"), ev("A5-MARDEN", "tackle")], { summary: "ALDERWICK to HARLOW" });
const MISSED = play(10, 11, [ev("H7-ALDERWICK", "pass_incomplete")], { summary: "ALDERWICK incomplete" });
const next = (down: number, distance: number, extra: Partial<StatsPlay> = {}) => play(14, 15, [ev("H22-WEXCOMBE", "rush", 3)], { playType: "run", down, distance, ...extra });

describe("R52: a pass's result from the next snap", () => {
  it("makes a completion with no gain said incomplete when the down goes up by one and the distance stays", () => {
    const result = passResultFromDowns(CAUGHT, next(3, 7))!;
    expect(result.play.events).toEqual([{ ...ev("H7-ALDERWICK", "pass_incomplete"), estimated: true }]);
    expect(result.notes.map((note) => [note.rule, note.kind, note.event.action])).toEqual([["R52", "changed", "pass_complete"], ["R52", "dropped", "reception"], ["R52", "dropped", "tackle"]]);
  });

  it("keeps a completion with a gain said, and notes it; a gain of 0 said fits", () => {
    const said = play(10, 11, [ev("H7-ALDERWICK", "pass_complete", 6), ev("H81-HARLOW", "reception", 6)]);
    const noted = passResultFromDowns(said, next(3, 7))!;
    expect(noted.play).toBe(said);
    expect(noted.notes).toEqual([expect.objectContaining({ rule: "R52", kind: "noted" })]);
    expect(passResultFromDowns(play(10, 11, [ev("H7-ALDERWICK", "pass_complete", 0), ev("H81-HARLOW", "reception", 0)]), next(3, 7))).toBeNull();
  });

  it("makes an incompletion a completion, caught by nobody named, when the next snap is a first down or shorter", () => {
    for (const after of [next(1, 10), next(3, 2)]) {
      const result = passResultFromDowns(MISSED, after)!;
      expect(result.play.events).toEqual([{ ...ev("H7-ALDERWICK", "pass_complete"), estimated: true }, { ...ev("", "reception"), estimated: true }]);
      expect(result.notes).toEqual([expect.objectContaining({ rule: "R52", kind: "changed" })]);
    }
  });

  it("gives the catch to the one offensive player the play's own words name, other than a quarterback", () => {
    const after = next(1, 10);
    const one = passResultFromDowns(MISSED, after, "alderwick looks for harlow", ROSTER)!;
    expect(one.play.events).toContainEqual({ ...ev("H81-HARLOW", "reception"), estimated: true });
    // Two named, or none, and nobody is guessed; a defender named is not a catcher.
    const two = passResultFromDowns(MISSED, after, "harlow and wexcombe both open", ROSTER)!;
    expect(two.play.events).toContainEqual({ ...ev("", "reception"), estimated: true });
    const defender = passResultFromDowns(MISSED, after, "marden in coverage", ROSTER)!;
    expect(defender.play.events).toContainEqual({ ...ev("", "reception"), estimated: true });
  });

  it("only notes an incompletion the words say was broken up or run, or that has a breakup credited", () => {
    expect(passResultFromDowns(MISSED, next(1, 10), "alderwick scrambles out and picks up the first")?.play).toBe(MISSED);
    expect(passResultFromDowns(MISSED, next(1, 10), "the pass is broken up")?.play).toBe(MISSED);
    const brokenUp = play(10, 11, [ev("H7-ALDERWICK", "pass_incomplete"), ev("A9-PAK", "pass_breakup")]);
    expect(passResultFromDowns(brokenUp, next(1, 10))?.play).toBe(brokenUp);
  });

  it("says nothing when the downs cannot speak for the pass", () => {
    // A flag on the pass, an interception, a pre-snap foul or a penalty-only next play, a snap missed between, or no downs said.
    expect(passResultFromDowns({ ...CAUGHT, penalty: { ...NO_PENALTY, on: "defense" } }, next(3, 7))).toBeNull();
    expect(passResultFromDowns(play(10, 11, [ev("H7-ALDERWICK", "pass_intercepted")]), next(3, 7))).toBeNull();
    expect(passResultFromDowns(CAUGHT, next(3, 7, { playType: "penalty_only" }))).toBeNull();
    expect(passResultFromDowns(CAUGHT, next(3, 7, { penalty: { ...NO_PENALTY, beforeSnap: true } }))).toBeNull();
    expect(passResultFromDowns(CAUGHT, next(4, 7))).toBeNull();
    expect(passResultFromDowns({ ...CAUGHT, down: null }, next(3, 7))).toBeNull();
    expect(passResultFromDowns(MISSED, next(3, 7))).toBeNull();
    expect(passResultFromDowns(CAUGHT, next(1, 10))).toBeNull();
  });

  it("runs on the session once the next play is read, and never on a play the announcer corrected", () => {
    const lines = [{ seq: 10, text: "alderwick looking" }, { seq: 11, text: "harlow there" }, { seq: 14, text: "third and seven wexcombe" }, { seq: 15, text: "for 3" }];
    let session: StatsSession = readPlays(EMPTY_SESSION, [CAUGHT], ROSTER, 1000, { utterances: lines.slice(0, 2), readThrough: 11 }).session;
    session = okPlay(session, 1001).session;
    expect(talliesOf(session).get("H81-HARLOW")?.stats.rec).toBe(1);
    const corrected = correctPlay(session, session.plays[0].playId, { type: "add", change: { playerId: "H81-HARLOW", key: "rec_yds", amount: 5, estimated: false } }).session;
    expect(corrected.plays[0].edited).toBe(true);

    const read = readPlays(session, [next(3, 7)], ROSTER, 2000, { utterances: lines, readThrough: 15 });
    expect(read.session.plays[0].play.events.map((event) => event.action)).toEqual(["pass_incomplete"]);
    expect(read.updated.map((each) => each.playId)).toContain(session.plays[0].playId);
    expect(talliesOf(read.session).get("H81-HARLOW")).toBeUndefined();
    expect(talliesOf(read.session).get("H7-ALDERWICK")?.stats).toMatchObject({ pass_att: 1 });

    const kept = readPlays(corrected, [next(3, 7)], ROSTER, 2000, { utterances: lines, readThrough: 15 });
    expect(kept.session.plays[0].play.events.map((event) => event.action)).toContain("pass_complete");
  });
});
