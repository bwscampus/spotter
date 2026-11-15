import { BIG_LINE_SIZES, HERO_HEIGHT_EM, TEXT_COLUMN_EM, type BigLineFit } from "./bigLine";
import type { CardFace } from "./cardFace";
import { lineText, type StatLine } from "./lines";
import { textWidthEm, type CardSize } from "./statLayout";

// =============================================================================
// Where a player's facts go on the card (Nov 15). Jed: "Card should show as
// many as added. Can also do two columns if needed." So every fact is drawn
// whole, under the name, and none is ever cut off: the text size steps down
// until they all fit the box the name leaves, and a second column is used
// only when it lets the text be clearly bigger than one column would.
//
// The scoring view (lib/cards/scoringKeywords.ts) puts the player's scoring
// numbers first, bold, on one row at the top of the same box; the facts fill
// what is left under it if they can still be read there, and leave the card
// for that view otherwise.
//
// Pure, like lib/cards/statLayout.ts: widths come from the stage font's
// advance widths (textWidthEm), held with a margin, so nothing reads layout.
// Every size is in em of the card, which never changes size.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** The biggest a fact is drawn: the Oct 7 storyline's size. A half-size card's text is bigger relative to it. */
export const MAX_FACT_SIZE_EM: Record<CardSize, number> = { hero: 0.68, small: 0.82 };

/**
 * The smallest the size search goes: far under reading size, so the search
 * always finds one where every fact fits. Only five facts of the widest
 * letters under a name broken onto two lines get near it; nothing is ever cut
 * off instead (Jed: "Card should show as many as added").
 */
export const MIN_FACT_SIZE_EM = 0.04;

/** The size search's step. */
const SIZE_STEP_EM = 0.01;

/** A fact's line, in em of the fact size, as the card draws it. */
export const FACT_LINE_HEIGHT = 1.15;

/** Between two facts in a column, in em of the fact size. */
export const FACT_GAP = 0.3;

/** With more than one fact, each has a thin rule at its left and this much room from it, in em of the fact size. */
export const FACT_RULE_EM = 0.1;
export const FACT_INDENT_EM = 0.4;

/** Between the two columns, in em of the card. */
export const FACT_COLUMN_GAP_EM = 0.5;

/** Two columns only when their text is at least this much bigger than one column's. */
export const TWO_COLUMN_GAIN = 1.1;

/** The scoring row's biggest size, bold: about the small name line's. */
export const MAX_SCORING_SIZE_EM: Record<CardSize, number> = { hero: 0.9, small: 1 };

/** The scoring row's line, and its gap above the facts, in em of the card. */
export const SCORING_LINE_HEIGHT = 1.15;
export const SCORING_GAP_EM = 0.15;

/** Under the scoring row, facts stay on the card only at this size or bigger; smaller, the scoring view drops them. */
export const MIN_FACT_SIZE_UNDER_SCORING_EM: Record<CardSize, number> = { hero: 0.42, small: 0.5 };

/** The name column's parts above the facts, in em of the card (components/PlayerCard.tsx). */
export const BIG_LINE_HEIGHT = 1.05;
export const SMALL_LINE_EM = 1.2;
export const NAME_GAP_EM = 0.2;

/** Kept clear above and below the name column's contents. */
export const NAME_COLUMN_MARGIN_EM = 0.15;

// =============================================================================

/** What a card leads with: its facts (the default), or the scoring row (a scoring word was said, or S). */
export type CardView = "facts" | "scoring";

/** The facts as the card writes them: the size, which facts go in the left column, and the scoring row. */
export interface FactLayout {
  /** The facts' size, in em of the card. */
  size: number;
  /** 1 or 2. */
  columns: number;
  /** How many facts, from the first, go in the left column; the rest go right. */
  split: number;
  /** Whether the facts are drawn at all (the scoring view may drop them). */
  showFacts: boolean;
  /** The scoring row's text, or "" for none. */
  scoring: string;
  scoringSize: number;
  /** How tall it all is, in em of the card: what the card keeps for it, in both views, so a swap moves nothing. */
  height: number;
}

/** How many lines `text` wraps to in a column `width` wide, at a size of 1. */
export function wrappedLines(text: string, width: number): number {
  if (width <= 0) return Number.POSITIVE_INFINITY;
  const space = textWidthEm(" ");
  let lines = 1;
  let used = 0;
  for (const word of text.split(" ").filter((each) => each.length > 0)) {
    const wide = textWidthEm(word);
    if (wide > width) {
      // A word wider than the column breaks anywhere (overflow-wrap: anywhere).
      if (used > 0) lines += 1;
      lines += Math.ceil(wide / width) - 1;
      used = wide - (Math.ceil(wide / width) - 1) * width;
      continue;
    }
    const next = used === 0 ? wide : used + space + wide;
    if (next <= width) used = next;
    else {
      lines += 1;
      used = wide;
    }
  }
  return lines;
}

/** A column's height, in em of the fact size, for these facts at `width` em of the fact size. */
function columnHeight(facts: readonly string[], width: number, ruled: boolean): number {
  if (facts.length === 0) return 0;
  const inner = ruled ? width - FACT_RULE_EM - FACT_INDENT_EM : width;
  const lines = facts.reduce((total, fact) => total + wrappedLines(fact, inner), 0);
  return lines * FACT_LINE_HEIGHT + (facts.length - 1) * FACT_GAP;
}

interface Fit {
  size: number;
  split: number;
}

/** The biggest size at which the facts fit `height` in `columns` columns, and the split that does it, or null. */
function fitColumns(facts: readonly string[], height: number, columns: 1 | 2, maxSize: number, minSize: number): Fit | null {
  const ruled = facts.length > 1;
  for (let size = maxSize; size >= minSize - 1e-9; size = Math.round((size - SIZE_STEP_EM) * 1000) / 1000) {
    if (columns === 1) {
      if (columnHeight(facts, TEXT_COLUMN_EM / size, ruled) * size <= height) return { size, split: facts.length };
      continue;
    }
    const width = (TEXT_COLUMN_EM - FACT_COLUMN_GAP_EM) / 2 / size;
    let best: number | null = null;
    let bestHeight = Number.POSITIVE_INFINITY;
    for (let split = 1; split < facts.length; split++) {
      const tallest = Math.max(columnHeight(facts.slice(0, split), width, ruled), columnHeight(facts.slice(split), width, ruled));
      if (tallest < bestHeight) {
        bestHeight = tallest;
        best = split;
      }
    }
    if (best !== null && bestHeight * size <= height) return { size, split: best };
  }
  return null;
}

/**
 * Every fact placed, none cut off, in a box `height` em of the card tall and
 * the name column wide. With a scoring row, the row first (as big as fits,
 * up to MAX_SCORING_SIZE_EM) and the facts under it, or no facts when they
 * would be smaller than MIN_FACT_SIZE_UNDER_SCORING_EM there.
 */
export function layoutFacts(facts: readonly string[], height: number, size: CardSize, scoring: StatLine = []): FactLayout {
  const scoringText = scoring.length > 0 ? lineText(scoring) : "";
  const scoringSize = scoringText
    ? Math.floor(Math.min(MAX_SCORING_SIZE_EM[size], TEXT_COLUMN_EM / textWidthEm(scoringText)) * 1000) / 1000
    : 0;
  const room = scoringText ? height - scoringSize * SCORING_LINE_HEIGHT - SCORING_GAP_EM : height;
  const done = (layout: Omit<FactLayout, "height">): FactLayout => ({ ...layout, height: drawnHeight(facts, layout) });
  const none = done({ size: MAX_FACT_SIZE_EM[size], columns: 1, split: facts.length, showFacts: false, scoring: scoringText, scoringSize });
  if (facts.length === 0) return none;

  const minSize = scoringText ? MIN_FACT_SIZE_UNDER_SCORING_EM[size] : MIN_FACT_SIZE_EM;
  const one = fitColumns(facts, room, 1, MAX_FACT_SIZE_EM[size], minSize);
  const two = facts.length > 1 ? fitColumns(facts, room, 2, MAX_FACT_SIZE_EM[size], minSize) : null;
  const useTwo = two !== null && (one === null || two.size >= one.size * TWO_COLUMN_GAIN);
  const chosen = useTwo ? two : one;
  if (!chosen) {
    if (scoringText) return none;
    // Past the smallest size even in two columns: drawn at it, the most room it can have.
    return done({ size: MIN_FACT_SIZE_EM, columns: facts.length > 1 ? 2 : 1, split: Math.ceil(facts.length / 2), showFacts: true, scoring: "", scoringSize: 0 });
  }
  return done({ size: chosen.size, columns: useTwo ? 2 : 1, split: chosen.split, showFacts: true, scoring: scoringText, scoringSize });
}

/** How tall a layout draws, in em of the card, by the arithmetic the card's markup uses. */
export function drawnHeight(facts: readonly string[], layout: Omit<FactLayout, "height">): number {
  const scoring = layout.scoring ? layout.scoringSize * SCORING_LINE_HEIGHT : 0;
  if (!layout.showFacts || facts.length === 0) return scoring;
  const ruled = facts.length > 1;
  const width = (layout.columns === 2 ? (TEXT_COLUMN_EM - FACT_COLUMN_GAP_EM) / 2 : TEXT_COLUMN_EM) / layout.size;
  const shown = Math.max(columnHeight(facts.slice(0, layout.split), width, ruled), columnHeight(facts.slice(layout.split), width, ruled)) * layout.size;
  return scoring + (scoring > 0 ? SCORING_GAP_EM : 0) + shown;
}

/**
 * The facts' box: the card's height less the big line, the small name line,
 * their gaps and a margin. The big line's height comes from its fit when it
 * has been measured, else from its unbroken width at full size, which is
 * what the card draws before the fit arrives.
 */
export function factBoxHeight(face: Pick<CardFace, "plain" | "before" | "stressed" | "after"> | undefined, fit: BigLineFit | undefined): number {
  const bigSize = fit?.size ?? BIG_LINE_SIZES[0];
  const text = fit ? `${fit.plain}${fit.before}${fit.stressed}${fit.after}` : face ? `${face.plain}${face.before}${face.stressed}${face.after}` : "";
  const lines = fit ? (text.includes("\n") ? 2 : 1) : textWidthEm(text) * bigSize > TEXT_COLUMN_EM ? 2 : 1;
  const big = lines * bigSize * BIG_LINE_HEIGHT;
  return Math.max(0, HERO_HEIGHT_EM - 2 * NAME_COLUMN_MARGIN_EM - big - SMALL_LINE_EM - 2 * NAME_GAP_EM);
}
