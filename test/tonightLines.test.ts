import { describe, expect, it } from "vitest";
import { cardLines, itemText, lineText, MAX_ROW_CHARS, seasonLine, tonightItems, type CardLines } from "@/lib/cards/lines";
import { withTonight, type TonightTally } from "@/lib/cards/tonight";

// =============================================================================
// Season plus tonight on the card, docs/V3_DEFINITION.md 8.7 and
// docs/CARD_SPEC.md. The SEASON line is the uploaded season numbers plus
// tonight's; the TONIGHT line is tonight alone. A figure Spotter is not
// sure of (yards worked out, rule R8, or a stat from an unsure play) is an
// estimate wherever it shows, marked ~ on the card, in black.
// =============================================================================

const back: TonightTally = { stats: { rush_att: 2, rush_yds: 11 }, estimated: ["rush_yds"] };
const text = (line: CardLines) => ({ season: lineText(line.season), tonight: lineText(line.tonight) });

describe("tonight's line", () => {
  it("reads like the brief's example, with the estimate marked", () => {
    expect(lineText(tonightItems(back))).toBe("2 car · ~11 yds");
    // The yards are tonight's top stat: the first row of the TONIGHT column.
    expect(tonightItems(back)[1]).toEqual({ value: "11", label: "yds", estimated: true, rank: 0, group: 0 });
  });

  it("has no mark when every yard was said, and no TONIGHT word", () => {
    expect(lineText(tonightItems({ stats: { rush_att: 2, rush_yds: 11 }, estimated: [] }))).toBe("2 car · 11 yds");
  });

  it("is empty when there is nothing tonight", () => {
    expect(tonightItems(null)).toEqual([]);
    expect(tonightItems({ stats: {}, estimated: [] })).toEqual([]);
  });

  it("shows the group the player did most of tonight first, then the next", () => {
    expect(lineText(tonightItems({ stats: { tkl: 3, rush_att: 1, rush_yds: 4, fr: 1 }, estimated: [] }))).toBe("3 tkl · 1 fr · 1 car · 4 yds");
    expect(lineText(tonightItems({ stats: { pass_att: 3, pass_cmp: 2, pass_yds: 24, rush_att: 1, rush_yds: -7 }, estimated: [] }))).toBe(
      "2-3 · 24 yds · 1 car · -7 yds",
    );
    expect(lineText(tonightItems({ stats: { tkl: 1, sacks: 0.5, sack_yds: 4 }, estimated: [] }))).toBe("1 tkl · 0.5 sk");
  });

  it("keeps two groups, and no row passes MAX_ROW_CHARS, marks included", () => {
    const busy: TonightTally = {
      stats: { pass_cmp: 30, pass_att: 45, pass_yds: 412, pass_td: 4, pass_int: 2, rush_att: 12, rush_yds: 88 },
      estimated: ["pass_cmp", "pass_yds", "pass_td"],
    };
    const items = tonightItems(busy);
    expect(lineText(items)).toBe("~30-45 · ~412 yds · ~4 TD · 2 INT · 12 car · 88 yds");
    for (const item of items) expect(itemText(item).length).toBeLessThanOrEqual(MAX_ROW_CHARS);
  });
});

describe("the season line with tonight in it", () => {
  const season = { rush_att: 64, rush_yds: 420, rush_td: 5 };

  it("adds tonight to the season and carries the estimate onto the total", () => {
    expect(text(cardLines(season, back))).toEqual({ season: "66 car · ~431 yds · 5 TD", tonight: "2 car · ~11 yds" });
  });

  it("is the plain season line before anything happens tonight", () => {
    expect(cardLines(season, null)).toEqual({ season: seasonLine(season), tonight: [] });
  });

  it("is not there at all for a player with no season stats, only tonight's", () => {
    expect(text(cardLines(null, back))).toEqual({ season: "", tonight: "2 car · ~11 yds" });
    expect(cardLines({ gp: 0 }, back).season).toEqual([]);
  });

  it("keeps the longer field goal rather than adding, and only marks it when tonight's won", () => {
    const kicker = { fgm: 6, fga: 8, fg_long: 45 };
    const shorter = withTonight(kicker, { stats: { fgm: 1, fga: 1, fg_long: 30 }, estimated: ["fg_long"] });
    expect(shorter).toEqual({ stats: { fgm: 7, fga: 9, fg_long: 45 }, estimated: [] });
    expect(text(cardLines(kicker, { stats: { fgm: 1, fga: 1, fg_long: 51 }, estimated: ["fg_long"] }))).toEqual({
      season: "7-9 FG · long ~51",
      tonight: "1-1 FG · long ~51",
    });
  });

  it("does not add tonight to games played", () => {
    expect(withTonight({ gp: 4, tkl: 20 }, { stats: { gp: 1, tkl: 2 }, estimated: [] }).stats).toEqual({ gp: 4, tkl: 22 });
  });
});

describe("return touchdowns on the defense line", () => {
  it("show as TD when there is room for them", () => {
    expect(lineText(seasonLine({ def_int: 1, int_td: 1 }))).toBe("1 INT · 1 TD");
    expect(lineText(seasonLine({ fr: 2, fr_td: 1 }))).toBe("2 fr · 1 TD");
  });
});
