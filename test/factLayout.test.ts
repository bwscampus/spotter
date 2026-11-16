import { describe, expect, it } from "vitest";
import { BIG_LINE_SIZES, TEXT_COLUMN_EM } from "@/lib/cards/bigLine";
import { MAX_FACT_CHARS, MAX_FACTS } from "@/lib/cards/cardFace";
import {
  factBoxHeight,
  layoutFacts,
  MAX_FACT_SIZE_EM,
  MIN_FACT_SIZE_UNDER_SCORING_EM,
  MIN_READABLE_FACT_SIZE_EM,
  wrappedLines,
  type FactLayout,
} from "@/lib/cards/factLayout";
import type { StatLine } from "@/lib/cards/lines";
import { textWidthEm } from "@/lib/cards/statLayout";

// lib/cards/factLayout.ts (Nov 15): every fact on the card, none cut off, in a
// box whose size never depends on what is in it.

const drawnHeight = (_facts: readonly string[], layout: FactLayout) => layout.height;

const ONE_LINE = factBoxHeight({ plain: "Brightwater", before: "", stressed: "", after: "" }, { plain: "Brightwater", before: "", stressed: "", after: "", size: 1.8 });
const TWO_LINES = factBoxHeight(undefined, { plain: "Vanderkellen-\nRuiz", before: "", stressed: "", after: "", size: BIG_LINE_SIZES[0] });
const WIDEST = Array.from({ length: MAX_FACTS }, () => "W".repeat(MAX_FACT_CHARS));
const LONG = Array.from({ length: MAX_FACTS }, (_, index) => `${index + 1} Scored the winning goal in overtime against Westlake last Friday`.slice(0, MAX_FACT_CHARS));
/** Five facts at the 80-character limit: more than reads in the box under any name. */
const FULL = Array.from({ length: MAX_FACTS }, (_, index) =>
  `${index + 1} Scored the winning goal in overtime against Westlake last Friday in front of 3,000 fans`.slice(0, MAX_FACT_CHARS),
);
const SCORING: StatLine = [
  { value: "11", label: "G", estimated: false },
  { value: "6", label: "A", estimated: false },
  { value: "28", label: "PTS", estimated: false },
];

describe("wrapping", () => {
  it("counts lines by the stage font's widths, breaking a word wider than the column", () => {
    expect(wrappedLines("4-year starter", 40)).toBe(1);
    expect(wrappedLines("4-year starter", Math.max(textWidthEm("4-year"), textWidthEm("starter")) + 0.1)).toBe(2);
    expect(wrappedLines("W".repeat(20), textWidthEm("W".repeat(20)) / 4)).toBeGreaterThanOrEqual(4);
  });
});

describe("the facts box", () => {
  it("is smaller under a name that takes two lines, and never negative", () => {
    expect(TWO_LINES).toBeLessThan(ONE_LINE);
    expect(TWO_LINES).toBeGreaterThan(0);
  });

  it("draws one fact at the storyline's size in one column", () => {
    const layout = layoutFacts(["Committed to Fresno State"], ONE_LINE, "hero");
    expect(layout).toMatchObject({ size: MAX_FACT_SIZE_EM.hero, columns: 1, shown: 1, more: "", scoring: "" });
  });

  for (const [name, facts] of [["short", ["4-year starter", "Captain"]], ["long", LONG], ["widest", WIDEST]] as const) {
    for (const [box, height] of [["one-line name", ONE_LINE], ["two-line name", TWO_LINES]] as const) {
      for (const size of ["hero", "small"] as const) {
        it(`never draws the ${name} facts past the box or under reading size, and counts any it leaves off (${box}, ${size})`, () => {
          for (let count = 1; count <= facts.length; count++) {
            const list = facts.slice(0, count);
            const layout = layoutFacts(list, height, size);
            expect(drawnHeight(list, layout)).toBeLessThanOrEqual(height + 1e-9);
            if (layout.shown > 0) expect(layout.size).toBeGreaterThanOrEqual(MIN_READABLE_FACT_SIZE_EM[size]);
            const left = count - layout.shown;
            expect(layout.more).toBe(left === 0 ? "" : layout.shown > 0 ? `+${left} more` : `+${left} ${left === 1 ? "fact" : "facts"}`);
          }
        });
      }
    }
  }

  it("shows every short fact under a one-line name", () => {
    expect(layoutFacts(["4-year starter", "Captain"], ONE_LINE, "hero")).toMatchObject({ shown: 2, more: "" });
  });

  it("shows five long facts from the first as far as they read, with +N more for the rest (Jed, Nov 15)", () => {
    expect(layoutFacts(LONG, ONE_LINE, "hero")).toMatchObject({ shown: LONG.length, more: "" });
    const layout = layoutFacts(FULL, ONE_LINE, "hero");
    expect(layout.shown).toBeGreaterThan(0);
    expect(layout.shown).toBeLessThan(FULL.length);
    expect(layout.more).toBe(`+${FULL.length - layout.shown} more`);
    expect(layout.size).toBeGreaterThanOrEqual(MIN_READABLE_FACT_SIZE_EM.hero);
  });

  it("says only how many facts there are when not one reads in the box", () => {
    const layout = layoutFacts(WIDEST, TWO_LINES, "hero");
    expect(layout.shown).toBe(0);
    expect(layout.more).toBe("+5 facts");
    expect(layout.height).toBeLessThanOrEqual(TWO_LINES + 1e-9);
  });

  it("uses two columns only when they make the text clearly bigger", () => {
    const short = ["4-year starter", "Team captain", "All-league 1st team", "Committed to Cal Poly", "School record 41 sacks"];
    const two = layoutFacts(short, ONE_LINE, "hero");
    expect(two.columns).toBe(2);
    expect(two.split).toBeGreaterThan(0);
    expect(two.split).toBeLessThan(short.length);
    expect(layoutFacts(LONG.slice(0, 2), ONE_LINE, "hero").columns).toBe(1);
  });
});

describe("the scoring row", () => {
  it("goes first, bold-sized, and the facts fit under it or leave", () => {
    const layout = layoutFacts(["Committed to Fresno State"], ONE_LINE, "hero", SCORING);
    expect(layout.scoring).toBe("11 G · 6 A · 28 PTS");
    expect(layout.shown).toBe(1);
    expect(drawnHeight(["Committed to Fresno State"], layout)).toBeLessThanOrEqual(ONE_LINE + 1e-9);
    const crowded = layoutFacts(WIDEST, TWO_LINES, "hero", SCORING);
    expect(crowded.scoring).toBe("11 G · 6 A · 28 PTS");
    expect(crowded).toMatchObject({ shown: 0, more: "" });
    const some = layoutFacts(LONG, ONE_LINE, "hero", SCORING);
    if (some.shown > 0) expect(some.size).toBeGreaterThanOrEqual(MIN_FACT_SIZE_UNDER_SCORING_EM.hero);
  });

  it("fits the name column across, and the box down, even under a name on two lines", () => {
    for (const height of [ONE_LINE, TWO_LINES]) {
      const layout = layoutFacts(FULL, height, "hero", SCORING);
      expect(textWidthEm(layout.scoring) * layout.scoringSize).toBeLessThanOrEqual(TEXT_COLUMN_EM);
      expect(layout.height).toBeLessThanOrEqual(height + 1e-9);
    }
  });
});
