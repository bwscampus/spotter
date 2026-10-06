import { describe, expect, it } from "vitest";
import { matchStats, type StatBlock, type StatsPlayer } from "@/lib/stats/matchStats";

// A stat put under the wrong name is read on air as fact, so everything here is
// about refusing to guess.

const player = (id: string, jersey: string | null, last_name: string): StatsPlayer => ({ id, jersey, last_name });
const block = (jersey: string | null, last_name: string, ...lines: string[]): StatBlock => ({
  jersey,
  last_name,
  lines: lines.length > 0 ? lines : ["1 line"],
});

const ROSTER = [
  player("a", "0", "Sullivan"),
  player("b", "8", "Mikail"),
  player("c", "6", "Jackson"),
  player("d", "17", "Ossuetta"),
];

describe("matchStats", () => {
  it("places a block by jersey", () => {
    const { matched, unmatched } = matchStats(ROSTER, [block("8", "Mikail", "826 pass yds, 10 TD, 1 INT")]);
    expect(unmatched).toEqual([]);
    expect(matched).toHaveLength(1);
    expect(matched[0].player.id).toBe("b");
    expect(matched[0].block.lines).toEqual(["826 pass yds, 10 TD, 1 INT"]);
  });

  it("tells you when the jersey placed it but the surname did not agree", () => {
    // The sheet abbreviates, so this is worth surfacing rather than refusing.
    const { matched } = matchStats(ROSTER, [block("8", "Mikhail")]);
    expect(matched[0].player.id).toBe("b");
    expect(matched[0].mismatchedName).toBe("Mikhail");
  });

  it("does not flag a surname that only differs by punctuation", () => {
    const roster = [player("x", "5", "O'Brien")];
    const { matched } = matchStats(roster, [block("5", "OBrien")]);
    expect(matched[0].mismatchedName).toBeUndefined();
  });

  it("falls back to the surname when the sheet has no jersey", () => {
    const { matched, unmatched } = matchStats(ROSTER, [block(null, "Ossuetta")]);
    expect(unmatched).toEqual([]);
    expect(matched[0].player.id).toBe("d");
  });

  it("refuses a jersey shared by two players when the surname does not settle it", () => {
    const roster = [player("a", "12", "Williams"), player("b", "12", "Chen")];
    const { matched, unmatched } = matchStats(roster, [block("12", "Nobody")]);
    expect(matched).toEqual([]);
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].reason).toContain("#12");
  });

  it("settles a shared jersey when the surname picks one out", () => {
    const roster = [player("a", "12", "Williams"), player("b", "12", "Chen")];
    const { matched } = matchStats(roster, [block("12", "Chen")]);
    expect(matched[0].player.id).toBe("b");
  });

  it("refuses a surname shared by two players when the jersey is no help", () => {
    const roster = [player("a", "10", "Williams"), player("b", "23", "Williams")];
    const { matched, unmatched } = matchStats(roster, [block("99", "Williams")]);
    expect(matched).toEqual([]);
    expect(unmatched[0].reason).toContain("Williams");
  });

  it("reports a block that belongs to nobody, and says so by number", () => {
    const { matched, unmatched } = matchStats(ROSTER, [block("44", "Nobody")]);
    expect(matched).toEqual([]);
    expect(unmatched[0].reason).toBe("No #44 Nobody on the roster.");
  });

  it("keeps the first block when a player appears twice", () => {
    const { matched, unmatched } = matchStats(ROSTER, [
      block("8", "Mikail", "first"),
      block("8", "Mikail", "second"),
    ]);
    expect(matched).toHaveLength(1);
    expect(matched[0].block.lines).toEqual(["first"]);
    expect(unmatched[0].reason).toContain("already has stats");
  });

  it("lists the players the sheet said nothing about", () => {
    const { silent } = matchStats(ROSTER, [block("8", "Mikail"), block("6", "Jackson")]);
    expect(silent.map((entry) => entry.id).sort()).toEqual(["a", "d"]);
  });

  it("treats 0 and 00 as different jerseys", () => {
    const roster = [player("a", "0", "Zero"), player("b", "00", "DoubleZero")];
    const { matched } = matchStats(roster, [block("00", "DoubleZero")]);
    expect(matched[0].player.id).toBe("b");
  });

  it("does nothing at all with an empty sheet", () => {
    const { matched, unmatched, silent } = matchStats(ROSTER, []);
    expect(matched).toEqual([]);
    expect(unmatched).toEqual([]);
    expect(silent).toHaveLength(ROSTER.length);
  });
});
