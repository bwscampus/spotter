import { describe, expect, it } from "vitest";
import { callRateFor } from "@/lib/cards/callRate";
import { lineText } from "@/lib/cards/lines";
import { isKeeperLine, seasonLineFor, shotsFaced, soccerGoalsAgainstAverage, soccerLine } from "@/lib/cards/sportLines";
import { cleanStatsFor, keyGroupsFor, numberSport, SEASON_STAT_KEYS, SOCCER_STAT_KEYS, statLabel, type SeasonNumbers } from "@/lib/cards/sportStats";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import { hasLeaders, SOCCER_LEADERS, seasonLeaders } from "@/lib/panel/leaders";
import { numberStatsPrompt, SOCCER_STATS_SYSTEM_PROMPT } from "@/lib/stats/statsPrompt";
import { statsKindFor } from "@/lib/stats/types";
import { columnGroups } from "@/lib/stats/columnGroups";

// =============================================================================
// Soccer (Nov 7, Jed: soccer to the same standard as ice hockey). Field
// players' and goalkeepers' season totals as numbers, cards that read like a
// broadcast graphic. Made-up names and numbers.
// =============================================================================

const STRIKER: SeasonNumbers = { gp: 12, s_minutes: 880, s_goals: 9, s_assists: 4, s_points: 22, s_gwg: 3, s_pk_goals: 2, s_shots: 41, s_sog: 25, s_yellow: 2 };
const MIDFIELDER: SeasonNumbers = { gp: 12, s_goals: 1, s_assists: 7, s_shots: 10, s_sog: 4, s_red: 1 };
const KEEPER: SeasonNumbers = { gp: 12, s_minutes: 960, s_wins: 8, s_losses: 3, s_ties: 1, s_shots_faced: 70, s_saves: 59, s_goals_against: 11, s_shutouts: 5 };
const BACKUP: SeasonNumbers = { gp: 2, s_saves: 6, s_goals_against: 2 };

describe("soccer's stats are numbers", () => {
  it("is read as numbers, with leaders", () => {
    expect(numberSport("soccer")).toBe("soccer");
    expect(statsKindFor("soccer")).toBe("numbers");
    expect(hasLeaders("soccer")).toBe(true);
  });

  it("has its own keys, none shared with another sport but gp", () => {
    expect(SOCCER_STAT_KEYS.filter((key) => key !== "gp").every((key) => key.startsWith("s_"))).toBe(true);
    for (const key of SOCCER_STAT_KEYS) expect(SEASON_STAT_KEYS).toContain(key);
    expect(statLabel("soccer", "s_yellow")).toBe("YC");
    expect(keyGroupsFor("soccer")).toHaveLength(1);
    expect(cleanStatsFor("soccer", { s_goals: 3, h_goals: 9, s_minutes: 1240.5 })).toEqual({ s_goals: 3, s_minutes: 1240.5 });
  });

  it("puts each review group in one run of columns", () => {
    expect(columnGroups([...SOCCER_STAT_KEYS], "soccer").map((group) => group.label)).toEqual(["Played", "Scoring", "Shooting", "Cards", "Goalkeeper"]);
  });

  it("asks for every table, with the columns a soccer page prints, and leaves the rates out", () => {
    expect(numberStatsPrompt("soccer")).toBe(SOCCER_STATS_SYSTEM_PROMPT);
    for (const words of ["Goalkeeping", "s_pk_goals", "s_shots_faced", "\"1,240:30\" is 1240.5", "GAA", "Sv%", "never penalty kicks attempted"]) {
      expect(SOCCER_STATS_SYSTEM_PROMPT).toContain(words);
    }
  });
});

describe("a soccer card", () => {
  it("reads a field player the way a broadcast prints it", () => {
    expect(lineText(soccerLine(STRIKER))).toBe("9 G · 4 A · 22 PTS · 3 GWG · 2 PK · 41 SH · 25 SOG · 2 YC");
    expect(lineText(soccerLine(MIDFIELDER))).toBe("1 G · 7 A · 9 PTS · 10 SH · 4 SOG · 1 RC");
  });

  it("works out high school points as 2 a goal and 1 an assist when the sheet left them off", () => {
    expect(lineText(soccerLine({ s_goals: 3, s_assists: 2 }))).toBe("3 G · 2 A · 8 PTS");
  });

  it("leads a keeper's card with the record, GAA per 80 minutes and save percentage", () => {
    expect(lineText(soccerLine(KEEPER))).toBe("8-3-1 record · 0.92 GAA · .843 SV% · 5 SO · 59 saves");
    expect(isKeeperLine(KEEPER)).toBe(true);
    expect(isKeeperLine(STRIKER)).toBe(false);
  });

  it("works GAA out per game without minutes, and leaves save percentage off on few shots", () => {
    expect(lineText(soccerLine(BACKUP))).toBe("1.00 GAA · 6 saves");
    expect(soccerGoalsAgainstAverage({ gp: 4, s_goals_against: 6 })).toBe("1.50");
    expect(shotsFaced({ s_saves: 20, s_goals_against: 5 })).toBe(25);
  });

  it("says nothing for a player with no numbers", () => {
    expect(soccerLine({})).toEqual([]);
    expect(seasonLineFor("soccer", null)).toEqual([]);
  });
});

describe("soccer call rate and leaders", () => {
  it("rates shooters and keepers by how often their name is said", () => {
    expect(callRateFor("soccer", STRIKER)).toBe(4.7);
    expect(callRateFor("soccer", KEEPER)).toBe(2.5);
    expect(callRateFor("soccer", {})).toBe(0);
  });

  it("leads with goals, assists, points and save percentage", () => {
    const roster = [STRIKER, MIDFIELDER, KEEPER, BACKUP].map(
      (season, index) => ({ playerId: `H${index}-P${index}`, side: "home", jersey: String(index), last: `PLAYER${index}`, first: "", position: null, season }) as unknown as KeyedPlayer,
    );
    const boxes = seasonLeaders(roster, "home", "soccer");
    expect(boxes.map((box) => box.category)).toEqual([...SOCCER_LEADERS]);
    expect(boxes.map((box) => [box.number, box.unit, box.support, box.playerId])).toEqual([
      ["9", "G", "25 SOG", "H0-P0"],
      ["7", "A", "", "H1-P1"],
      ["22", "PTS", "9G 4A", "H0-P0"],
      [".843", "SV%", "0.92 GAA", "H2-P2"],
    ]);
  });
});
