import { describe, expect, it } from "vitest";
import { teamMeta } from "@/components/rosters/RosterEditor";
import { filterTeams } from "@/components/rosters/TeamsTable";
import { readCounts } from "@/components/stats/StatsImport";
import { FOOTBALL_STAT_KEYS } from "@/lib/cards/statKeys";
import { assembleGame, type LoadedGame } from "@/lib/game/buildGame";
import { namesHref, setupHref } from "@/lib/game/setupReturn";
import { namesSummary, setupWarnings } from "@/lib/game/setupWarnings";
import { FLAG_LABELS, isNote, warningCount } from "@/lib/rosters/flagLabels";
import { statsAge } from "@/lib/rosters/teamStats";
import type { PlayerFlag, TeamSummary } from "@/lib/rosters/types";
import { columnGroups } from "@/lib/stats/columnGroups";
import { ageLabel, dayLabel, plural, runningLabel, shortDate } from "@/lib/ui/format";

// The dashboard's pure pieces (docs/UI_STYLE.md). Made-up schools and players.

describe("how the dashboard writes things", () => {
  it("writes a date and time as Oct 3, 9:12 PM, in the time zone it is given", () => {
    expect(shortDate("2026-10-04T04:12:00.000Z", "America/Los_Angeles")).toBe("Oct 3, 9:12 PM");
    expect(shortDate("2026-10-03T09:05:00.000Z", "UTC")).toBe("Oct 3, 9:05 AM");
    expect(shortDate("not a date")).toBe("");
  });

  it("writes a calendar date without letting a time zone move it", () => {
    expect(dayLabel("2026-09-24")).toBe("Sep 24");
    expect(dayLabel("2026-01-01")).toBe("Jan 1");
    expect(dayLabel("soon")).toBe("soon");
  });

  it("says how old stats are as 9 d old", () => {
    expect(ageLabel(9)).toBe("9 d old");
  });

  it("says how long a game has run as 1 h 48 min", () => {
    expect(runningLabel(108 * 60_000)).toBe("1 h 48 min");
    expect(runningLabel(12 * 60_000 + 59_000)).toBe("12 min");
    expect(runningLabel(120 * 60_000)).toBe("2 h 0 min");
    expect(runningLabel(-5)).toBe("0 min");
  });

  it("counts in words", () => {
    expect(plural(1, "player")).toBe("1 player");
    expect(plural(52, "player")).toBe("52 players");
  });
});

describe("a team's stats age", () => {
  it("goes stale at 7 days, the rule setup warns by", () => {
    expect(statsAge("2026-09-26", "2026-10-03")).toEqual({ days: 7, stale: true });
    expect(statsAge("2026-09-27", "2026-10-03")).toEqual({ days: 6, stale: false });
    expect(statsAge(null, "2026-10-03")).toBeNull();
  });
});

describe("the teams list", () => {
  const team = (school: string, mascot: string | null): TeamSummary => ({
    id: school,
    school,
    mascot,
    sport: "football",
    gender: null,
    level: "varsity",
    season: "26-27",
    updated_at: "2026-10-01T00:00:00Z",
    playerCount: 40,
    statsAsOf: null,
  });
  const teams = [team("Harborview", "Gulls"), team("Millbrook", "Otters"), team("Castellan Prep", null)];

  it("searches school and mascot, without case", () => {
    expect(filterTeams(teams, "otter").map((t) => t.school)).toEqual(["Millbrook"]);
    expect(filterTeams(teams, "HARBOR").map((t) => t.school)).toEqual(["Harborview"]);
    expect(filterTeams(teams, "  ")).toHaveLength(3);
  });

  it("describes a team beside its name as Football, Varsity, 2026", () => {
    expect(teamMeta({ sport: "football", gender: "", level: "varsity", season: "2026" })).toBe("Football, Varsity, 2026");
    expect(teamMeta({ sport: "", gender: "", level: "", season: "" })).toBe("");
  });
});

describe("the roster's warning badges", () => {
  it("has a short label for every warning the review gives", () => {
    for (const label of Object.values(FLAG_LABELS)) expect(label.length).toBeLessThanOrEqual(16);
  });

  it("counts warnings, not the notes that need no action", () => {
    const flags: PlayerFlag[][] = [["single_digit"], ["common_word_fire", "look_alike"], ["duplicate_jersey"], []];
    expect(isNote("single_digit")).toBe(true);
    expect(warningCount(flags.map((list) => ({ flags: list })))).toBe(2);
  });
});

describe("the stats review", () => {
  it("groups the columns under their headings, in the order given", () => {
    expect(columnGroups(["rush_att", "rush_yds", "rec", "tkl", "sacks", "fgm"]).map((group) => [group.label, group.keys.length])).toEqual([
      ["Rushing", 2],
      ["Receiving", 1],
      ["Defence", 2],
      ["Kicking", 1],
    ]);
    // Every key has a heading.
    expect(columnGroups([...FOOTBALL_STAT_KEYS]).flatMap((group) => group.keys)).toEqual([...FOOTBALL_STAT_KEYS]);
  });

  it("counts rows read as matched plus unmatched", () => {
    expect(readCounts({ rows: new Array(10).fill(null), unmatched: 4 })).toEqual({ read: 14, matched: 10, unmatched: 4 });
  });
});

describe("game setup's warnings", () => {
  const HOME = { id: "home", school: "Harborview", mascot: "Gulls", sport: "football", primary_color: "#0b2545" };
  const AWAY = { id: "away", school: "Millbrook", mascot: "Otters", sport: "football", primary_color: "#0c2646" };
  const row = (roster: string, jersey: string, last: string, asOf: string | null = null) => ({
    roster_id: roster,
    jersey,
    first_name: "Sam",
    last_name: last,
    position: "RB",
    grade: null,
    height: null,
    weight: null,
    pronunciations: [],
    spoken_forms: [],
    spot_mode: "normal",
    season_stats: asOf ? { gp: 4, rush_att: 30 } : null,
    season_lines: [],
    stats_as_of: asOf,
  });
  const loaded: LoadedGame = {
    ...assembleGame(HOME, AWAY, [row("home", "22", "Fennimore", "2026-09-20"), row("away", "17", "Quillon")]),
    keyterm: { kind: "unchecked", message: "Could not check the names against Deepgram." },
  };
  const names = namesHref({ away: "away", home: "home" });
  const warnings = setupWarnings(loaded, "2026-10-03", names);

  it("puts a team's own warnings under its panel, and the rest under both", () => {
    expect(warnings.map((warning) => warning.side)).toEqual(["home", "both", "both"]);
    expect(warnings[0].text).toContain("Harborview's season stats are as of 9/20, 13 days old.");
    expect(warnings[0].fix?.href).toBe("/teams/home/stats?for=game&side=home&away=away&home=home");
    expect(warnings[1].text).toMatch(/nearly the same colour/);
    expect(warnings[2].text).toBe("Could not check the names against Deepgram.");
  });

  it("links the names page with both picks, and back to setup keeps them", () => {
    expect(names).toBe("/games/new/names?away=away&home=home");
    expect(setupHref({ side: "away", away: "away", home: "home" })).toBe("/games/new?away=away&home=home");
  });

  it("says how many names and pairs beside the link", () => {
    expect(namesSummary(loaded)).toBe("2 names, 0 pairs sound alike");
  });
});
