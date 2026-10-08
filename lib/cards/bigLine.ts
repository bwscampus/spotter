import type { CardFace } from "./cardFace";

// =============================================================================
// Fitting the big line into the card's text column without ever resizing the
// card. docs/CARD_SPEC.md.
//
// Too wide at the full size, it breaks once, at a hyphen (the hyphen stays on
// the first line) or a space. Still too wide, it steps down a size, and then
// once more. Never smaller, never an ellipsis.
//
// Pure: the widths come from a measure function, so the rule is tested with
// made-up widths and the live screen passes canvas measureText against the
// loaded font (components/measureBigLine.ts). Worked out once per player, off
// the hot path, and read by writeCard from a map.
// =============================================================================

// =============================================================================
// TUNING: the card's geometry, in em of the card's own size. The hero's size
// is the stage's base size; the two older cards are the same card at
// SMALL_SCALE, side by side under it (Jed, Oct 4: "much more horizontal", and
// the 2nd and 3rd cards showing more).
// =============================================================================

/** The hero card: a wide strip, five times as wide as it is tall. */
export const HERO_WIDTH_EM = 32;
export const HERO_HEIGHT_EM = 6.4;

/** Left to right: the number slab, the name, and the stats column. */
export const SLAB_WIDTH_EM = 5.8;
export const STATS_WIDTH_EM = 11.5;
export const NAME_PADDING_EM = 0.6;

/** The name's column: what the slab and the stats leave, less its padding. */
export const TEXT_COLUMN_EM = HERO_WIDTH_EM - SLAB_WIDTH_EM - STATS_WIDTH_EM - 2 * NAME_PADDING_EM;

/** The big line's sizes, largest first. */
export const BIG_LINE_SIZES = [1.8, 1.55, 1.3] as const;

/** Between the hero and the row of older cards, between those two, and round the edge of the stage. */
export const STAGE_GAP_EM = 0.5;
export const SMALL_GAP_EM = 0.25;
export const STAGE_MARGIN_EM = 0.5;

/** The older cards: two of them, with their gap, exactly as wide as the hero. */
export const SMALL_SCALE = (HERO_WIDTH_EM - SMALL_GAP_EM) / 2 / HERO_WIDTH_EM;

/** The base size is the largest that fits this many em across and down the stage. */
export const STAGE_WIDTH_EM = HERO_WIDTH_EM + 2 * STAGE_MARGIN_EM;
/**
 * Room on the live stage for the cards to sit against their team's side (away
 * left, home right) rather than in the middle (Jed, Oct 5): the live base
 * size fits the cards' width plus this, so there is somewhere to move to.
 */
export const STAGE_ANCHOR_ROOM_EM = 3;

export const STAGE_HEIGHT_EM = HERO_HEIGHT_EM * (1 + SMALL_SCALE) + STAGE_GAP_EM + 2 * STAGE_MARGIN_EM;

/** Letter spacing across the big line, and on its stressed syllable. */
export const BIG_LINE_SPACING_EM = 0.01;
export const STRESSED_SPACING_EM = 0.03;

// =============================================================================

/** The stage's base font size in px for a stage this big. Never depends on what a card says. */
export function baseFontPx(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / (STAGE_WIDTH_EM + STAGE_ANCHOR_ROOM_EM), height / STAGE_HEIGHT_EM)));
}

/** A text's width at a font size of 1, in em: its weight and its own letter spacing included. */
export type Measure = (text: string, weight: number, spacingEm: number) => number;

/** The big line as the card writes it. A "\n" in any part is the one break. */
export interface BigLineFit {
  plain: string;
  before: string;
  stressed: string;
  after: string;
  /** In em of the base size: one of BIG_LINE_SIZES. */
  size: number;
}

type Parts = Pick<CardFace, "plain" | "before" | "stressed" | "after">;
type PartName = keyof Parts;

interface Segment {
  part: PartName;
  text: string;
  weight: number;
  spacing: number;
}

/** The face's big line as written, at full size, unbroken: what a card shows before anything is measured. */
export function unfitted(face: Parts): BigLineFit {
  return { plain: face.plain, before: face.before, stressed: face.stressed, after: face.after, size: BIG_LINE_SIZES[0] };
}

export function fitBigLine(face: Parts, measure: Measure, column = TEXT_COLUMN_EM): BigLineFit {
  const segments: Segment[] = face.plain
    ? [{ part: "plain", text: face.plain, weight: 700, spacing: BIG_LINE_SPACING_EM }]
    : [
        { part: "before", text: face.before, weight: 500, spacing: BIG_LINE_SPACING_EM },
        { part: "stressed", text: face.stressed, weight: 800, spacing: STRESSED_SPACING_EM },
        { part: "after", text: face.after, weight: 500, spacing: BIG_LINE_SPACING_EM },
      ];
  const full = segments.map((segment) => segment.text).join("");
  const widthOf = (from: number, to: number) => {
    let width = 0;
    let offset = 0;
    for (const segment of segments) {
      const start = Math.max(from, offset);
      const end = Math.min(to, offset + segment.text.length);
      if (end > start) width += measure(segment.text.slice(start - offset, end - offset), segment.weight, segment.spacing);
      offset += segment.text.length;
    }
    return width;
  };

  const whole = widthOf(0, full.length);
  // Every place it may break: after a hyphen, which stays on the first line,
  // or at a space, which goes. Hyphens first, because that is where a
  // double-barrelled name already breaks.
  const breaks: Array<{ at: number; drop: boolean; first: number; second: number }> = [];
  for (const hyphen of [true, false]) {
    for (let index = 0; index < full.length; index++) {
      const char = full[index];
      if (hyphen ? char !== "-" : char !== " ") continue;
      const firstEnd = hyphen ? index + 1 : index;
      const secondStart = index + 1;
      if (firstEnd === 0 || secondStart >= full.length) continue;
      breaks.push({ at: index, drop: !hyphen, first: widthOf(0, firstEnd), second: widthOf(secondStart, full.length) });
    }
  }
  const hyphenCount = breaks.filter((b) => !b.drop).length;
  const balanced = (list: typeof breaks) =>
    list.reduce<(typeof breaks)[number] | null>(
      (best, b) => (best === null || Math.max(b.first, b.second) < Math.max(best.first, best.second) ? b : best),
      null,
    );

  for (const size of BIG_LINE_SIZES) {
    if (whole * size <= column) return { ...unfitted(face), size };
    const fitting = (list: typeof breaks) => list.filter((b) => Math.max(b.first, b.second) * size <= column);
    const chosen = balanced(fitting(breaks.slice(0, hyphenCount))) ?? balanced(fitting(breaks.slice(hyphenCount)));
    if (chosen) return withBreak(face, segments, chosen, size);
  }
  // Too long at the smallest size even broken: the smallest size, broken where
  // it is narrowest. It runs past the column rather than shrink further.
  const smallest = BIG_LINE_SIZES[BIG_LINE_SIZES.length - 1];
  const last = balanced(breaks);
  return last ? withBreak(face, segments, last, smallest) : { ...unfitted(face), size: smallest };
}

/** The parts with the break in: a "\n" after the hyphen, or in place of the space. */
function withBreak(face: Parts, segments: Segment[], at: { at: number; drop: boolean }, size: number): BigLineFit {
  const fit = { ...unfitted(face), size };
  let offset = 0;
  for (const segment of segments) {
    const local = at.at - offset;
    if (local >= 0 && local < segment.text.length) {
      const text = segment.text;
      fit[segment.part] = at.drop ? `${text.slice(0, local)}\n${text.slice(local + 1)}` : `${text.slice(0, local + 1)}\n${text.slice(local + 1)}`;
      break;
    }
    offset += segment.text.length;
  }
  return fit;
}
