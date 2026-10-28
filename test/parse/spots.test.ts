import { describe, expect, it } from "vitest";
import { parseSpots, spotProgress, type SpotMention } from "@/lib/livestats/parse/spots";
import { TEAMS } from "./roster";

// Yard lines as the booth says them (v7, Part 2). Table-driven, synthetic.

type Expected = Array<Partial<SpotMention>>;

const cases: Array<[string, Expected, { offense?: "home" | "away" }?]> = [
  ["at the 35", [{ yardLine: 35, territory: "unknown", kind: "at" }]],
  ["out to the 35", [{ yardLine: 35, kind: "end" }]],
  ["from the 28 to the 41", [{ yardLine: 28, kind: "start" }, { yardLine: 41, kind: "end" }]],
  ["own 20", [{ yardLine: 20, territory: "own" }]],
  ["from their own 20", [{ yardLine: 20, territory: "own", kind: "start" }]],
  ["bulldogs 40", [{ yardLine: 40, territory: "opp", team: "away" }], { offense: "home" }],
  ["bulldogs 40", [{ yardLine: 40, territory: "own", team: "away" }], { offense: "away" }],
  ["bulldogs 40", [{ yardLine: 40, territory: "unknown", team: "away" }]],
  ["down to the sharks 12", [{ yardLine: 12, territory: "opp", team: "home", kind: "end" }], { offense: "away" }],
  ["midfield", [{ yardLine: 50, territory: "mid" }]],
  ["at the 50", [{ yardLine: 50, territory: "mid" }]],
  ["across midfield to the 40", [{ yardLine: 50, territory: "mid" }, { yardLine: 40, territory: "opp", kind: "end" }], { offense: "home" }],
  ["inside the 5", [{ yardLine: 5, approximate: true, kind: "end" }]],
  ["past the 30", [{ yardLine: 30, approximate: true, kind: "end" }]],
  ["near the 40", [{ yardLine: 40, approximate: true }]],
  ["to the goal line", [{ yardLine: 0, territory: "opp", kind: "end" }]],
  ["into the end zone", [{ yardLine: 0, territory: "opp", kind: "end" }]],
  ["from the goal line", [{ yardLine: 0, territory: "own", kind: "start" }]],
  ["into enemy territory at the 45", [{ yardLine: 45, territory: "opp" }]],
  ["at the opponent's 30", [{ yardLine: 30, territory: "opp" }]],
  ["in plus territory at the 38", [{ yardLine: 38, territory: "opp" }]],
  ["third and 4", []],
  ["number 22 the tailback", []],
  ["picks up 8 yards", []],
  ["gain of 12", []],
  ["for 15", []],
  ["a 23 yard gain", []],
  ["the 7 point lead", []],
  ["he is 14 of 20", []],
  ["second and 4 from the 31", [{ yardLine: 31, kind: "start" }]],
  ["first and 10 at the 46", [{ yardLine: 46, kind: "at" }]],
  ["at the 55", []],
];

describe("parseSpots", () => {
  for (const [text, expected, context] of cases) {
    it(`${text}${context?.offense ? ` (${context.offense} has the ball)` : ""}`, () => {
      const found = parseSpots(text, { teams: TEAMS, offense: context?.offense ?? null });
      expect(found).toHaveLength(expected.length);
      expected.forEach((want, index) => expect(found[index]).toMatchObject(want));
    });
  }
});

describe("spotProgress", () => {
  const at = (yardLine: number, territory: SpotMention["territory"], team?: "home" | "away"): SpotMention => ({ yardLine, territory, ...(team ? { team } : {}), kind: "at", approximate: false, span: [0, 0] });
  it("turns a spot into yards from the offense's goal line", () => {
    expect(spotProgress(at(20, "own"))).toBe(20);
    expect(spotProgress(at(20, "opp"))).toBe(80);
    expect(spotProgress(at(50, "mid"))).toBe(50);
    expect(spotProgress(at(40, "unknown"))).toBeNull();
    expect(spotProgress(at(40, "unknown", "away"), "home")).toBe(60);
    expect(spotProgress(at(40, "unknown", "away"), "away")).toBe(40);
  });
});
