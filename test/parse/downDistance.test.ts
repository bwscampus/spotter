import { describe, expect, it } from "vitest";
import { parseDownDistance } from "@/lib/livestats/parse/downDistance";

// The down and distance call, every way a booth says it and the transcript
// writes it (v7, Part 2). Table-driven, synthetic lines.

type Expected = { down: number; distance: number | null; isGoal?: boolean; fuzzy?: boolean } | null;

const cases: Array<[string, Expected]> = [
  ["third and 7", { down: 3, distance: 7 }],
  ["3rd and seven", { down: 3, distance: 7 }],
  ["3rd and 7 for the sharks", { down: 3, distance: 7 }],
  ["second an 4", { down: 2, distance: 4 }],
  ["second and 4 from the 31", { down: 2, distance: 4 }],
  ["fourth and goal from the 2", { down: 4, distance: 2, isGoal: true }],
  ["first and goal", { down: 1, distance: null, isGoal: true }],
  ["1st and goal at the 8", { down: 1, distance: 8, isGoal: true }],
  ["first and ten", { down: 1, distance: 10 }],
  ["1st and 10 at the 46", { down: 1, distance: 10 }],
  ["second and long", { down: 2, distance: null, fuzzy: true }],
  ["third and short", { down: 3, distance: null, fuzzy: true }],
  ["third and inches", { down: 3, distance: 0.5, fuzzy: true }],
  ["fourth and a yard", { down: 4, distance: 1 }],
  ["4th and 1", { down: 4, distance: 1 }],
  ["first down at the 46", { down: 1, distance: null }],
  ["first down from the 46", { down: 1, distance: null }],
  ["on first down they run it", { down: 1, distance: null }],
  ["on third down here", { down: 3, distance: null }],
  ["third down and 7", { down: 3, distance: 7 }],
  ["2nd down and 12", { down: 2, distance: 12 }],
  ["7 to go on third down", { down: 3, distance: 7 }],
  ["third down 7 to go", { down: 3, distance: 7 }],
  ["second and 15 after the flag", { down: 2, distance: 15 }],
  ["first down", null],
  ["picks up the first down", null],
  ["that is a first down sharks", null],
  ["the first quarter", null],
  ["second half kickoff", null],
  ["second and 100", { down: 2, distance: null }],
  ["quillon in on the tackle", null],
  ["third and 7 then fourth and 2", { down: 3, distance: 7 }],
  // Deepgram's numerals write "a third" as 0.333 and "a fourth" as 0.25 (fix 1, Part 2).
  ["it's 0.333 and 1 tight formation", { down: 3, distance: 1 }],
  ["now 0.333 down and 18", { down: 3, distance: 18 }],
  ["0.25 down and 2", { down: 4, distance: 2 }],
  ["early in the 4th 0.25", null],
  ["0.333 of the way there", null],
];

describe("parseDownDistance", () => {
  for (const [text, expected] of cases) {
    it(text, () => {
      const found = parseDownDistance(text, 4);
      if (expected === null) {
        expect(found).toBeNull();
        return;
      }
      expect(found).not.toBeNull();
      expect(found!.down).toBe(expected.down);
      expect(found!.distance).toBe(expected.distance);
      expect(found!.isGoal).toBe(expected.isGoal ?? false);
      expect(found!.fuzzy).toBe(expected.fuzzy ?? false);
      expect(found!.lineIdx).toBe(4);
    });
  }

  it("says which tokens the call spans", () => {
    const found = parseDownDistance("and now third and seven from the 31")!;
    expect(found.span).toEqual([2, 4]);
  });
});
