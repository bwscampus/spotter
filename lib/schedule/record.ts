import { dayLabel } from "@/lib/ui/format";
import type { ScheduleGame } from "./types";

// =============================================================================
// What a schedule says about a team: its record, its league record, its
// streak and its next game (docs/PANEL_SPEC.md). Pure, so each rule is tested.
// Every date is read from its "YYYY-MM-DD" string, never through a time zone,
// so no announcer's clock can move a game a day.
// =============================================================================

export type Result = "W" | "L" | "T";

/** A game with both scores: it has been played. */
export function isPlayed(game: ScheduleGame): game is ScheduleGame & { teamScore: number; opponentScore: number } {
  return game.teamScore !== null && game.opponentScore !== null;
}

/** W, L or T from the two scores, this team's first. Null for a game not played. */
export function resultOf(game: ScheduleGame): Result | null {
  if (!isPlayed(game)) return null;
  if (game.teamScore > game.opponentScore) return "W";
  if (game.teamScore < game.opponentScore) return "L";
  return "T";
}

/** The played games, newest first. Two on the same day keep the later-listed one first. */
export function newestFirst(games: readonly ScheduleGame[]): ScheduleGame[] {
  return games
    .map((game, index) => ({ game, index }))
    .filter(({ game }) => isPlayed(game))
    .sort((a, b) => (a.game.date < b.game.date ? 1 : a.game.date > b.game.date ? -1 : b.index - a.index))
    .map(({ game }) => game);
}

function tally(games: readonly ScheduleGame[]): string {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const game of games) {
    const result = resultOf(game);
    if (result === "W") wins += 1;
    else if (result === "L") losses += 1;
    else if (result === "T") ties += 1;
  }
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/** "5-2", or "5-2-1" only when there is a tie. "0-0" before a game is played. */
export function overallRecord(games: readonly ScheduleGame[]): string {
  return tally(games);
}

/** The same, counting league games only: "2-1". */
export function leagueRecord(games: readonly ScheduleGame[]): string {
  return tally(games.filter((game) => game.league));
}

/** Whether any game on the schedule is a league game, so the league record means something. */
export function hasLeagueGames(games: readonly ScheduleGame[]): boolean {
  return games.some((game) => game.league);
}

const STREAK_WORD: Record<Result, string> = { W: "Won", L: "Lost", T: "Tied" };

/** "Won 3 straight", "Lost 1", "Tied 1": the newest run of one result. Empty before a game is played. */
export function streak(games: readonly ScheduleGame[]): string {
  const played = newestFirst(games);
  const first = played[0] ? resultOf(played[0]) : null;
  if (!first) return "";
  let run = 0;
  for (const game of played) {
    if (resultOf(game) !== first) break;
    run += 1;
  }
  return run > 1 ? `${STREAK_WORD[first]} ${run} straight` : `${STREAK_WORD[first]} ${run}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Fri" for "2026-11-06", worked out from the string in UTC so no time zone moves it. Empty for a bad date. */
export function weekdayOf(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return "";
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  return WEEKDAYS[day] ?? "";
}

/** "vs" at home or at a neutral site, "@" away. */
export function siteWord(game: Pick<ScheduleGame, "site">): "vs" | "@" {
  return game.site === "A" ? "@" : "vs";
}

/** The earliest game with no score dated today or later, or null. `today` is "YYYY-MM-DD". */
export function nextGameOf(games: readonly ScheduleGame[], today: string): ScheduleGame | null {
  let next: ScheduleGame | null = null;
  for (const game of games) {
    if (isPlayed(game) || game.date < today) continue;
    if (!next || game.date < next.date) next = game;
  }
  return next;
}

/** "Fri Nov 6 vs Coastline", "Fri Nov 6 @ Coastline", or "" when there is none. */
export function nextGame(games: readonly ScheduleGame[], today: string): string {
  const game = nextGameOf(games, today);
  if (!game) return "";
  return `${weekdayOf(game.date)} ${dayLabel(game.date)} ${siteWord(game)} ${game.opponent}`;
}

/** The score as the panel writes it, this team's first: "24-21". Empty for a game not played. */
export function scoreText(game: ScheduleGame): string {
  return isPlayed(game) ? `${game.teamScore}-${game.opponentScore}` : "";
}
