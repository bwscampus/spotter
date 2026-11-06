import { describe, expect, it } from "vitest";
import { callRateFor } from "@/lib/cards/callRate";
import { lineText } from "@/lib/cards/lines";
import { goalsAgainstAverage, hockeyLine, isGoalieLine, savePercentText, seasonLineFor } from "@/lib/cards/sportLines";
import { cleanStatsFor, HOCKEY_STAT_KEYS, keyGroupsFor, numberSport, SEASON_STAT_KEYS, statLabel, type SeasonNumbers } from "@/lib/cards/sportStats";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import { HOCKEY_LEADERS, hasLeaders, seasonLeaders } from "@/lib/panel/leaders";
import { SPORTS, SPORT_LABELS } from "@/lib/rosters/types";
import { HOCKEY_STATS_SYSTEM_PROMPT, numberStatsPrompt } from "@/lib/stats/statsPrompt";
import { statsKindFor } from "@/lib/stats/types";

// =============================================================================
// Ice hockey (Nov 6, Jed: a roster, skater and goalie stats and a schedule
// uploaded should give cards that read the way hockey is called). The numbers
// are a real minor league page's, under made-up names.
// =============================================================================

const SKATER: SeasonNumbers = { gp: 7, h_goals: 7, h_assists: 13, h_points: 20, h_pim: 2, h_plus_minus: 3, h_sog: 41, h_ppg: 2, h_shg: 1, h_gwg: 2 };
const ENFORCER: SeasonNumbers = { gp: 6, h_assists: 2, h_points: 2, h_pim: 46, h_sog: 10 };
const MINUS: SeasonNumbers = { gp: 3, h_goals: 1, h_assists: 2, h_points: 3, h_plus_minus: -1, h_sog: 5, h_ppg: 1, h_gwg: 1 };
const STARTER: SeasonNumbers = { gp: 7, h_wins: 4, h_shots_against: 131, h_goals_against: 8, h_saves: 123, h_shutouts: 1, h_minutes: 240 };
const BACKUP: SeasonNumbers = { gp: 7, h_wins: 2, h_losses: 1, h_shots_against: 80, h_goals_against: 8, h_saves: 72, h_minutes: 179.5 };

describe("ice hockey is a sport of its own", () => {
  it("is listed, labelled and read as numbers", () => {
    expect(SPORTS).toContain("ice_hockey");
    expect(SPORT_LABELS.ice_hockey).toBe("Ice hockey");
    expect(numberSport("ice_hockey")).toBe("ice_hockey");
    expect(statsKindFor("ice_hockey")).toBe("numbers");
    expect(hasLeaders("ice_hockey")).toBe(true);
  });

  it("has its own keys, none shared with another sport but gp", () => {
    expect(HOCKEY_STAT_KEYS.filter((key) => key !== "gp").every((key) => key.startsWith("h_"))).toBe(true);
    for (const key of HOCKEY_STAT_KEYS) expect(SEASON_STAT_KEYS).toContain(key);
    expect(statLabel("ice_hockey", "h_plus_minus")).toBe("+/-");
    expect(keyGroupsFor("ice_hockey")).toHaveLength(1);
  });

  it("keeps a negative plus/minus and a goalie's part minute", () => {
    expect(cleanStatsFor("ice_hockey", { h_plus_minus: -1, h_minutes: 179.5, pts: 9 })).toEqual({ h_plus_minus: -1, h_minutes: 179.5 });
  });

  it("asks for both tables, with the columns a hockey page prints", () => {
    expect(numberStatsPrompt("ice_hockey")).toBe(HOCKEY_STATS_SYSTEM_PROMPT);
    for (const words of ["goalies", "h_plus_minus", "h_otl", "\"179:30\" is 179.5", "PPGA", "Sv%", "GAA"]) {
      expect(HOCKEY_STATS_SYSTEM_PROMPT).toContain(words);
    }
  });
});

describe("a hockey card", () => {
  it("reads a skater the way a broadcast prints it", () => {
    expect(lineText(hockeyLine(SKATER))).toBe("7 G · 13 A · 20 PTS · 2 PPG · 1 SHG · 2 GWG · 41 SOG · +/- +3 · 2 PIM");
    expect(lineText(hockeyLine(MINUS))).toBe("1 G · 2 A · 3 PTS · 1 PPG · 1 GWG · 5 SOG · +/- -1");
    expect(lineText(hockeyLine(ENFORCER))).toBe("2 A · 2 PTS · 10 SOG · 46 PIM");
  });

  it("works out points when the sheet left them off", () => {
    expect(lineText(hockeyLine({ h_goals: 3, h_assists: 4 }))).toBe("3 G · 4 A · 7 PTS");
  });

  it("reads a goalie's record, GAA and save percentage, matching the page's own", () => {
    expect(lineText(hockeyLine(STARTER))).toBe("4-0-0 record · 2.00 GAA · .939 SV% · 1 SO · 123 saves");
    expect(lineText(hockeyLine(BACKUP))).toBe("2-1-0 record · 2.67 GAA · .900 SV% · 72 saves");
    expect(lineText(hockeyLine({ ...BACKUP, h_ties: 1 }))).toBe("2-1-1-0 record · 2.67 GAA · .900 SV% · 72 saves");
    expect(isGoalieLine(STARTER)).toBe(true);
    expect(isGoalieLine(SKATER)).toBe(false);
  });

  it("works GAA out per game when minutes are missing, and leaves save percentage off on few shots", () => {
    expect(goalsAgainstAverage({ gp: 4, h_goals_against: 10 })).toBe("2.50");
    expect(lineText(hockeyLine({ gp: 1, h_shots_against: 12, h_saves: 11, h_goals_against: 1, h_minutes: 60 }))).toBe("1.00 GAA · 11 saves");
    expect(savePercentText(80, 80)).toBe("1.000");
  });

  it("says nothing for a player with no numbers", () => {
    expect(hockeyLine({})).toEqual([]);
    expect(seasonLineFor("ice_hockey", null)).toEqual([]);
  });
});

describe("hockey call rate and leaders", () => {
  it("rates shooters and goalies by how often their name is said", () => {
    expect(callRateFor("ice_hockey", SKATER)).toBe(8.9);
    expect(callRateFor("ice_hockey", STARTER)).toBe(5.3);
    expect(callRateFor("ice_hockey", {})).toBe(0);
  });

  it("leads with points, goals, assists and save percentage", () => {
    const roster = [SKATER, ENFORCER, MINUS, STARTER, BACKUP].map(
      (season, index) => ({ playerId: `H${index}-P${index}`, side: "home", jersey: String(index), last: `PLAYER${index}`, first: "", position: null, season }) as unknown as KeyedPlayer,
    );
    const boxes = seasonLeaders(roster, "home", "ice_hockey");
    expect(boxes.map((box) => box.category)).toEqual([...HOCKEY_LEADERS]);
    expect(boxes.map((box) => [box.number, box.unit, box.support, box.playerId])).toEqual([
      ["20", "PTS", "7G 13A", "H0-P0"],
      ["7", "G", "2 PPG", "H0-P0"],
      ["13", "A", "", "H0-P0"],
      [".939", "SV%", "2.00 GAA", "H3-P3"],
    ]);
  });
});
