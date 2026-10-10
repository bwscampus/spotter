import { describe, expect, it } from "vitest";
import { seasonLine, type StatLine } from "@/lib/cards/lines";
import { FOOTBALL_STAT_KEYS, type FootballStats } from "@/lib/cards/statKeys";
import {
  itemWidthEm,
  KEEP_ROWS_SHARE,
  layoutStats,
  MAX_STAT_SIZE_EM,
  MAX_STAT_SLOTS,
  STAT_COLUMN_GAP,
  STAT_ROW_LINE_HEIGHT,
  statBox,
  textWidthEm,
  WRITTEN_ROW_CHARS,
  writtenItems,
  type CardSize,
} from "@/lib/cards/statLayout";

// =============================================================================
// Every stat on the card, none cut off (Jed, Oct 8). The layout is pure, so
// these hold it to its promise with the same widths the card is drawn with:
// whatever a player has, every item is placed, every column fits the box's
// width and every row its height. The render was also checked in Chrome
// (no row of any test player past its section, at base sizes 16 to 56px).
// =============================================================================

const PLAYERS: Record<string, FootballStats> = {
  back: { rush_att: 64, rush_yds: 420, rush_td: 5 },
  quarterback: { pass_cmp: 88, pass_att: 140, pass_yds: 1420, pass_td: 9, pass_int: 3, rush_att: 45, rush_yds: 210, rush_td: 3 },
  twoWay: {
    rush_att: 120, rush_yds: 1045, rush_td: 14, rec: 22, rec_yds: 220, rec_td: 3, tkl: 45, sacks: 4.5, def_int: 3, pbu: 6,
    ff: 2, fr: 1, int_td: 1, kr: 12, kr_yds: 310, pr: 8, pr_yds: 140, kr_td: 2,
  },
  kicker: { fgm: 7, fga: 9, fg_long: 42, xpm: 30, xpa: 32, punts: 40, punt_yds: 1640 },
  // Every key, big numbers: the longest line football can make.
  everything: Object.fromEntries(FOOTBALL_STAT_KEYS.map((key, index) => [key, 1000 + index * 1111])) as FootballStats,
};

const PLACES: Array<[CardSize, "season" | "tonight", boolean]> = [
  ["hero", "season", false],
  ["hero", "season", true],
  ["hero", "tonight", true],
  ["small", "season", false],
  ["small", "season", true],
  ["small", "tonight", true],
];

/** Each column's width at the layout's size, and its rows' height. */
function measured(items: StatLine, size: CardSize, section: "season" | "tonight", withTonight: boolean) {
  const box = statBox(size, section, withTonight);
  const layout = layoutStats(items, box, MAX_STAT_SIZE_EM[size]);
  const columns = Array.from({ length: layout.columns }, (_, column) =>
    Math.max(...layout.cells.filter((cell) => cell.column === column).map((cell) => itemWidthEm(cell.item))),
  );
  const width = (columns.reduce((total, next) => total + next, 0) + STAT_COLUMN_GAP * (columns.length - 1)) * layout.size;
  const height = layout.rows * STAT_ROW_LINE_HEIGHT * layout.size;
  return { box, layout, width, height };
}

describe("every item fits", () => {
  for (const [name, stats] of Object.entries(PLAYERS)) {
    it(`${name}: every item placed once, inside the box, at every size and on every game`, () => {
      const items = seasonLine(stats);
      expect(items.length).toBeGreaterThan(0);
      for (const [size, section, withTonight] of PLACES) {
        const { box, layout, width, height } = measured(items, size, section, withTonight);
        expect(new Set(layout.cells.map((cell) => cell.item))).toEqual(new Set(items));
        expect(width).toBeLessThanOrEqual(box.width + 1e-9);
        expect(height).toBeLessThanOrEqual(box.height + 1e-9);
        expect(layout.size).toBeLessThanOrEqual(MAX_STAT_SIZE_EM[size]);
        expect(layout.size).toBeGreaterThan(0);
        // No two items in one cell.
        expect(new Set(layout.cells.map((cell) => `${cell.column}:${cell.row}`)).size).toBe(layout.cells.length);
      }
    });
  }

  it("has a slot for every item the longest football line can make", () => {
    expect(seasonLine(PLAYERS.everything).length).toBeLessThanOrEqual(MAX_STAT_SLOTS);
  });

  it("keeps a real player's stats readable: a two-way player on the hero is at least half the usual size", () => {
    const { layout } = measured(seasonLine(PLAYERS.twoWay), "hero", "season", false);
    expect(layout.size).toBeGreaterThanOrEqual(MAX_STAT_SIZE_EM.hero / 2);
  });
});

describe("rows are organized", () => {
  it("starts each group at the top of its own column, the biggest first, and runs down it in spoken order", () => {
    const items = seasonLine(PLAYERS.quarterback);
    const { layout } = measured(items, "hero", "season", false);
    expect(layout.cells.map((cell) => [`${cell.item.value} ${cell.item.label}`.trim(), cell.column, cell.row])).toEqual([
      ["88-140", 0, 0],
      ["1,420 yds", 0, 1],
      ["9 TD", 0, 2],
      ["3 INT", 0, 3],
      ["45 car", 1, 0],
      ["210 yds", 1, 1],
      ["3 TD", 1, 2],
    ]);
  });

  it("keeps a group in one column when splitting it would gain less than the KEEP_ROWS_SHARE margin", () => {
    // Three rows on the hero's season with tonight need the text a hair under the usual size.
    const { layout } = measured(seasonLine(PLAYERS.back), "hero", "season", true);
    expect(layout.columns).toBe(1);
    expect(layout.size).toBeGreaterThanOrEqual(MAX_STAT_SIZE_EM.hero * KEEP_ROWS_SHARE);
  });

  it("continues a group too long for the rows in the next column, in order", () => {
    const { layout } = measured(seasonLine(PLAYERS.twoWay), "small", "tonight", true);
    for (let index = 1; index < layout.cells.length; index++) {
      const before = layout.cells[index - 1];
      const cell = layout.cells[index];
      // Never back up: each item is below the one before or in a column to its right.
      expect(cell.column > before.column || (cell.column === before.column && cell.row === before.row + 1)).toBe(true);
    }
  });

  it("is empty for an empty line", () => {
    expect(layoutStats([], statBox("hero", "season", false), 0.85)).toEqual({ size: 0.85, rows: 0, columns: 0, cells: [] });
  });
});

describe("widths", () => {
  it("are the stage font's: tabular figures all one width, a margin on top", () => {
    expect(textWidthEm("1111")).toBeCloseTo(textWidthEm("8888"), 9);
    expect(textWidthEm("0")).toBeGreaterThan(0.63);
  });

  it("count the ~ and draw labels smaller than values", () => {
    const plain = itemWidthEm({ value: "420", label: "yds", estimated: false });
    const marked = itemWidthEm({ value: "420", label: "yds", estimated: true });
    expect(marked).toBeGreaterThan(plain);
    expect(plain).toBeLessThan(textWidthEm("420 yds"));
  });

  it("take anything unknown as wide as the widest letter", () => {
    expect(textWidthEm("é")).toBeGreaterThanOrEqual(textWidthEm("W"));
  });
});

describe("another sport's written lines", () => {
  it("are a group a line, split where they list things, a thousands comma kept", () => {
    expect(writtenItems("12.4 PPG, 8.1 REB · 3 BLK\n1,204 career points").map((item) => [item.value, item.group])).toEqual([
      ["12.4 PPG", 0],
      ["8.1 REB", 0],
      ["3 BLK", 0],
      ["1,204 career", 1],
      ["points", 1],
    ]);
  });

  it(`break a long phrase at its spaces into rows of at most ${WRITTEN_ROW_CHARS} characters`, () => {
    const rows = writtenItems("MVP of the Mission League tournament last November").map((item) => item.value);
    expect(rows).toEqual(["MVP of the", "Mission League", "tournament last", "November"]);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(WRITTEN_ROW_CHARS);
  });

  it("drop blank lines and parts", () => {
    expect(writtenItems("\n , ·\n")).toEqual([]);
  });
});
