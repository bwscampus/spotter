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
// Facts too many to read at MIN_READABLE_FACT_SIZE_EM show from the first, as
// many as read, with a "+2 more" line under them (Jed, Nov 15).
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
 * The smallest a fact is drawn: still read in a glance on the stage (Jed, Nov
 * 15: a minimum readable size rather than every fact made tiny). Facts that
 * would need smaller show from the first, as many as fit at this size or
 * bigger, and a "+2 more" line says how many are left off. A half-size card's
 * text is bigger relative to it, as everything on it is.
 */
export const MIN_READABLE_FACT_SIZE_EM: Record<CardSize, number> = { hero: 0.36, small: 0.5 };

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
  /** The facts' size (and the "+2 more" line's), in em of the card. */
  size: number;
  /** 1 or 2. */
  columns: number;
  /** How many of the shown facts, from the first, go in the left column; the rest go right. */
  split: number;
  /** How many facts are drawn, from the first. Fewer than the player has when the rest would not read. */
  shown: number;
  /** The line under them for the facts left off, "+2 more", or "" when every fact is shown. */
  more: string;
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

/**
 * The biggest size at which the facts fit in `columns` columns, and the split
 * that does it, or null. `room` is the height they have at a size: less, when
 * a "+2 more" line at that size goes under them.
 */
function fitColumns(facts: readonly string[], room: (size: number) => number, columns: 1 | 2, maxSize: number, minSize: number): Fit | null {
  const ruled = facts.length > 1;
  for (let size = maxSize; size >= minSize - 1e-9; size = Math.round((size - SIZE_STEP_EM) * 1000) / 1000) {
    if (columns === 1) {
      if (columnHeight(facts, TEXT_COLUMN_EM / size, ruled) * size <= room(size)) return { size, split: facts.length };
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
    if (best !== null && bestHeight * size <= room(size)) return { size, split: best };
  }
  return null;
}

/** One column or two, whichever lets these facts be bigger (two only when clearly so), or null when neither fits. */
function fitFacts(facts: readonly string[], room: (size: number) => number, maxSize: number, minSize: number): (Fit & { columns: number }) | null {
  const one = fitColumns(facts, room, 1, maxSize, minSize);
  const two = facts.length > 1 ? fitColumns(facts, room, 2, maxSize, minSize) : null;
  if (two !== null && (one === null || two.size >= one.size * TWO_COLUMN_GAIN)) return { ...two, columns: 2 };
  return one ? { ...one, columns: 1 } : null;
}

/** "+2 more" under some facts, "+3 facts" in place of all of them. */
function moreText(left: number, shown: number): string {
  if (left === 0) return "";
  return shown > 0 ? `+${left} more` : `+${left} ${left === 1 ? "fact" : "facts"}`;
}

/**
 * The facts placed in a box `height` em of the card tall and the name column
 * wide, none cut off. Every fact when they all read at
 * MIN_READABLE_FACT_SIZE_EM or bigger; else as many as do, from the first,
 * and a "+2 more" line under them. With a scoring row, the row first (as big
 * as fits, up to MAX_SCORING_SIZE_EM) and the facts under it as far as they
 * read at MIN_FACT_SIZE_UNDER_SCORING_EM, and none when not one does. The
 * row itself is never taller than the box or wider than the column.
 */
export function layoutFacts(facts: readonly string[], height: number, size: CardSize, scoring: StatLine = []): FactLayout {
  const scoringText = scoring.length > 0 ? lineText(scoring) : "";
  const scoringSize = scoringText
    ? Math.floor(Math.min(MAX_SCORING_SIZE_EM[size], TEXT_COLUMN_EM / textWidthEm(scoringText), height / SCORING_LINE_HEIGHT) * 1000) / 1000
    : 0;
  const room = scoringText ? height - scoringSize * SCORING_LINE_HEIGHT - SCORING_GAP_EM : height;
  const maxSize = MAX_FACT_SIZE_EM[size];
  const minSize = scoringText ? MIN_FACT_SIZE_UNDER_SCORING_EM[size] : MIN_READABLE_FACT_SIZE_EM[size];
  const done = (layout: Omit<FactLayout, "height">): FactLayout => ({ ...layout, height: drawnHeight(facts, layout) });
  const none = done({ size: maxSize, columns: 1, split: 0, shown: 0, more: "", scoring: scoringText, scoringSize });
  if (facts.length === 0) return none;

  for (let shown = facts.length; shown >= 1; shown--) {
    const left = facts.length - shown;
    // The "+2 more" line takes one line at the facts' size, and the gap above it.
    const fit = fitFacts(facts.slice(0, shown), (at) => room - (left > 0 ? SCORING_GAP_EM + FACT_LINE_HEIGHT * at : 0), maxSize, minSize);
    if (fit) return done({ size: fit.size, columns: fit.columns, split: fit.split, shown, more: moreText(left, shown), scoring: scoringText, scoringSize });
  }
  // Not one fact reads here. The scoring view leaves the facts off; the facts
  // view says how many there are, as big as the line fits.
  if (scoringText) return none;
  const lineSize = Math.floor(Math.min(maxSize, room / FACT_LINE_HEIGHT) * 1000) / 1000;
  return done({ size: Math.max(lineSize, 0), columns: 1, split: 0, shown: 0, more: moreText(facts.length, 0), scoring: "", scoringSize: 0 });
}

/** How tall a layout draws, in em of the card, by the arithmetic the card's markup uses: its parts with the box's gap between each two. */
export function drawnHeight(facts: readonly string[], layout: Omit<FactLayout, "height">): number {
  const parts: number[] = [];
  if (layout.scoring) parts.push(layout.scoringSize * SCORING_LINE_HEIGHT);
  if (layout.shown > 0) {
    const list = facts.slice(0, layout.shown);
    const ruled = list.length > 1;
    const width = (layout.columns === 2 ? (TEXT_COLUMN_EM - FACT_COLUMN_GAP_EM) / 2 : TEXT_COLUMN_EM) / layout.size;
    parts.push(Math.max(columnHeight(list.slice(0, layout.split), width, ruled), columnHeight(list.slice(layout.split), width, ruled)) * layout.size);
  }
  if (layout.more) parts.push(FACT_LINE_HEIGHT * layout.size);
  return parts.reduce((total, part) => total + part, 0) + SCORING_GAP_EM * Math.max(0, parts.length - 1);
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
