import { describe, expect, it } from "vitest";
import { solveYards, statedInLines, type YardsFacts } from "@/lib/livestats/yards";

// The yards solver (v7, Part 6): forty table cases over the four methods, the
// order they are chosen in, and the agree flag. Synthetic lines.

const base: YardsFacts = { playType: "rush", yardsSaid: null, lines: [], dd: null, nextDd: null, startSpot: null, endSpot: null, penalty: "none", penaltyYards: null, ledger: null, touchdown: false };
const facts = (extra: Partial<YardsFacts>): YardsFacts => ({ ...base, ...extra });

type Want = { yards: number | null; method?: string | null; source?: string | null; agree?: boolean };

const cases: Array<[string, Partial<YardsFacts>, Want]> = [
  // Stated.
  ["the extractor's number", { yardsSaid: 7 }, { yards: 7, method: "stated", source: "stated" }],
  ["a stated loss", { yardsSaid: -3 }, { yards: -3, method: "stated" }],
  ["picks up <n> in the lines", { lines: ["fennimore picks up 8 brought down"] }, { yards: 8, method: "stated" }],
  ["gain of <n> in the lines", { lines: ["a gain of 12 on the play"] }, { yards: 12, method: "stated" }],
  ["<n> yard gain in the lines", { lines: ["a 23 yard gain for the sharks"] }, { yards: 23, method: "stated" }],
  ["loss of <n> in the lines", { lines: ["stuffed for a loss of 2"] }, { yards: -2, method: "stated" }],
  ["for <n> yards in the lines", { lines: ["castellane keeps it for 9 yards"] }, { yards: 9, method: "stated" }],
  ["a total is not this play's number", { lines: ["that gives him 94 yards on the night"] }, { yards: null, method: null }],
  ["a season figure is not this play's number", { lines: ["he had 12 touchdowns last season"] }, { yards: null }],
  ["the extractor beats the words", { yardsSaid: 5, lines: ["picks up 8"] }, { yards: 5, method: "stated", agree: true }],
  ["a sack's stated number is a loss whatever the sign", { playType: "sack", yardsSaid: 8 }, { yards: -8, method: "stated" }],
  ["a sack's loss of wins", { playType: "sack", lines: ["sacked for a loss of 6"], dd: { down: 2, distance: 8, isGoal: false }, nextDd: { down: 3, distance: 14, isGoal: false } }, { yards: -6, method: "stated", agree: true }],
  // Incompletions.
  ["an incompletion is 0 and exact", { playType: "pass_incomplete", dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 10, isGoal: false } }, { yards: 0, method: "incompletion", source: "stated" }],
  ["an incompletion ignores a number in its lines", { playType: "pass_incomplete", lines: ["incomplete he was looking for 15"] }, { yards: 0, method: "incompletion" }],
  // Down and distance.
  ["second and 3 after first and 10 is 7", { dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 3, isGoal: false } }, { yards: 7, method: "dd", source: "downs" }],
  ["third and 8 after second and 5 is a loss of 3", { dd: { down: 2, distance: 5, isGoal: false }, nextDd: { down: 3, distance: 8, isGoal: false } }, { yards: -3, method: "dd" }],
  ["fourth and 1 after third and 1 is 0", { dd: { down: 3, distance: 1, isGoal: false }, nextDd: { down: 4, distance: 1, isGoal: false } }, { yards: 0, method: "dd" }],
  ["a first down alone is at least the distance, not exact", { dd: { down: 2, distance: 6, isGoal: false }, nextDd: { down: 1, distance: 10, isGoal: false } }, { yards: null, method: null }],
  ["a first down with a stated spot is exact by the spots", { dd: { down: 2, distance: 6, isGoal: false }, nextDd: { down: 1, distance: 10, isGoal: false }, startSpot: 30, endSpot: 41 }, { yards: 11, method: "spots", agree: true }],
  ["a first down that the spots say fell short disagrees", { dd: { down: 2, distance: 6, isGoal: false }, nextDd: { down: 1, distance: 10, isGoal: false }, startSpot: 30, endSpot: 33 }, { yards: 3, method: "spots", agree: false }],
  ["and goal math: from the 15 to first and goal at the 4 is 11", { dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 1, distance: 4, isGoal: true }, startSpot: 85 }, { yards: 11, method: "dd" }],
  ["and goal with no start spot settles nothing", { dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 1, distance: 4, isGoal: true } }, { yards: null }],
  ["a next down that is not the next in the series is a missed snap", { dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 3, distance: 2, isGoal: false } }, { yards: null }],
  ["no distance said settles nothing", { dd: { down: 1, distance: null, isGoal: false }, nextDd: { down: 2, distance: 4, isGoal: false } }, { yards: null }],
  // Spots.
  ["from the own 45 to the opponent's 40 is 15", { startSpot: 45, endSpot: 60 }, { yards: 15, method: "spots", source: "spots" }],
  ["a touchdown ends at the goal line", { startSpot: 82, touchdown: true }, { yards: 18, method: "spots" }],
  ["the next play's start spot is this play's end", { startSpot: 20, nextStart: 27 }, { yards: 7, method: "spots" }],
  ["a start spot alone settles nothing", { startSpot: 20 }, { yards: null }],
  ["an end spot alone settles nothing", { endSpot: 20 }, { yards: null }],
  // The order.
  ["stated beats dd", { yardsSaid: 6, dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 4, isGoal: false } }, { yards: 6, method: "stated", agree: true }],
  ["stated and dd a yard apart still agree", { yardsSaid: 7, dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 4, isGoal: false } }, { yards: 7, method: "stated", agree: true }],
  ["stated and dd two yards apart disagree, stated kept", { yardsSaid: 9, dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 3, isGoal: false } }, { yards: 9, method: "stated", agree: false }],
  ["dd beats spots", { dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 4, isGoal: false }, startSpot: 20, endSpot: 29 }, { yards: 6, method: "dd", agree: false }],
  ["spots beat the ledger", { startSpot: 20, endSpot: 28, ledger: 5 }, { yards: 8, method: "spots", agree: true }],
  ["the ledger is last", { ledger: 5 }, { yards: 5, method: "ledger", source: "ledger", agree: true }],
  ["the ledger never counts as a disagreement", { yardsSaid: 7, ledger: 2 }, { yards: 7, method: "stated", agree: true }],
  // Penalties.
  ["a flag whose yards are unknown blocks dd", { dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 15, isGoal: false }, penalty: "offense" }, { yards: null }],
  ["a flag whose yards are known is taken out of dd", { dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 15, isGoal: false }, penalty: "offense", penaltyYards: 10 }, { yards: 5, method: "dd" }],
  ["a defensive flag's yards are taken out the other way", { dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 2, isGoal: false }, penalty: "defense", penaltyYards: 5 }, { yards: 3, method: "dd" }],
  ["a flag blocks the spots too, but not a stated number", { yardsSaid: 4, startSpot: 20, endSpot: 35, penalty: "offense" }, { yards: 4, method: "stated", agree: true }],
  ["an unclear flag blocks everything but the words", { startSpot: 20, endSpot: 35, penalty: "unclear" }, { yards: null }],
  ["not a play has nothing", { playType: "not_a_play", yardsSaid: 5 }, { yards: 5, method: "stated" }],
  // The words after the play (fix 1, Part 5): made-up TV calls.
  ["a gain of <n> after the result", { postLines: ["that's fennimore a gain of 9"] }, { yards: 9, method: "statedPost", source: "stated" }],
  ["for <n> yards after the result", { postLines: ["castellane for 4 yards on the keeper"] }, { yards: 4, method: "statedPost" }],
  ["picks up <n> on the play after the result", { postLines: ["tafita picks up 11 on the play"] }, { yards: 11, method: "statedPost" }],
  ["brought down after <n>", { postLines: ["and he is brought down after 7"] }, { yards: 7, method: "statedPost" }],
  ["a running total after the play is not this play's", { postLines: ["that gives him 64 yards for the game"] }, { yards: null }],
  ["a box-score line is not this play's", { postLines: ["fennimore now has 12 carries for 87 yards"] }, { yards: null }],
  ["this quarter's total is not this play's", { postLines: ["he has 41 yards rushing this quarter"] }, { yards: null }],
  ["an exact next down and distance beats a number after the play", { postLines: ["a gain of 9"], dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 4, isGoal: false } }, { yards: 6, method: "dd", agree: false }],
  ["the play's own words beat the words after it", { lines: ["fennimore picks up 5"], postLines: ["a gain of 6 there"] }, { yards: 5, method: "stated", agree: true }],
  ["a number after the play beats the spots", { postLines: ["a gain of 9"], startSpot: 20, endSpot: 27 }, { yards: 9, method: "statedPost", agree: false }],
  ["an incompletion stays 0 whatever is said after it", { playType: "pass_incomplete", postLines: ["he had 15 yards of room"] }, { yards: 0, method: "incompletion" }],
  ["a sack's loss after the play is a loss", { playType: "sack", postLines: ["dropped for a loss of 7"] }, { yards: -7, method: "statedPost" }],
];

describe("solveYards", () => {
  for (const [title, extra, want] of cases) {
    it(title, () => {
      const solved = solveYards(facts(extra));
      expect(solved.yards).toBe(want.yards);
      if (want.method !== undefined) expect(solved.method).toBe(want.method);
      if (want.source !== undefined) expect(solved.source).toBe(want.source);
      if (want.agree !== undefined) expect(solved.agree).toBe(want.agree);
    });
  }

  it("lists every method that spoke", () => {
    const solved = solveYards(facts({ yardsSaid: 6, dd: { down: 1, distance: 10, isGoal: false }, nextDd: { down: 2, distance: 4, isGoal: false }, startSpot: 20, endSpot: 26, ledger: 6 }));
    expect(solved.candidates.map((candidate) => candidate.method)).toEqual(["stated", "dd", "spots", "ledger"]);
    expect(solved.agree).toBe(true);
  });

  it("reads a number out of the words on its own", () => {
    expect(statedInLines(["picks up a couple"])).toBeNull();
    expect(statedInLines(["good for 11"])).toBe(11);
    expect(statedInLines(["loses 4 on the play"])).toBe(-4);
  });
});
