import { describe, expect, it } from "vitest";
import { parseNumbers } from "@/lib/livestats/parse/numbers";
import { tokenize } from "@/lib/livestats/parse/tokens";

// Numbers as the transcript writes them (v7, Part 2). Table-driven.

const cases: Array<[string, Array<[number, boolean]>]> = [
  ["picks up 7", [[7, false]]],
  ["third and seven", [[7, false]]],
  ["twenty three yard gain", [[23, false]]],
  ["gain of twenty", [[20, false]]],
  ["a yard short", [[1, false]]],
  ["third and inches", [[0.5, true]]],
  ["picks up a couple", [[2, true]]],
  ["a handful of yards", [[5, true]]],
  ["for 1 81 yards tonight", [[181, true], [1, false], [81, false]]],
  ["0.5 a yard to go", [[0.5, true]]],
  ["no numbers here", []],
  ["number 22 the tailback", [[22, false]]],
  ["#22 up the middle", [[22, false]]],
];

describe("parseNumbers", () => {
  for (const [text, expected] of cases) {
    it(text, () => {
      const found = parseNumbers(tokenize(text)).map((number) => [number.value, number.fuzzy] as [number, boolean]);
      expect(found).toEqual(expected);
    });
  }

  it("keeps the token span of each number", () => {
    const words = tokenize("second and twenty three from the 40");
    const [first, second] = parseNumbers(words);
    expect(words.slice(first.start, first.end + 1)).toEqual(["twenty", "three"]);
    expect(words.slice(second.start, second.end + 1)).toEqual(["40"]);
  });
});

describe("tokenize", () => {
  it("lowercases, drops punctuation, keeps digits and decimals, and reads a possessive as its word", () => {
    expect(tokenize("Fennimore's run, 0.5 a yard. #22!")).toEqual(["fennimore", "run", "0.5", "a", "yard", "number", "22"]);
  });
});
