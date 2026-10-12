import { describe, expect, it } from "vitest";
import { resolveSpots, SPOT_QUALIFIER_SPAN, spotWords } from "@/lib/livestats/fieldWords";
import { EMPTY_SESSION, readPlays } from "@/lib/livestats/session";
import { NO_PENALTY, type StatsEvent, type StatsPlay, type StatsRosterPlayer, type TeamWords } from "@/lib/livestats/types";

// =============================================================================
// Field-position words (lib/livestats/fieldWords.ts, R37): the words beside a
// yard line say whose half it is in. Made-up teams and names.
// =============================================================================

const TEAMS: TeamWords = { home: { name: "Northfield", phrases: ["northfield", "bears"] }, away: { name: "Southpoint", phrases: ["southpoint", "tigers", "tiger"] } };

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

const rush = (yards: number | null = null): StatsEvent => ({ playerId: "H22-FENNIMORE", action: "rush", yards, yardsSource: yards === null ? null : "stated", made: null });

function play(extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart: 1,
    seqEnd: 1,
    quarter: null,
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
    events: [rush()],
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: NO_PENALTY,
    ...extra,
  };
}

describe("resolveSpots", () => {
  it("puts a team's yard line in that team's half, whichever side has the ball", () => {
    // The Tigers (away) are on defense: "the tigers 30" is the away 30.
    const resolved = resolveSpots(play({ endSpot: { yardLine: 30, territory: "unknown" } }), "fennimore breaks one down to the tigers 30", TEAMS);
    expect(resolved.play.endSpot).toEqual({ yardLine: 30, territory: "away" });
    expect(resolved.notes).toEqual([expect.objectContaining({ rule: "R37", kind: "changed", action: "end_spot" })]);
    // "northfield 30" with Northfield on offense is the home 30.
    expect(resolveSpots(play({ endSpot: { yardLine: 30, territory: "unknown" } }), "pushed back to the northfield 30", TEAMS).play.endSpot).toEqual({ yardLine: 30, territory: "home" });
  });

  it('"own N" is the offense\'s half, "opponent\'s N" and "across midfield" the defense\'s', () => {
    expect(resolveSpots(play({ startSpot: { yardLine: 25, territory: "unknown" } }), "first and ten from their own 25", TEAMS).play.startSpot).toEqual({ yardLine: 25, territory: "home" });
    expect(resolveSpots(play({ endSpot: { yardLine: 40, territory: "unknown" } }), "out to the opponent's 40", TEAMS).play.endSpot).toEqual({ yardLine: 40, territory: "away" });
    expect(resolveSpots(play({ endSpot: { yardLine: 40, territory: "unknown" } }), "across midfield to the 40", TEAMS).play.endSpot).toEqual({ yardLine: 40, territory: "away" });
    expect(resolveSpots(play({ endSpot: { yardLine: 40, territory: "unknown" }, offense: null }), "across midfield to the 40", TEAMS).play.endSpot).toEqual({ yardLine: 40, territory: "unknown" });
  });

  it('"midfield" and "the 50" are the 50', () => {
    expect(resolveSpots(play({ endSpot: { yardLine: 50, territory: "unknown" } }), "out to midfield", TEAMS).play.endSpot).toEqual({ yardLine: 50, territory: "midfield" });
    expect(resolveSpots(play({ endSpot: null }), "all the way out to the 50", TEAMS).play.endSpot).toEqual({ yardLine: 50, territory: "midfield" });
  });

  it("never overrides a half the reader stated, and leaves a number the words do not place", () => {
    const stated = play({ endSpot: { yardLine: 30, territory: "home" } });
    expect(resolveSpots(stated, "down to the tigers 30", TEAMS).play.endSpot).toEqual({ yardLine: 30, territory: "home" });
    const unplaced = resolveSpots(play({ endSpot: { yardLine: 30, territory: "unknown" } }), "down to the 30", TEAMS);
    expect(unplaced.play.endSpot).toEqual({ yardLine: 30, territory: "unknown" });
    expect(unplaced.notes).toEqual([]);
    // Two mentions that disagree settle nothing.
    expect(resolveSpots(play({ endSpot: { yardLine: 30, territory: "unknown" } }), "from the bears 30 to the tigers 30", TEAMS).play.endSpot).toEqual({ yardLine: 30, territory: "unknown" });
  });

  it("supplies a missing end spot from \"inside the N\" or \"near the N\", and a start from \"from the N\"", () => {
    const inside = resolveSpots(play({ endSpot: null }), "fennimore carries it inside the tigers 10", TEAMS);
    expect(inside.play.endSpot).toEqual({ yardLine: 10, territory: "away" });
    expect(inside.notes[0].reason).toMatch(/end spot from the words/);
    expect(resolveSpots(play({ endSpot: null }), "near the 35", TEAMS).play.endSpot).toEqual({ yardLine: 35, territory: "unknown" });
    expect(resolveSpots(play({ startSpot: null, endSpot: null }), "from the own 20 out to the 28", TEAMS).play).toMatchObject({
      startSpot: { yardLine: 20, territory: "home" },
      endSpot: { yardLine: 28, territory: "unknown" },
    });
    // "3rd and 4" and a jersey number are not yard lines.
    expect(resolveSpots(play({ endSpot: null }), "third and 4 handoff to number 22", TEAMS).play.endSpot).toBeNull();
    // A play with no spot fields at all (an older log) is left alone.
    const bare = play();
    delete bare.endSpot;
    expect(resolveSpots(bare, "down to the tigers 30", TEAMS).play.endSpot).toBeUndefined();
  });

  it("looks only a few words back for the qualifier", () => {
    const far = "bears ".repeat(SPOT_QUALIFIER_SPAN + 1) + "the ball goes down to the 30";
    expect(resolveSpots(play({ endSpot: { yardLine: 30, territory: "unknown" } }), far, TEAMS).play.endSpot?.territory).toBe("unknown");
    expect(spotWords("the Opponent's 40-yard line")).toEqual(["the", "opponent", "40", "yard", "line"]);
  });

  it("reaches the yards through readPlays: \"Tigers 30\" with the Tigers on defense, from a fresh start", () => {
    const first = play({ seqStart: 1, seqEnd: 1, startSpot: { yardLine: 20, territory: "home" }, endSpot: { yardLine: 30, territory: "unknown" }, events: [rush()] });
    const read = readPlays(EMPTY_SESSION, [first], ROSTER, 0, {
      teams: TEAMS,
      utterances: [{ seq: 1, text: "first and ten from their own 20 fennimore all the way out to the tigers 30" }],
    });
    // Home 20 to the away 30 is 50 yards: over the cap, so blank; the spot is still placed.
    expect(read.added[0].play.endSpot).toEqual({ yardLine: 30, territory: "away" });
    const short = play({ seqStart: 1, seqEnd: 1, startSpot: { yardLine: 45, territory: "home" }, endSpot: { yardLine: 30, territory: "unknown" }, events: [rush()] });
    const near = readPlays(EMPTY_SESSION, [short], ROSTER, 0, {
      teams: TEAMS,
      utterances: [{ seq: 1, text: "from the 45 fennimore out to the tigers 30" }],
    });
    expect(near.added[0].play.events[0]).toMatchObject({ yards: 25, yardsSource: "spots" });
    expect(near.added[0].changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 25, estimated: true });
    expect(near.added[0].dropped.map((d) => d.rule)).toEqual(expect.arrayContaining(["R37", "R23"]));
  });
});
