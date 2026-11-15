import { describe, expect, it } from "vitest";
import { BIG_LINE_SIZES, TEXT_COLUMN_EM } from "@/lib/cards/bigLine";
import { MAX_FACT_CHARS, MAX_FACTS } from "@/lib/cards/cardFace";
import { factBoxHeight, layoutFacts, MAX_FACT_SIZE_EM, wrappedLines, type FactLayout } from "@/lib/cards/factLayout";
import type { StatLine } from "@/lib/cards/lines";
import { textWidthEm } from "@/lib/cards/statLayout";

// lib/cards/factLayout.ts (Nov 15): every fact on the card, none cut off, in a
// box whose size never depends on what is in it.

const drawnHeight = (_facts: readonly string[], layout: FactLayout) => layout.height;

const ONE_LINE = factBoxHeight({ plain: "Brightwater", before: "", stressed: "", after: "" }, { plain: "Brightwater", before: "", stressed: "", after: "", size: 1.8 });
const TWO_LINES = factBoxHeight(undefined, { plain: "Vanderkellen-\nRuiz", before: "", stressed: "", after: "", size: BIG_LINE_SIZES[0] });
const WIDEST = Array.from({ length: MAX_FACTS }, () => "W".repeat(MAX_FACT_CHARS));
const LONG = Array.from({ length: MAX_FACTS }, (_, index) => `${index + 1} Scored the winning goal in overtime against Westlake last Friday`.slice(0, MAX_FACT_CHARS));
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
    expect(layout).toMatchObject({ size: MAX_FACT_SIZE_EM.hero, columns: 1, showFacts: true, scoring: "" });
  });

  for (const [name, facts] of [["short", ["4-year starter", "Captain"]], ["long", LONG], ["widest", WIDEST]] as const) {
    for (const [box, height] of [["one-line name", ONE_LINE], ["two-line name", TWO_LINES]] as const) {
      for (const size of ["hero", "small"] as const) {
        it(`fits every one of the ${name} facts whole (${box}, ${size})`, () => {
          for (let count = 1; count <= facts.length; count++) {
            const list = facts.slice(0, count);
            const layout = layoutFacts(list, height, size);
            expect(layout.showFacts).toBe(true);
            expect(drawnHeight(list, layout)).toBeLessThanOrEqual(height + 1e-9);
          }
        });
      }
    }
  }

  it("keeps five long facts readable under a one-line name: at least 0.3em of the stage", () => {
    expect(layoutFacts(LONG, ONE_LINE, "hero").size).toBeGreaterThanOrEqual(0.3);
  });

  it("uses two columns only when they make the text clearly bigger", () => {
    const short = ["4-year starter", "Team captain", "All-league 1st team", "Committed to Cal Poly", "School record 41 sacks"];
    const two = layoutFacts(short, ONE_LINE, "hero");
    expect(two.columns).toBe(2);
    expect(two.split).toBeGreaterThan(0);
    expect(two.split).toBeLessThan(short.length);
    expect(layoutFacts(LONG, ONE_LINE, "hero").columns).toBe(1);
  });
});

describe("the scoring row", () => {
  it("goes first, bold-sized, and the facts fit under it or leave", () => {
    const layout = layoutFacts(["Committed to Fresno State"], ONE_LINE, "hero", SCORING);
    expect(layout.scoring).toBe("11 G · 6 A · 28 PTS");
    expect(layout.showFacts).toBe(true);
    expect(drawnHeight(["Committed to Fresno State"], layout)).toBeLessThanOrEqual(ONE_LINE + 1e-9);
    const crowded = layoutFacts(WIDEST, TWO_LINES, "hero", SCORING);
    expect(crowded.scoring).toBe("11 G · 6 A · 28 PTS");
    expect(crowded.showFacts).toBe(false);
  });

  it("fits the name column across", () => {
    const layout = layoutFacts([], ONE_LINE, "hero", SCORING);
    expect(textWidthEm(layout.scoring) * layout.scoringSize).toBeLessThanOrEqual(TEXT_COLUMN_EM);
  });
});
