import { describe, expect, it } from "vitest";
import { lineText } from "@/lib/cards/lines";
import { keywordHits, NEVER_SCORING, SCORING_KEYWORDS, scoringItems, scoringOn } from "@/lib/cards/scoringKeywords";
import { toCardPlayer, type CardSource } from "@/lib/cards/cardPlayer";
import { SPORTS } from "@/lib/rosters/types";

// lib/cards/scoringKeywords.ts (Nov 15): the lists, the phrases that never
// count, and which numbers are a player's scoring ones. Made-up players.

const words = (text: string) => text.split(" ");
const said = (text: string, sport: string) => keywordHits(words(text), sport).map((hit) => hit.phrase);
const row = (sport: string, sheet: Record<string, number> | null, written: string[] = []) => lineText(scoringItems(sport, sheet, written));

describe("the lists", () => {
  it("has the goal sports, football and volleyball on, and basketball and everything else off", () => {
    for (const sport of ["soccer", "ice_hockey", "lacrosse", "water_polo", "football", "volleyball"]) expect(scoringOn(sport)).toBe(true);
    for (const sport of ["basketball", "baseball", "softball", "other", null, "curling"]) expect(scoringOn(sport)).toBe(false);
    expect(SCORING_KEYWORDS.basketball).toEqual([]);
  });

  it("names only sports StatCast knows, and every list's phrases in lowercase", () => {
    for (const sport of [...Object.keys(SCORING_KEYWORDS), ...Object.keys(NEVER_SCORING)]) expect(SPORTS as readonly string[]).toContain(sport);
    for (const phrase of [...Object.values(SCORING_KEYWORDS), ...Object.values(NEVER_SCORING)].flat()) expect(phrase).toBe(phrase.toLowerCase());
  });
});

describe("finding scoring words", () => {
  it("matches whole words, in any case and with punctuation off", () => {
    expect(said("Goal smith", "soccer")).toEqual(["goal"]);
    expect(said("smith scores!", "soccer")).toEqual(["scores"]);
    expect(said("the goalie smith", "soccer")).toEqual([]);
    expect(said("scorer smith", "soccer")).toEqual([]);
  });

  it("keeps the longer phrase where two start on the same word", () => {
    expect(said("assisted by jones", "ice_hockey")).toEqual(["assisted by"]);
    expect(said("touchdown by smith", "football")).toEqual(["touchdown by"]);
  });

  it("never counts a word inside a phrase that is not a score", () => {
    for (const text of ["no goal smith", "goal kick smith", "on the goal line", "the score is 2 1", "own goal by smith", "scoreless so far"]) {
      expect(said(text, "soccer"), text).toEqual([]);
    }
  });

  it("has each sport's own words: a touchdown in football, an ace or a kill in volleyball", () => {
    expect(said("touchdown smith", "football")).toEqual(["touchdown"]);
    expect(said("goal smith", "football")).toEqual([]);
    expect(said("ace for smith", "volleyball")).toEqual(["ace"]);
    expect(said("kill smith", "volleyball")).toEqual(["kill"]);
    expect(said("goal smith", "basketball")).toEqual([]);
  });
});

describe("the scoring row", () => {
  it("hockey and soccer: goals, assists and points, worked out when the sheet had none", () => {
    expect(row("ice_hockey", { h_goals: 11, h_assists: 6, h_points: 17 })).toBe("11 G · 6 A · 17 PTS");
    expect(row("ice_hockey", { h_goals: 3, h_assists: 2 })).toBe("3 G · 2 A · 5 PTS");
    expect(row("soccer", { s_goals: 11, s_assists: 6, s_points: 28 })).toBe("11 G · 6 A · 28 PTS");
    expect(row("soccer", { s_goals: 3, s_assists: 2 })).toBe("3 G · 2 A · 8 PTS");
  });

  it("football: touchdowns he scored, and a passer's touchdown passes, never worked-out points (Jed, Nov 15)", () => {
    expect(row("football", { rush_td: 9, rec_td: 2, kr_td: 1, xpm: 30, fgm: 4 })).toBe("12 TD");
    expect(row("football", { pass_td: 18, rush_td: 4 })).toBe("4 TD · 18 pass TD");
    expect(row("football", { rush_yds: 900 })).toBe("");
  });

  it("volleyball: kills and aces", () => {
    expect(row("volleyball", { kills: 212, aces: 31, digs: 140 })).toBe("212 kills · 31 aces");
  });

  it("lacrosse and water polo: read out of the written lines", () => {
    expect(row("lacrosse", null, ["41 goals, 12 assists, 53 points"])).toBe("41 G · 12 A · 53 PTS");
    expect(row("water_polo", null, ["Goals: 22", "8 A"])).toBe("22 G · 8 A");
    expect(row("lacrosse", null, ["Averages 2 a game on draws"])).toBe("");
  });

  it("is empty for a player with no scoring numbers, and in a sport with no scoring words", () => {
    expect(row("ice_hockey", { h_sog: 40 })).toBe("");
    expect(row("soccer", null)).toBe("");
    expect(row("basketball", { pts: 300 })).toBe("");
  });

  it("rides on the card face, worked out when the game is built", () => {
    const source: CardSource = {
      jersey: "9", first_name: "Ada", last_name: "Brightwater", position: "F", grade: null, height: null, weight: null,
      pronunciations: [], season_stats: { gp: 10, h_goals: 11, h_assists: 6 }, season_lines: [], stats_as_of: null,
    };
    expect(lineText(toCardPlayer(source, "ice_hockey", "H").face?.scoring ?? [])).toBe("11 G · 6 A · 17 PTS");
    expect(toCardPlayer(source, "basketball", "H").face?.scoring).toEqual([]);
  });
});
