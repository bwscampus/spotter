import { describe, expect, it } from "vitest";
import { itemText, lineText, MAX_GROUP_ITEMS, MAX_GROUPS, MAX_ITEMS, MAX_ROW_CHARS, seasonLine, type StatLine } from "@/lib/cards/lines";
import type { FootballStats } from "@/lib/cards/statKeys";

// The season line is what an announcer reads off the card mid-play, so each
// position group is pinned exactly (docs/CARD_SPEC.md): the two biggest
// groups (Jed, Oct 7: show as much as fits), one per stat column on the card,
// each in spoken order with up to MAX_GROUP_ITEMS items, each ranked within
// its group so a card with fewer rows keeps the highest priority ones.

const line = (stats: FootballStats | null) => lineText(seasonLine(stats));

/** What a column with this many rows shows of a group: the items ranked under it, in spoken order. */
const rows = (items: StatLine, count: number, group = 0) =>
  lineText(items.filter((item, index) => (item.group ?? 0) === group && (item.rank ?? index) < count));
const groupText = (items: StatLine, group: number) => lineText(items.filter((item) => (item.group ?? 0) === group));

describe("the season line, one position group at a time", () => {
  it("a running back: car, yds, TD said in that order; yds, then TD, then car by priority", () => {
    const items = seasonLine({ rush_att: 64, rush_yds: 420, rush_td: 5 });
    expect(lineText(items)).toBe("64 car · 420 yds · 5 TD");
    expect(rows(items, 2)).toBe("420 yds · 5 TD");
    expect(rows(items, 1)).toBe("420 yds");
    expect(line({ rush_att: 64, rush_yds: 420 })).toBe("64 car · 420 yds");
  });

  it("a receiver: rec, then yds, then TD", () => {
    const items = seasonLine({ rec: 22, rec_yds: 310, rec_td: 3 });
    expect(lineText(items)).toBe("22 rec · 310 yds · 3 TD");
    expect(rows(items, 2)).toBe("22 rec · 310 yds");
  });

  it("a quarterback: completions-attempts, then TD, then yds, with a comma in the thousands", () => {
    const items = seasonLine({ pass_cmp: 88, pass_att: 140, pass_yds: 1240, pass_td: 9, pass_int: 4 });
    expect(lineText(items)).toBe("88-140 · 1,240 yds · 9 TD · 4 INT");
    expect(rows(items, 3)).toBe("88-140 · 1,240 yds · 9 TD");
    expect(rows(items, 2)).toBe("88-140 · 9 TD");
    expect(line({ pass_cmp: 8, pass_att: 11, pass_yds: 1240 })).toBe("8-11 · 1,240 yds");
  });

  it("a defender: tkl, then sk, then INT, then PBU", () => {
    expect(line({ tkl: 41, sacks: 3, sack_yds: 22, def_int: 2, pbu: 5 })).toBe("41 tkl · 3 sk · 2 INT · 5 PBU");
    expect(rows(seasonLine({ tkl: 41, sacks: 3, def_int: 2, pbu: 5 }), 2)).toBe("41 tkl · 3 sk");
    expect(line({ tkl: 10, sacks: 4.5 })).toBe("10 tkl · 4.5 sk");
  });

  it("a kicker: FG, then long, said label first", () => {
    expect(line({ fgm: 7, fga: 9, fg_long: 42, xpm: 24, xpa: 26 })).toBe("7-9 FG · long 42 · 24-26 xp");
    expect(seasonLine({ fgm: 7, fga: 9, fg_long: 42 })[1]).toEqual({ value: "42", label: "long", estimated: false, labelFirst: true, rank: 1, group: 0 });
  });

  it("a punter and a returner, which the brief does not list, still say something", () => {
    expect(line({ punts: 10, punt_yds: 380 })).toBe("10 punts · 380 yds");
    expect(line({ kr: 12, kr_yds: 310, pr: 8, pr_yds: 95, kr_td: 1 })).toBe("12 kr · 310 yds · 8 pr · 95 yds · 1 TD");
  });

  it("gives items, value and label apart, with lowercase labels except TD, INT, FG and PBU", () => {
    expect(seasonLine({ rush_att: 64, rush_yds: 420 })).toEqual([
      { value: "64", label: "car", estimated: false, rank: 1, group: 0 },
      { value: "420", label: "yds", estimated: false, rank: 0, group: 0 },
    ]);
    const labels = [
      ...seasonLine({ tkl: 1, def_int: 1 }),
      ...seasonLine({ pbu: 1 }),
      ...seasonLine({ fgm: 1, fga: 1 }),
      ...seasonLine({ rush_att: 1, rush_td: 1 }),
    ].map((item) => item.label);
    expect(labels).toEqual(["tkl", "INT", "PBU", "FG", "car", "TD"]);
  });
});

describe("the season line, a player who does more than one thing", () => {
  const twoWay: FootballStats = { rush_att: 64, rush_yds: 420, rush_td: 5, tkl: 31, sacks: 2, sack_yds: 9 };

  it(`shows the ${MAX_GROUPS} groups the player has the most of, the biggest first`, () => {
    const items = seasonLine(twoWay);
    expect(groupText(items, 0)).toBe("64 car · 420 yds · 5 TD");
    expect(groupText(items, 1)).toBe("31 tkl · 2 sk");
    const defenderFirst = seasonLine({ ...twoWay, tkl: 90 });
    expect(groupText(defenderFirst, 0)).toBe("90 tkl · 2 sk");
    expect(groupText(defenderFirst, 1)).toBe("64 car · 420 yds · 5 TD");
  });

  it("the second group's first item names it, so it ranks first: a quarterback's carries come before his rushing yards", () => {
    const items = seasonLine({ pass_cmp: 88, pass_att: 140, pass_yds: 1240, pass_td: 9, rush_att: 40, rush_yds: 210, rush_td: 3 });
    expect(groupText(items, 0)).toBe("88-140 · 1,240 yds · 9 TD");
    expect(rows(items, 2, 1)).toBe("40 car · 210 yds");
    expect(rows(items, 1, 1)).toBe("40 car");
  });

  it("never shows a third group", () => {
    const items = seasonLine({ rush_att: 64, rush_yds: 420, rec: 20, rec_yds: 150, tkl: 10 });
    expect(new Set(items.map((item) => item.group))).toEqual(new Set([0, 1]));
    expect(lineText(items)).not.toContain("tkl");
  });

  it(`never passes ${MAX_GROUP_ITEMS} items a group, no row is longer than MAX_ROW_CHARS, and the ranks are 0 up within each group`, () => {
    const busy: FootballStats = {
      pass_cmp: 1234, pass_att: 2345, pass_yds: 12345, pass_td: 123, pass_int: 45,
      rush_att: 1000, rush_yds: 9999, rush_td: 99,
      tkl: 800, sacks: 99.5, def_int: 99, pbu: 99, ff: 99, fr: 99,
      fgm: 99, fga: 120, xpm: 99, xpa: 100, fg_long: 55,
    };
    for (const stats of [busy, { tkl: 800, sacks: 99.5, def_int: 99, pbu: 99 }, { kr: 99, kr_yds: 9999, pr: 99, pr_yds: 999 }]) {
      const items = seasonLine(stats);
      expect(items.length).toBeLessThanOrEqual(MAX_ITEMS);
      for (const item of items) expect(itemText(item).length).toBeLessThanOrEqual(MAX_ROW_CHARS);
      for (const group of [0, 1]) {
        const inGroup = items.filter((item) => item.group === group);
        expect(inGroup.length).toBeLessThanOrEqual(MAX_GROUP_ITEMS);
        expect(inGroup.map((item) => item.rank).sort()).toEqual(inGroup.map((_, index) => index));
      }
    }
  });

  it("drops by priority, not from the end: two rows keep a running back's yards and TD over his carries", () => {
    expect(rows(seasonLine({ rush_att: 164, rush_yds: 1020, rush_td: 15 }), 2)).toBe("1,020 yds · 15 TD");
  });
});

describe("the season line, nothing to say", () => {
  it("is empty for no stats", () => {
    expect(seasonLine(null)).toEqual([]);
    expect(seasonLine({})).toEqual([]);
    expect(seasonLine({ gp: 4 })).toEqual([]);
  });

  it("leaves out anything that is zero, a quarterback's interceptions included", () => {
    expect(line({ rush_att: 12, rush_yds: 40, rush_td: 0 })).toBe("12 car · 40 yds");
    expect(line({ pass_cmp: 5, pass_att: 8, pass_int: 0 })).toBe("5-8");
    expect(seasonLine({ rush_att: 0, rec: 0, tkl: 0, gp: 0 })).toEqual([]);
  });

  it("says which yards they are when the sheet gave yards and no count", () => {
    expect(line({ rush_yds: 45 })).toBe("45 rush yds");
  });

  it("has no ~ when nothing is an estimate, and no SEASON word", () => {
    const text = line({ rush_att: 64, rush_yds: 420, rush_td: 5 });
    expect(text).not.toContain("~");
    expect(text).not.toMatch(/SEASON|TONIGHT/);
  });
});
