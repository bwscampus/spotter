import { setGameId, track } from "@/lib/analytics/track";
import type { LoadedGame } from "@/lib/game/buildGame";
import { clearLiveCounts, endedEventProps, endedRow, readLiveCounts, type LiveCounts } from "@/lib/game/liveCounts";
import { clearGameSnapshot, type GameSnapshot } from "@/lib/game/snapshot";
import { isSport } from "@/lib/rosters/types";
import { api } from "@/lib/apiClient";

// =============================================================================
// A game's row in called_games: written on Start, finished on End game.
//
// PRIVACY: a matchup, two times and counts (docs/V3_DEFINITION.md 9.1). No
// player names, no transcript. Those stay in the browser log.
//
// Neither call ever stops a game. A row that cannot be written means the game
// is called exactly the same and simply has no history.
// =============================================================================

/** The row Start inserts. Pure, so what goes into called_games can be tested. */
export function startedRow(loaded: LoadedGame, gameId: string, statsEnabled: boolean) {
  return {
    id: gameId,
    home_roster_id: loaded.home.id,
    away_roster_id: loaded.away.id,
    home_school: loaded.home.school,
    away_school: loaded.away.school,
    // The column only takes the sports it knows.
    sport: isSport(loaded.sport) ? loaded.sport : null,
    stats_enabled: statsEnabled,
  };
}

/**
 * Writes the row and says whether it landed. The id is made in the browser
 * first, so the browser log has a game to belong to either way.
 */
export async function beginGame(loaded: LoadedGame, gameId: string, statsEnabled: boolean): Promise<boolean> {
  const result = await api("POST", "/api/games", startedRow(loaded, gameId, statsEnabled));
  if (!result.ok) console.warn(`[Spotter] Could not record the game (${result.code ?? result.status}).`);
  return result.ok;
}

/**
 * Finishes the game: ended_at and the counts on its row, game.ended, and the
 * game cleared from this browser. The browser log is kept.
 *
 * `counts` is what the live screen has in memory; without it (a game ended
 * from the menu by starting another) the mirrored counts are used.
 */
export async function endGame(game: GameSnapshot, counts?: LiveCounts): Promise<void> {
  const final = counts ?? readLiveCounts(game.gameId);
  const endedAt = new Date();

  // Tagged with this game before it is cleared, so game.ended belongs to it.
  if (game.recorded) setGameId(game.gameId);
  track("game.ended", endedEventProps(final, new Date(game.builtAt), endedAt));
  setGameId(null);

  if (game.recorded) {
    // The game still ends if this fails. Its row keeps whatever it had.
    const result = await api("PATCH", `/api/games/${encodeURIComponent(game.gameId)}`, endedRow(final, endedAt));
    if (!result.ok) console.warn(`[Spotter] Could not save the game's counts (${result.code ?? result.status}).`);
  }

  clearLiveCounts(game.gameId);
  clearGameSnapshot();
}
