import { HERO_HEIGHT_EM, STATS_WIDTH_EM } from "./bigLine";
import { ESTIMATE_MARK, type StatItem, type StatLine } from "./lines";

// =============================================================================
// Where every stat goes in a card's stats column, so that none is ever cut off
// (Jed, Oct 8: "No stats should get cut off! ... make multiple rows of season
// stats (and tonight if needed) ... Rows should be organized!").
//
// A section (SEASON, or TONIGHT on a stats game) is a fixed box. Its items are
// laid out in columns of rows: each group (passing, rushing, defense, ...)
// starts its own column, in the order the line gives them (the biggest group
// first), and runs down it in the order its items are said; a group longer
// than the rows continues in the next column. The row count and the text size
// are chosen together: every row count is tried, and the one that lets the
// text be biggest while every column fits the box's width and every row its
// height wins, never past the card's usual stat size. So a running back's
// three items sit large in one column, and a two-way player's sixteen sit
// smaller in five, all of them whole.
//
// Pure: widths come from the stage font's own advance widths, measured once
// in Chrome (Atkinson Hyperlegible Next at weights 500 and 700, the larger of
// the two, tabular figures) and held here with a margin, so the card path
// never reads layout. Checked in headless Chrome on Oct 8: no row of any test
// player overflows its column or its section.
// =============================================================================

// =============================================================================
// TUNING: the stats column's geometry, in em of the card.
// =============================================================================

/** Inside the stats column, either side and above and below each section. */
export const STATS_PAD_X_EM = 0.5;
export const STATS_PAD_Y_EM = 0.12;

/** "SEASON", "TONIGHT": drawn bigger on a half-size card, so never under 0.4em of the stage. */
export const SECTION_LABEL_EM = { hero: 0.5, small: 0.82 } as const;
export const SECTION_LABEL_LINE_HEIGHT = 1.2;
export const SECTION_LABEL_GAP_EM = 0.1;

/** On a stats game, how much of the card's height TONIGHT takes; SEASON has the rest. */
export const TONIGHT_SHARE = 0.42;

/** The biggest a stat is drawn, as before Oct 8; a card with more to say draws them smaller. */
export const MAX_STAT_SIZE_EM = { hero: 0.85, small: 0.9 } as const;

/** One row, in em of the stat size. */
export const STAT_ROW_LINE_HEIGHT = 1.1;

/** Between two columns, in em of the stat size. */
export const STAT_COLUMN_GAP = 0.5;

/** A label beside a value ("yds", "long") is drawn at this much of the value's size. */
export const STAT_LABEL_SCALE = 0.85;

/**
 * A layout with more rows wins while its text is at least this share of the
 * biggest any layout allows, so a group stays in one column rather than
 * splitting for a sliver of size.
 */
export const KEEP_ROWS_SHARE = 0.9;

/** A written phrase longer than this is broken at its spaces into rows of at most this many characters. */
export const WRITTEN_ROW_CHARS = 16;

/** Item slots each section renders: more than the longest football line (27 items) or three written lines can make. */
export const MAX_STAT_SLOTS = 40;

/** Widths are taken as this much wider than measured, so rounding never pushes a row past its column. */
const WIDTH_MARGIN = 1.06;

/** Advance widths of the stage font at a size of 1, the wider of weights 500 and 700. */
const CHAR_EM: Readonly<Record<string, number>> = {
  "0": 0.63, "1": 0.63, "2": 0.63, "3": 0.63, "4": 0.63, "5": 0.63, "6": 0.63, "7": 0.63, "8": 0.63, "9": 0.63,
  ",": 0.27, ".": 0.27, "-": 0.37, "~": 0.55, " ": 0.31, "/": 0.32, "(": 0.33, ")": 0.33, "'": 0.21, "&": 0.73,
  ":": 0.27, "%": 0.97, "#": 0.76, "+": 0.6,
  a: 0.55, b: 0.6, c: 0.5, d: 0.6, e: 0.56, f: 0.38, g: 0.59, h: 0.57, i: 0.3, j: 0.29, k: 0.56, l: 0.31, m: 0.88,
  n: 0.57, o: 0.58, p: 0.6, q: 0.6, r: 0.38, s: 0.51, t: 0.38, u: 0.57, v: 0.55, w: 0.76, x: 0.56, y: 0.54, z: 0.51,
  A: 0.7, B: 0.64, C: 0.64, D: 0.69, E: 0.6, F: 0.57, G: 0.72, H: 0.7, I: 0.42, J: 0.56, K: 0.66, L: 0.55, M: 0.86,
  N: 0.72, O: 0.75, P: 0.63, Q: 0.76, R: 0.65, S: 0.61, T: 0.62, U: 0.69, V: 0.66, W: 0.89, X: 0.68, Y: 0.68, Z: 0.62,
};

/** Anything not in the table, taken as wide as the widest letter. */
const UNKNOWN_CHAR_EM = 0.97;

// =============================================================================

export type CardSize = "hero" | "small";
export type StatSection = "season" | "tonight";

/** A section's height on the card, label and padding included. Zero for TONIGHT on a game without live stats. */
export function sectionHeightEm(section: StatSection, withTonight: boolean): number {
  if (!withTonight) return section === "season" ? HERO_HEIGHT_EM : 0;
  const share = section === "tonight" ? TONIGHT_SHARE : 1 - TONIGHT_SHARE;
  // To a thousandth, so the markup says 3.712em, not 3.7119999999999997em.
  return Math.round(HERO_HEIGHT_EM * share * 1000) / 1000;
}

/** The box a section's rows have: the section less its padding and its label. */
export function statBox(size: CardSize, section: StatSection, withTonight: boolean): { width: number; height: number } {
  const label = SECTION_LABEL_EM[size] * SECTION_LABEL_LINE_HEIGHT + SECTION_LABEL_GAP_EM;
  return {
    width: STATS_WIDTH_EM - 2 * STATS_PAD_X_EM,
    height: Math.max(0, sectionHeightEm(section, withTonight) - 2 * STATS_PAD_Y_EM - label),
  };
}

/** A text's width at a size of 1, margin included. */
export function textWidthEm(text: string): number {
  let width = 0;
  for (const char of text) width += CHAR_EM[char] ?? UNKNOWN_CHAR_EM;
  return width * WIDTH_MARGIN;
}

/** One item as the card draws it: the label said first, the value, the label said after, labels smaller. */
export function itemWidthEm(item: StatItem): number {
  const value = `${item.estimated ? ESTIMATE_MARK : ""}${item.value}`;
  const lead = item.labelFirst && item.label ? `${item.label} ` : "";
  const label = !item.labelFirst && item.label ? ` ${item.label}` : "";
  return textWidthEm(value) + STAT_LABEL_SCALE * (textWidthEm(lead) + textWidthEm(label));
}

/** Where one item sits, 0-based. */
export interface StatCell {
  item: StatItem;
  column: number;
  row: number;
}

/** A section's layout: the stat size in em of the card, the grid, and every item's place. */
export interface StatLayout {
  size: number;
  rows: number;
  columns: number;
  cells: StatCell[];
}

/** Items by group, in the order the line gives the groups, each in the order its items are said. */
function groupsOf(items: StatLine): StatItem[][] {
  const order: number[] = [];
  const byGroup = new Map<number, StatItem[]>();
  for (const item of items) {
    const group = item.group ?? 0;
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      order.push(group);
    }
    byGroup.get(group)!.push(item);
  }
  return order.map((group) => byGroup.get(group)!);
}

/**
 * Every item placed, none cut off: each group from the top of a new column,
 * never bigger than `maxSize`. Of the row counts, the most rows whose text is
 * within KEEP_ROWS_SHARE of the biggest possible, which keeps each group in
 * one column wherever that costs little.
 */
export function layoutStats(items: StatLine, box: { width: number; height: number }, maxSize: number): StatLayout {
  const shown = items.slice(0, MAX_STAT_SLOTS);
  const groups = groupsOf(shown);
  if (shown.length === 0 || box.width <= 0 || box.height <= 0) return { size: maxSize, rows: 0, columns: 0, cells: [] };
  const widths = new Map(shown.map((item) => [item, itemWidthEm(item)]));
  const longest = Math.max(...groups.map((group) => group.length));

  const candidates: StatLayout[] = [];
  for (let rows = longest; rows >= 1; rows--) {
    const cells: StatCell[] = [];
    const columnWidths: number[] = [];
    for (const group of groups) {
      group.forEach((item, index) => {
        const column = columnWidths.length + Math.floor(index / rows);
        cells.push({ item, column, row: index % rows });
      });
      for (let start = 0; start < group.length; start += rows) {
        columnWidths.push(Math.max(...group.slice(start, start + rows).map((item) => widths.get(item)!)));
      }
    }
    const width = columnWidths.reduce((total, next) => total + next, 0) + STAT_COLUMN_GAP * (columnWidths.length - 1);
    const size = Math.floor(Math.min(maxSize, box.width / width, box.height / (rows * STAT_ROW_LINE_HEIGHT)) * 1000) / 1000;
    candidates.push({ size, rows, columns: columnWidths.length, cells });
  }
  const biggest = Math.max(...candidates.map((candidate) => candidate.size));
  // Most rows first, so the first close enough is the one that splits groups least.
  return candidates.find((candidate) => candidate.size >= biggest * KEEP_ROWS_SHARE)!;
}

/**
 * Another sport's written lines as items (Oct 8): each line its own group,
 * split where it lists things ("12.4 PPG, 8.1 REB · 3 BLK"), and a long phrase
 * broken at its spaces into rows of WRITTEN_ROW_CHARS, so the card lays them
 * out in rows like football's instead of one line cut off at the edge.
 */
export function writtenItems(text: string): StatLine {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line, group) =>
      line
        // A comma lists only with a space after it, so "1,420" stays whole.
        .split(/\s*(?:[·;|]|,(?=\s))\s*/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .flatMap(wrapWords)
        .map((part) => ({ value: part, label: "", estimated: false, group })),
    );
}

/** A phrase as rows of at most WRITTEN_ROW_CHARS, broken at spaces; a single longer word stays whole. */
function wrapWords(phrase: string): string[] {
  const rows: string[] = [];
  for (const word of phrase.split(/\s+/)) {
    const last = rows[rows.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= WRITTEN_ROW_CHARS) rows[rows.length - 1] = `${last} ${word}`;
    else rows.push(word);
  }
  return rows;
}
