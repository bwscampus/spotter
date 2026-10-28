import { afterEach, describe, expect, it, vi } from "vitest";
import {
  leagueRecord,
  newestFirst,
  nextGame,
  overallRecord,
  resultOf,
  scoreText,
  siteWord,
  streak,
  weekdayOf,
} from "@/lib/schedule/record";
import type { ScheduleGame } from "@/lib/schedule/types";

// =============================================================================
// What a schedule says about a team (docs/PANEL_SPEC.md): its record, league
// record, streak and next game. Every school here is made up.
// =============================================================================

function played(date: string, us: number, them: number, extra: Partial<ScheduleGame> = {}): ScheduleGame {
  return { date, opponent: "Harlow Ridge", site: "H", teamScore: us, opponentScore: them, league: false, ...extra };
}

function upcoming(date: string, extra: Partial<ScheduleGame> = {}): ScheduleGame {
  return { date, opponent: "Coastline", site: "H", teamScore: null, opponentScore: null, league: false, ...extra };
}

describe("the record", () => {
  it("is W-L with no tie, this team's score first", () => {
    const games = [played("2026-08-29", 28, 14), played("2026-09-05", 17, 20), played("2026-09-12", 35, 0), upcoming("2026-11-06")];
    expect(overallRecord(games)).toBe("2-1");
    expect(games.map(resultOf)).toEqual(["W", "L", "W", null]);
  });

  it("is W-L-T only when there is a tie", () => {
    expect(overallRecord([played("2026-08-29", 28, 14), played("2026-09-05", 21, 21)])).toBe("1-0-1");
  });

  it("is 0-0 before a game is played", () => {
    expect(overallRecord([upcoming("2026-11-06")])).toBe("0-0");
  });

  it("counts league games only for the league record", () => {
    const games = [
      played("2026-08-29", 28, 14),
      played("2026-09-05", 17, 20, { league: true }),
      played("2026-09-12", 35, 0, { league: true }),
      played("2026-09-19", 10, 3, { league: true }),
    ];
    expect(leagueRecord(games)).toBe("2-1");
    expect(leagueRecord([...games, played("2026-09-26", 7, 7, { league: true })])).toBe("2-1-1");
  });
});

describe("the streak", () => {
  it("counts the newest run of one result", () => {
    const games = [played("2026-08-29", 7, 14), played("2026-09-05", 21, 20), played("2026-09-12", 35, 0), played("2026-09-19", 10, 3)];
    expect(streak(games)).toBe("Won 3 straight");
  });

  it("says one game plainly, for a loss and a tie too", () => {
    expect(streak([played("2026-08-29", 28, 14), played("2026-09-05", 17, 20)])).toBe("Lost 1");
    expect(streak([played("2026-08-29", 28, 14), played("2026-09-05", 21, 21)])).toBe("Tied 1");
    expect(streak([played("2026-08-29", 3, 14), played("2026-09-05", 7, 20)])).toBe("Lost 2 straight");
  });

  it("goes by date, not by the order the games were listed", () => {
    expect(streak([played("2026-09-19", 10, 3), played("2026-08-29", 7, 14), played("2026-09-12", 35, 0)])).toBe("Won 2 straight");
  });

  it("is empty before a game is played", () => {
    expect(streak([upcoming("2026-11-06")])).toBe("");
    expect(streak([])).toBe("");
  });
});

describe("newest first", () => {
  it("lists only played games, the newest at the top", () => {
    const games = [played("2026-08-29", 28, 14, { opponent: "First" }), upcoming("2026-11-06"), played("2026-09-12", 35, 0, { opponent: "Third" }), played("2026-09-05", 17, 20, { opponent: "Second" })];
    expect(newestFirst(games).map((game) => game.opponent)).toEqual(["Third", "Second", "First"]);
  });

  it("writes the score this team's first, and vs or @", () => {
    expect(scoreText(played("2026-09-05", 17, 20))).toBe("17-20");
    expect(scoreText(upcoming("2026-11-06"))).toBe("");
    expect(siteWord({ site: "H" })).toBe("vs");
    expect(siteWord({ site: "A" })).toBe("@");
    expect(siteWord({ site: "N" })).toBe("vs");
  });
});

describe("the next game", () => {
  const games = [played("2026-10-30", 28, 14), upcoming("2026-11-13", { opponent: "Pinewood", site: "A" }), upcoming("2026-11-06")];

  it("is the earliest game with no score dated today or later", () => {
    expect(nextGame(games, "2026-10-31")).toBe("Fri Nov 6 vs Coastline");
  });

  it("counts a game today", () => {
    expect(nextGame(games, "2026-11-06")).toBe("Fri Nov 6 vs Coastline");
  });

  it("skips a past game with no score, and says @ for an away game", () => {
    expect(nextGame(games, "2026-11-07")).toBe("Fri Nov 13 @ Pinewood");
  });

  it("writes a neutral site as vs", () => {
    expect(nextGame([upcoming("2026-11-20", { opponent: "Kettle Creek", site: "N" })], "2026-11-01")).toBe("Fri Nov 20 vs Kettle Creek");
  });

  it("is empty when none is left", () => {
    expect(nextGame(games, "2026-11-14")).toBe("");
    expect(nextGame([], "2026-11-14")).toBe("");
  });
});

describe("dates are read from the string", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("gives the same weekday in any time zone", () => {
    for (const zone of ["Pacific/Honolulu", "Asia/Tokyo", "UTC"]) {
      vi.stubEnv("TZ", zone);
      expect(weekdayOf("2026-11-06")).toBe("Fri");
      expect(weekdayOf("2027-01-01")).toBe("Fri");
      expect(nextGame([upcoming("2026-11-06")], "2026-11-01")).toBe("Fri Nov 6 vs Coastline");
    }
  });
});
