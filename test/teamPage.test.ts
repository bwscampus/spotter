import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UploadTermsProvider } from "@/components/auth/UploadTerms";
import {
  RosterEditor,
  SCHEDULE_SAVE_TEAM_FIRST,
  STATS_SAVE_ROSTER_FIRST,
  STATS_SAVE_TEAM_FIRST,
} from "@/components/rosters/RosterEditor";
import { compareTeams, StatsCell } from "@/components/rosters/TeamsTable";
import { ScheduleSection } from "@/components/schedule/ScheduleSection";
import { EMPTY_TEAM, hasSeasonStats, savedRow, withSeasonStats, type SavedSeason, type TeamDraft } from "@/lib/rosters/editor";
import type { RosterPlayer, TeamSummary } from "@/lib/rosters/types";
import { fromSaveGame, toSaveGame, type ScheduleGame } from "@/lib/schedule/types";

// The team page (Jed, Oct 29): three import boxes in one row, the stats and
// the schedule checked and saved right there, Other info behind the toolbar,
// and Yes/No for stats and a schedule on the Teams list and each player.
// Made-up schools and players.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }) }));

const TEAM_ID = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";
const team: TeamDraft = { ...EMPTY_TEAM, school: "Harborview", mascot: "Gulls", sport: "football", level: "varsity", season: "26-27" };

const player = (jersey: string, last_name: string, extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  jersey,
  first_name: "Sam",
  last_name,
  position: "WR",
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
  ...extra,
});

const numbers = (stats: Record<string, number>): SavedSeason => ({ season_stats: stats, season_lines: [], stats_as_of: "2026-10-20" });

const game = (date: string, opponent: string, teamScore: number | null, opponentScore: number | null): ScheduleGame => ({
  date,
  opponent,
  site: "H",
  teamScore,
  opponentScore,
  league: false,
});

function renderNew(): string {
  return renderToStaticMarkup(createElement(RosterEditor, { initial: { id: null, team: EMPTY_TEAM, players: [] } }));
}

function renderSaved(schedule: ScheduleGame[] | null = []): string {
  return renderToStaticMarkup(
    createElement(RosterEditor, {
      initial: {
        id: TEAM_ID,
        team,
        players: [
          { player: player("4", "Ardent"), season: numbers({ rec: 12, rec_yds: 180 }) },
          { player: player("11", "Brask"), season: null },
        ],
      },
      schedule,
    }),
  );
}

/** The Choose files button inside the box titled `title`, and whether it is off. */
function boxIsShut(html: string, title: string): boolean {
  const start = html.indexOf(`>${title}</p>`);
  expect(start).toBeGreaterThan(-1);
  const box = html.slice(start, html.indexOf("Import pasted text", start));
  // The attribute, not the "disabled:" Tailwind classes every button carries.
  return /<button[^>]* disabled=""[^>]*>Choose files/.test(box);
}

describe("a new team", () => {
  it("opens on three boxes in one row: roster, season stats, schedule", () => {
    const html = renderNew();
    expect(html).toContain('data-testid="import-row"');
    expect(html).toMatch(/class="[^"]*lg:grid-cols-3[^"]*" data-testid="import-row"/);
    const order = ["Roster", "Season stats", "Schedule"].map((title) => html.indexOf(`>${title}</p>`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Big, and not folded: there is nothing else to do on a new team yet.
    expect(html).not.toContain('data-testid="import-bar"');
    expect(html).not.toMatch(/<button[^>]*aria-expanded[^>]*>Import</);
  });

  it("takes a roster, and shuts stats and the schedule until the team is saved, saying why", () => {
    const html = renderNew();
    expect(boxIsShut(html, "Roster")).toBe(false);
    expect(boxIsShut(html, "Season stats")).toBe(true);
    expect(boxIsShut(html, "Schedule")).toBe(true);
    expect(html).toContain(STATS_SAVE_TEAM_FIRST.replace("'", "&#x27;"));
    expect(html).toContain(SCHEDULE_SAVE_TEAM_FIRST);
    // No schedule section on a team that is not saved.
    expect(html).not.toContain('data-testid="schedule-line"');
  });

  it("asks the upload consent once for all three", () => {
    const html = renderToStaticMarkup(
      createElement(
        UploadTermsProvider,
        // children arrives as the third argument; the cast only satisfies the prop type.
        { accepted: false } as ComponentProps<typeof UploadTermsProvider>,
        createElement(RosterEditor, { initial: { id: null, team: EMPTY_TEAM, players: [] } }),
      ),
    );
    expect(html.split("I have the right to use this roster, stats sheet or schedule").length - 1).toBe(1);
  });
});

describe("a team with a roster", () => {
  it("folds the three boxes to one bar, with Import in the toolbar", () => {
    const html = renderSaved();
    expect(html).toContain('data-testid="import-bar"');
    expect(html).toContain("A roster, season stats or a schedule.");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Import<\/button>/);
    // Folded, the boxes stay mounted (a read in flight still lands), only hidden.
    expect(html).toMatch(/<div hidden="">\s*<div class="[^"]*lg:grid-cols-3/);
  });

  it("has no Season stats or Schedule link in the toolbar, and Add other info in their place", () => {
    const html = renderSaved();
    expect(html).not.toContain(`href="/teams/${TEAM_ID}/stats"`);
    expect(html).not.toContain(`href="/teams/${TEAM_ID}/schedule"`);
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Add other info<\/button>/);
    expect(html).toContain(`href="/teams/${TEAM_ID}/cards"`);
  });

  it("shows no Other info box until Add other info opens it", () => {
    const html = renderSaved();
    expect(html).not.toContain("StatCast writes storylines for the players it mentions");
    expect(html).not.toContain("Drop the file here");
  });

  it("opens the stats box once the roster is saved, and the schedule box", () => {
    const html = renderSaved();
    expect(boxIsShut(html, "Season stats")).toBe(false);
    expect(boxIsShut(html, "Schedule")).toBe(false);
    expect(html).not.toContain(STATS_SAVE_ROSTER_FIRST);
    expect(html).toContain("type the games in");
  });

  it("says Yes or No for each player's season stats", () => {
    const html = renderSaved();
    expect(html).toMatch(/>Stats<\/th>/);
    const ardent = html.slice(html.indexOf('value="Ardent"'));
    const brask = html.slice(html.indexOf('value="Brask"'));
    expect(ardent.slice(0, ardent.indexOf("</tr>"))).toMatch(/<span>Yes<\/span>/);
    expect(brask.slice(0, brask.indexOf("</tr>"))).toMatch(/<span class="text-muted">No<\/span>/);
  });

  it("shows the saved schedule as one line with Edit", () => {
    const html = renderSaved([game("2026-09-04", "Millbrook", 21, 14), game("2026-09-11", "Castellan Prep", 7, 10)]);
    expect(html).toContain('data-testid="schedule-line"');
    expect(html).toContain("2 games");
    expect(html).toContain("1-1");
    expect(html).toMatch(/<button[^>]*>Edit<\/button>/);
  });

  it("says there is no schedule yet, and how to add one", () => {
    const html = renderSaved([]);
    expect(html).toContain("None yet. Drop one in the Schedule box");
  });

  it("says when the schedule could not be read, and shuts its box", () => {
    const html = renderSaved(null);
    expect(html).toContain("Couldn&#x27;t load this team&#x27;s schedule.");
    expect(boxIsShut(html, "Schedule")).toBe(true);
  });
});

describe("the schedule section", () => {
  it("opens on what was read, with its own Save", () => {
    const html = renderToStaticMarkup(
      createElement(ScheduleSection, {
        teamId: TEAM_ID,
        saved: [],
        start: {
          mode: "read",
          source: "schedule.pdf",
          body: {
            route: "text",
            format: "pdf",
            games: [
              { key: "g1", date: "2026-09-04", opponent: "Millbrook", site: "H", teamScore: "21", opponentScore: "14", league: false, flags: [] },
            ],
            warnings: ["One game was listed twice."],
          },
        },
        onSaved: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(html).toContain('data-testid="schedule-review"');
    expect(html).toContain("schedule.pdf");
    expect(html).toContain("One game was listed twice.");
    expect(html).toMatch(/<button[^>]*>Save schedule<\/button>/);
    expect(html).toMatch(/<button[^>]*>Discard<\/button>/);
  });

  it("opens on one empty row to type the games in", () => {
    const html = renderToStaticMarkup(
      createElement(ScheduleSection, { teamId: TEAM_ID, saved: [], start: { mode: "type" }, onSaved: () => undefined, onClose: () => undefined }),
    );
    expect(html).toContain('data-testid="schedule-review"');
    expect(html).toContain("1 game");
  });

  it("turns a saved game back into the game the panel reads", () => {
    const saved = game("2026-10-02", "Millbrook", null, null);
    expect(fromSaveGame(toSaveGame(saved))).toEqual(saved);
  });
});

describe("a player's season stats", () => {
  it("count when there are numbers or lines", () => {
    expect(hasSeasonStats(null)).toBe(false);
    expect(hasSeasonStats({ season_stats: {}, season_lines: [], stats_as_of: null })).toBe(false);
    expect(hasSeasonStats({ season_stats: { rush_yds: 410 }, season_lines: [], stats_as_of: null })).toBe(true);
    expect(hasSeasonStats({ season_stats: null, season_lines: ["12 kills, 4 aces"], stats_as_of: null })).toBe(true);
  });

  it("take what a stats save wrote, by jersey and surname, and clear everyone it did not name", () => {
    const rows = [savedRow(player("4", "Ardent"), numbers({ rec: 3 })), savedRow(player("11", "Brask"), numbers({ tkl: 9 }))];
    const next = withSeasonStats(rows, [{ jersey: "4", last_name: "ARDENT", stats: { rec: 12 }, lines: [] }], "2026-10-27");
    expect(next[0].season).toEqual({ season_stats: { rec: 12 }, season_lines: [], stats_as_of: "2026-10-27" });
    // set_season_stats clears a player it was not sent, so the table does too.
    expect(next[1].season).toBeNull();
    // Nothing in the roster changed, so neither row is marked edited.
    expect(next.map((row) => row.edited)).toEqual(rows.map((row) => row.edited));
    expect(next.map((row) => row.key)).toEqual(rows.map((row) => row.key));
  });
});

describe("the Teams list", () => {
  const summary = (extra: Partial<TeamSummary>): TeamSummary => ({
    id: "t",
    school: "Harborview",
    mascot: "Gulls",
    sport: "football",
    gender: null,
    level: "varsity",
    season: "26-27",
    updated_at: "2026-10-01T00:00:00Z",
    playerCount: 40,
    statsAsOf: null,
    hasStats: false,
    hasSchedule: false,
    ...extra,
  });

  it("says Yes with the as-of date, the age badge once a week old, or No", () => {
    const fresh = renderToStaticMarkup(createElement(StatsCell, { team: summary({ hasStats: true, statsAsOf: "2026-10-27" }), today: "2026-10-29" }));
    expect(fresh).toContain("<span>Yes</span>");
    expect(fresh).toContain("· Oct 27");
    expect(fresh).not.toContain("d old");
    const stale = renderToStaticMarkup(createElement(StatsCell, { team: summary({ hasStats: true, statsAsOf: "2026-10-20" }), today: "2026-10-29" }));
    expect(stale).toContain("· Oct 20");
    expect(stale).toContain("9 d old");
    // Stats with no as-of date are still stats.
    expect(renderToStaticMarkup(createElement(StatsCell, { team: summary({ hasStats: true }), today: "2026-10-29" }))).toBe(
      '<span class="inline-flex items-center gap-2"><span>Yes</span></span>',
    );
    expect(renderToStaticMarkup(createElement(StatsCell, { team: summary({}), today: "2026-10-29" }))).toContain(">No<");
  });

  it("sorts the teams with stats or a schedule first", () => {
    const teams = [
      summary({ id: "none" }),
      summary({ id: "old", hasStats: true, statsAsOf: "2026-09-01", hasSchedule: true }),
      summary({ id: "new", hasStats: true, statsAsOf: "2026-10-20" }),
    ];
    expect([...teams].sort((a, b) => compareTeams("stats", a, b)).map((t) => t.id)).toEqual(["old", "new", "none"]);
    expect([...teams].sort((a, b) => compareTeams("schedule", a, b)).map((t) => t.id)[0]).toBe("old");
  });
});
