import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Summary } from "@/components/game/GameSetup";
import { assembleGame, type GamePlayerRow, type LoadedGame } from "@/lib/game/buildGame";
import { daysBetween, newestAsOf, STALE_STATS_DAYS, staleStats } from "@/lib/game/staleStats";
import { spokenForms } from "@/lib/rosters/spokenForms";

// Season stats a week old get a warning at game setup (docs/V3_DEFINITION.md
// 6.4 and 7.1), with a way to import this week's sheet. Made-up names only.

const HOME = { id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", school: "Harborview", mascot: "Gulls", sport: "football" };
const AWAY = { id: "0f8b7c3a-1d2e-4f5a-8b6c-7d8e9f0a1b2c", school: "Millbrook", mascot: "Foxes", sport: "football" };

const row = (roster_id: string, jersey: string, last_name: string, stats_as_of: string | null): GamePlayerRow => ({
  roster_id,
  jersey,
  first_name: null,
  last_name,
  position: null,
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spoken_forms: spokenForms(last_name),
  spot_mode: "normal",
  season_stats: stats_as_of ? { rush_att: 10 } : null,
  season_lines: [],
  stats_as_of,
});

function game(homeAsOf: string | null, awayAsOf: string | null): LoadedGame {
  const players = [
    row(HOME.id, "22", "Fennimore", homeAsOf),
    row(HOME.id, "7", "Castellane", null),
    row(AWAY.id, "17", "Quillon", awayAsOf),
  ];
  return { ...assembleGame(HOME, AWAY, players), keyterm: { kind: "ok" } };
}

const render = (loaded: LoadedGame, today: string) =>
  renderToStaticMarkup(
    createElement(Summary, {
      loaded,
      wearing: { home: null, away: null },
      onWearing: () => undefined,
      starting: false,
      approved: true,
      onStart: () => undefined,
      today,
    }),
  );

describe("how old a team's stats are", () => {
  it("counts calendar days, across a month and a daylight saving change alike", () => {
    expect(daysBetween("2026-09-26", "2026-10-03")).toBe(7);
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-10-03", "2026-10-03")).toBe(0);
    expect(daysBetween("not a date", "2026-10-03")).toBeNull();
  });

  it("is the team's newest as-of date, and none for a team without stats", () => {
    expect(newestAsOf([null, "2026-09-19", "2026-09-26", "2026-09-12"])).toBe("2026-09-26");
    expect(newestAsOf([null, null])).toBeNull();
    expect(game("2026-09-26", null).home.statsAsOf).toBe("2026-09-26");
    expect(game("2026-09-26", null).away.statsAsOf).toBeNull();
  });
});

describe("the stale stats warning", () => {
  it(`starts at ${STALE_STATS_DAYS} days`, () => {
    expect(staleStats(game("2026-09-27", null), "2026-10-03")).toEqual([]);
    expect(staleStats(game("2026-09-26", null), "2026-10-03")).toEqual([
      { side: "home", rosterId: HOME.id, school: "Harborview", asOf: "2026-09-26", days: 7 },
    ]);
  });

  it("names either team, away first, and never a team with no stats", () => {
    expect(staleStats(game("2026-09-20", "2026-09-01"), "2026-10-03").map((team) => [team.side, team.days])).toEqual([
      ["away", 32],
      ["home", 13],
    ]);
    expect(staleStats(game(null, null), "2026-10-03")).toEqual([]);
  });

  it("shows at setup with the date, the age, and a way to import this week's stats that comes back", () => {
    const html = render(game("2026-09-20", "2026-10-01"), "2026-10-03");
    expect(html).toContain("Harborview&#x27;s season stats are as of 9/20, 13 days old.");
    expect(html).not.toContain("Millbrook&#x27;s season stats");
    expect(html).toContain(
      `href="/teams/${HOME.id}/stats?for=game&amp;side=home&amp;away=${AWAY.id}&amp;home=${HOME.id}"`,
    );
    // A warning, never a block: Start is still there and enabled.
    expect(html).toMatch(/<button type="button" class="[^"]*">Start<\/button>/);
  });

  it("says nothing when both teams' stats are fresh", () => {
    expect(render(game("2026-10-01", "2026-09-30"), "2026-10-03")).not.toContain("season stats are");
  });
});
