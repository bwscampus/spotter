import { describe, expect, it } from "vitest";
import { parseContextFor, parseLine } from "@/lib/livestats/parse";
import { flipsOf, voteOf } from "@/lib/livestats/possession";
import { NO_PENALTY, type StatsEvent, type StatsPlay } from "@/lib/livestats/types";
import { ROSTER, TEAMS } from "./parse/roster";

// Who has the ball from evidence (v7, fix 1, Part 3): the vote of the
// offensive players a segment names, and the flips the counted plays imply.
// Synthetic roster: Harborview (home: Castellane QB, Fennimore RB, Tafita WR)
// and Millbrook (away: Langan QB, Amesbury RB, Ndiaye-Hall WR, Duarte P,
// Quillon LB, Grenville S).

const context = parseContextFor(ROSTER, TEAMS, null);
const lines = (...texts: string[]) => texts.map((text, seq) => parseLine(text, context, seq));

describe("voteOf", () => {
  it("counts a quarterback twice and a back or receiver once", () => {
    expect(voteOf(lines("castellane hands it to fennimore"), ROSTER)).toEqual({ side: "home", margin: 3 });
    expect(voteOf(lines("langan throws to ndiaye hall"), ROSTER)).toEqual({ side: "away", margin: 3 });
  });

  it("never counts a defender", () => {
    expect(voteOf(lines("brought down by quillon and grenville"), ROSTER)).toBeNull();
    expect(voteOf(lines("fennimore up the middle stopped by quillon"), ROSTER)).toEqual({ side: "home", margin: 1 });
  });

  it("counts a quarterback named before the snap, and nobody else named there (fix 1, item 4)", () => {
    const pre = lines("castellane in the shotgun fennimore beside him");
    expect(voteOf(lines("the pass is complete over the middle"), ROSTER, pre)).toEqual({ side: "home", margin: 2 });
    expect(voteOf(lines("the pass is complete over the middle"), ROSTER, lines("fennimore set deep"))).toBeNull();
    // Named in the play as well: he counts once.
    expect(voteOf(lines("castellane throws incomplete"), ROSTER, pre)).toEqual({ side: "home", margin: 2 });
  });

  it("does not count a name both teams have (fix 1, item 4)", () => {
    // Brown is a home receiver and an away corner.
    expect(voteOf(lines("brown makes the catch at the 30"), ROSTER)).toBeNull();
    expect(voteOf(lines("eli brown makes the catch at the 30"), ROSTER)).toEqual({ side: "home", margin: 1 });
  });

  it("says nothing for a tie", () => {
    expect(voteOf(lines("tafita and amesbury both on the field"), ROSTER)).toBeNull();
  });
});

const play = (seqStart: number, seqEnd: number, extra: Partial<StatsPlay>, events: Array<Partial<StatsEvent> & Pick<StatsEvent, "playerId" | "action">>): { status: string; play: StatsPlay } => ({
  status: "applied",
  play: {
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
    summary: "",
    evidence: "",
    penalty: NO_PENALTY,
    startSpot: null,
    endSpot: null,
    ...extra,
    events: events.map((event) => ({ yards: null, yardsSource: null, made: null, ...event })),
  },
});

describe("flipsOf", () => {
  it("gives the ball to the side a punt went to", () => {
    expect(flipsOf([play(10, 12, { playType: "punt", offense: "away" }, [{ playerId: "A2-DUARTE", action: "punt", yards: 40 }])], ROSTER)).toEqual([{ side: "home", basis: "flip", seq: 12 }]);
  });

  it("gives the ball to a kickoff's returner, and says nothing for a kickoff nobody returned", () => {
    expect(flipsOf([play(5, 6, { playType: "kickoff", offense: "away" }, [{ playerId: "A32-AMESBURY", action: "kick_return", yards: 20 }])], ROSTER)).toEqual([{ side: "away", basis: "flip", seq: 6 }]);
    expect(flipsOf([play(5, 6, { playType: "kickoff", offense: "away" }, [])], ROSTER)).toEqual([]);
  });

  it("gives the ball to the side that intercepted", () => {
    expect(flipsOf([play(20, 21, { playType: "pass" }, [{ playerId: "H7-CASTELLANE", action: "pass_intercepted" }, { playerId: "A4-BROWN", action: "interception" }])], ROSTER)).toEqual([{ side: "away", basis: "flip", seq: 21 }]);
  });

  it("keeps a touchdown's try with the side that scored, and flips once the try is in", () => {
    const flips = flipsOf(
      [
        play(30, 31, { touchdown: true }, [{ playerId: "H22-FENNIMORE", action: "rush", yards: 12 }]),
        play(33, 33, { playType: "extra_point", offense: "home" }, [{ playerId: "H1-WHITLOCK", action: "extra_point", made: true }]),
      ],
      ROSTER,
    );
    expect(flips).toEqual([{ side: "away", basis: "flip", seq: 33 }]);
  });

  it("turns the ball over on downs, and after a field goal, made or missed", () => {
    expect(flipsOf([play(40, 41, { down: 4, distance: 2 }, [{ playerId: "H22-FENNIMORE", action: "rush", yards: 1 }])], ROSTER)).toEqual([{ side: "away", basis: "flip", seq: 41 }]);
    expect(flipsOf([play(40, 41, { down: 4, distance: 2 }, [{ playerId: "H22-FENNIMORE", action: "rush", yards: 3 }])], ROSTER)).toEqual([]);
    expect(flipsOf([play(50, 51, { playType: "field_goal", offense: "home" }, [{ playerId: "H1-WHITLOCK", action: "field_goal", made: false, yards: 41 }])], ROSTER)).toEqual([{ side: "away", basis: "flip", seq: 51 }]);
  });

  it("skips a discarded play and a play a flag wiped out", () => {
    const punt = play(10, 12, { playType: "punt", offense: "away" }, [{ playerId: "A2-DUARTE", action: "punt", yards: 40 }]);
    expect(flipsOf([{ ...punt, status: "discarded" }], ROSTER)).toEqual([]);
    expect(flipsOf([{ ...punt, play: { ...punt.play, nullified: true } }], ROSTER)).toEqual([]);
  });
});
