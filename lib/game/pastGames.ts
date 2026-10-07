// =============================================================================
// Past games: this account's called_games, newest first. The read is
// listPastGames in lib/server/repo/games.ts.
//
// PRIVACY: a row is a matchup, two times and counts (docs/V3_DEFINITION.md 9.1).
// Nothing here says who was spotted. What this browser still holds of a game
// (its log) is a separate question, answered in the browser by logsInBrowser.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Most games listed. A season is a few dozen; this is far past it, and keeps the page one query. */
export const PAST_GAMES_LIMIT = 200;

// =============================================================================

/** One game as the page shows it. Plain values, so it can cross from the server page to the list. */
export interface PastGame {
  id: string;
  homeSchool: string;
  awaySchool: string;
  sport: string | null;
  statsEnabled: boolean;
  startedAt: string;
  /** Null until End game: a game whose tab was closed never got its counts. */
  endedAt: string | null;
  micSeconds: number;
  cardsShown: number;
  cardsRemoved: number;
  statPlaysAdded: number;
  statPlaysUndone: number;
  /** 1 to 5, or null when no feedback was left (item 9's card, or skipped). */
  rating: number | null;
}

/** What the query returns for one row. game_feedback is one-to-one, but is accepted as a list too. */
export interface PastGameRow {
  id: string;
  home_school: string;
  away_school: string;
  sport: string | null;
  stats_enabled: boolean;
  started_at: string;
  ended_at: string | null;
  mic_seconds: number;
  reconnects: number;
  cards_shown: number;
  cards_removed: number;
  stat_plays_added: number;
  stat_plays_undone: number;
  game_feedback: { rating: number } | Array<{ rating: number }> | null;
}

function ratingOf(feedback: PastGameRow["game_feedback"]): number | null {
  const first = Array.isArray(feedback) ? feedback[0] : feedback;
  const rating = first?.rating;
  return typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null;
}

export function toPastGame(row: PastGameRow): PastGame {
  return {
    id: row.id,
    homeSchool: row.home_school,
    awaySchool: row.away_school,
    sport: row.sport,
    statsEnabled: row.stats_enabled,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    micSeconds: row.mic_seconds,
    cardsShown: row.cards_shown,
    cardsRemoved: row.cards_removed,
    statPlaysAdded: row.stat_plays_added,
    statPlaysUndone: row.stat_plays_undone,
    rating: ratingOf(row.game_feedback),
  };
}

export type PastGamesResult = { ok: true; games: PastGame[] } | { ok: false };

/** "Estancia at Brentwood": away first, the way a scoreboard reads and the live screen titles it. */
export function matchupOf(game: Pick<PastGame, "homeSchool" | "awaySchool">): string {
  return `${game.awaySchool} at ${game.homeSchool}`;
}

/** Minutes the mic was open. A few seconds is "under a minute" rather than a misleading 0. */
export function minutesListened(micSeconds: number): string {
  if (micSeconds <= 0) return "0 min";
  if (micSeconds < 30) return "under 1 min";
  return `${Math.round(micSeconds / 60)} min`;
}

/**
 * Which of these games this browser still has a log for.
 *
 * `count` says how many records a game has here; it is injected so the check
 * can be tested without IndexedDB. A game whose count fails to read is treated
 * as having none, so one bad read never hides the Download button on the rest.
 */
export async function logsInBrowser(gameIds: string[], count: (gameId: string) => Promise<number>): Promise<Set<string>> {
  const counted = await Promise.all(
    gameIds.map(async (id) => {
      try {
        return (await count(id)) > 0 ? id : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(counted.filter((id): id is string => id !== null));
}
