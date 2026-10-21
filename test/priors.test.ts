import { describe, expect, it } from "vitest";
import type { TonightTally } from "@/lib/cards/tonight";
import { applyPriors, inferredBack, RB_SHARE, unattributedOf } from "@/lib/livestats/priors";
import { NO_PENALTY, type StatsPlay } from "@/lib/livestats/types";
import { ROSTER } from "./parse/roster";

// Honest priors (v7, Part 7): the quarterback for a pass nobody threw; no
// runner guessed by default; the dominant back only above the share, behind
// the setting; a player out tonight never filled in.

const QBS = { home: "H7-CASTELLANE", away: "A9-LANGAN" } as const;

function play(events: StatsPlay["events"], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart: 0,
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
    summary: "",
    evidence: "",
    events,
    penalty: NO_PENALTY,
    ...extra,
  };
}

const tonight = (fennimore: number, pellegrosso: number) =>
  new Map<string, TonightTally>([
    ["H22-FENNIMORE", { stats: { rush_att: fennimore }, estimated: [] }],
    ["H40-PELLEGROSSO", { stats: { rush_att: pellegrosso }, estimated: [] }],
  ]);

describe("applyPriors", () => {
  it("gives a pass nobody threw to the quarterback on the field, estimated, as prior:qb", () => {
    const result = applyPriors(play([{ playerId: "", action: "pass_complete", yards: 8, yardsSource: "stated", made: null }, { playerId: "H3-TAFITA", action: "reception", yards: 8, yardsSource: "stated", made: null }], { playType: "pass" }), ROSTER, { allowInferredRb: false, qbs: QBS });
    expect(result.play.events[0]).toMatchObject({ playerId: "H7-CASTELLANE", action: "pass_complete", estimated: true });
    expect(result.notes).toEqual([{ playerId: "", action: "pass_complete", rule: "R14", reason: expect.stringContaining("prior:qb"), kind: "filled", to: "H7-CASTELLANE" }]);
  });

  it("fills no passer when nobody knows which side has the ball (fix 1, Part 3)", () => {
    const result = applyPriors(play([{ playerId: "", action: "pass_complete", yards: 8, yardsSource: "stated", made: null }], { playType: "pass", offense: null }), ROSTER, { allowInferredRb: false, qbs: QBS });
    expect(result.play.events[0].playerId).toBe("");
    expect(result.notes).toEqual([]);
  });

  it("never guesses a runner or a receiver by default", () => {
    const unnamed = play([{ playerId: "", action: "rush", yards: 4, yardsSource: "stated", made: null }]);
    const result = applyPriors(unnamed, ROSTER, { allowInferredRb: false, qbs: QBS, tonight: tonight(9, 0) });
    expect(result.play).toBe(unnamed);
    expect(result.notes).toEqual([]);
    const catchless = play([{ playerId: "H7-CASTELLANE", action: "pass_complete", yards: 8, yardsSource: "stated", made: null }, { playerId: "", action: "reception", yards: 8, yardsSource: "stated", made: null }], { playType: "pass" });
    expect(applyPriors(catchless, ROSTER, { allowInferredRb: true, qbs: QBS, tonight: tonight(9, 0) }).play).toBe(catchless);
  });

  it("fills the dominant back only when allowed and only above the share", () => {
    const unnamed = play([{ playerId: "", action: "rush", yards: 4, yardsSource: "stated", made: null }]);
    const filled = applyPriors(unnamed, ROSTER, { allowInferredRb: true, qbs: QBS, tonight: tonight(9, 1) });
    expect(filled.play.events[0]).toMatchObject({ playerId: "H22-FENNIMORE", estimated: true });
    expect(filled.notes[0]).toMatchObject({ rule: "R9", to: "H22-FENNIMORE", reason: expect.stringContaining("prior:rb") });
    // 7 of 10 is under the share; too few carries is no share at all.
    expect(applyPriors(unnamed, ROSTER, { allowInferredRb: true, qbs: QBS, tonight: tonight(7, 3) }).play).toBe(unnamed);
    expect(applyPriors(unnamed, ROSTER, { allowInferredRb: true, qbs: QBS, tonight: tonight(2, 0) }).play).toBe(unnamed);
    expect(inferredBack(ROSTER, "home", tonight(8, 2))).toBe("H22-FENNIMORE");
    expect(inferredBack(ROSTER, "home", tonight(7, 3))).toBeNull();
    expect(RB_SHARE).toBe(0.8);
  });

  it("never fills a player marked out tonight", () => {
    const out = new Set(["H7-CASTELLANE", "H22-FENNIMORE"]);
    const pass = play([{ playerId: "", action: "pass_incomplete", yards: null, yardsSource: null, made: null }], { playType: "pass" });
    expect(applyPriors(pass, ROSTER, { allowInferredRb: true, qbs: QBS, out }).play).toBe(pass);
    const rush = play([{ playerId: "", action: "rush", yards: 4, yardsSource: "stated", made: null }]);
    expect(applyPriors(rush, ROSTER, { allowInferredRb: true, qbs: QBS, out, tonight: tonight(9, 0) }).play).toBe(rush);
  });

  it("lists the team's unattributed lines from the counted plays", () => {
    const plays = [
      { playId: "1", status: "applied", play: play([{ playerId: "", action: "rush", yards: 4, yardsSource: "stated", made: null }]) },
      { playId: "2", status: "applied", play: play([{ playerId: "H7-CASTELLANE", action: "pass_complete", yards: 8, yardsSource: "stated", made: null }, { playerId: "", action: "reception", yards: 8, yardsSource: "stated", made: null }], { playType: "pass" }) },
      { playId: "3", status: "pending", play: play([{ playerId: "", action: "rush", yards: 9, yardsSource: "stated", made: null }]) },
      { playId: "4", status: "applied", play: play([{ playerId: "", action: "rush", yards: null, yardsSource: null, made: null }]) },
    ];
    expect(unattributedOf(plays).map((line) => line.text)).toEqual(["Unattributed rush: 4 yds", "Unattributed catch: 8 yds", "Unattributed rush"]);
    expect(unattributedOf(plays)[0]).toMatchObject({ side: "home", kind: "rush", yards: 4, playId: "1" });
  });
});
