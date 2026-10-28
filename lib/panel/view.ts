import { leagueRecord, hasLeagueGames, newestFirst, nextGame, overallRecord, resultOf, scoreText, siteWord, streak, type Result } from "@/lib/schedule/record";
import type { ScheduleGame } from "@/lib/schedule/types";
import { dayLabel } from "@/lib/ui/format";

// =============================================================================
// One team's half of the panel, as words (docs/PANEL_SPEC.md): the record in
// the band, the played games newest first, and the streak and next game under
// them. Pure: worked out when the game opens or the rosters are refreshed,
// never while a card goes up.
// =============================================================================

export interface PlayedRow {
  key: string;
  /** "Oct 23" */
  date: string;
  result: Result;
  site: "vs" | "@";
  opponent: string;
  /** This team's first: "24-21". */
  score: string;
}

export interface ScheduleView {
  /** False when the team has no schedule saved: the half says so in one muted line. */
  hasSchedule: boolean;
  /** "5-2", "5-2-1" with a tie, "0-0" before a game; "" with no schedule. */
  record: string;
  /** "2-1 league", or "" when no game is a league game. */
  league: string;
  /** Every played game, newest first. The half shows as many as fit. */
  rows: PlayedRow[];
  /** "Won 3 straight", or "" before a game is played. */
  streak: string;
  /** "Fri Nov 6 vs Coastline", or "" when no game is left. */
  next: string;
}

export const NO_SCHEDULE_TEXT = "No schedule. Add one on the team page.";

/** `today` is the announcer's own "YYYY-MM-DD", or null before the browser has said it: no next game until then. */
export function scheduleView(schedule: readonly ScheduleGame[] | undefined, today: string | null): ScheduleView {
  const games = schedule ?? [];
  if (games.length === 0) return { hasSchedule: false, record: "", league: "", rows: [], streak: "", next: "" };
  return {
    hasSchedule: true,
    record: overallRecord(games),
    league: hasLeagueGames(games) ? `${leagueRecord(games)} league` : "",
    rows: newestFirst(games).map((game, index) => ({
      key: `${game.date}-${index}`,
      date: dayLabel(game.date),
      result: resultOf(game)!,
      site: siteWord(game),
      opponent: game.opponent,
      score: scoreText(game),
    })),
    streak: streak(games),
    next: today ? nextGame(games, today) : "",
  };
}

/** The line under the rows as one string, for measuring: "Won 3 straight · Next: Fri Nov 6 vs Coastline". */
export function streakLine(view: Pick<ScheduleView, "streak" | "next">): string {
  if (view.streak && view.next) return `${view.streak} · Next: ${view.next}`;
  if (view.next) return `Next: ${view.next}`;
  return view.streak;
}
