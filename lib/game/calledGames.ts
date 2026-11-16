import { setGameId, track } from "@/lib/analytics/track";
import type { LoadedGame } from "@/lib/game/buildGame";
import { clearLiveCounts, endedEventProps, endedRow, readLiveCounts, type LiveCounts } from "@/lib/game/liveCounts";
import { clearGameSnapshot, type GameSnapshot } from "@/lib/game/snapshot";
import { clearShareChoice, shareGameLog } from "@/lib/log/shareLog";
import { isSport } from "@/lib/rosters/types";
import { api } from "@/lib/apiClient";

// =============================================================================
// A game's row in called_games: written on Start, finished on End game.
//
// PRIVACY: a matchup, two times and counts (docs/V3_DEFINITION.md 9.1). No
// player names, no transcript. Those stay in the browser log, apart from the
// scrubbed copy the announcer's share switch sends at End game, which goes to
// its own table with no owner (lib/log/shareLog.ts).
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
 * Starts a draft game (Nov 3): the draft's own row becomes the live game, so
 * its id is the game's id and no second row is written. When that does not
 * happen (the draft was started already on another computer or tab, deleted,
 * or the network failed) the game is recorded the ordinary way under a new
 * id, never the draft's, so it can never end or rate another game's row.
 * Says which id the game is, and whether its row landed.
 */
export async function beginDraftGame(loaded: LoadedGame, draftId: string, statsEnabled: boolean): Promise<{ gameId: string; recorded: boolean }> {
  const result = await api("POST", `/api/drafts/${encodeURIComponent(draftId)}/start`, startedRow(loaded, draftId, statsEnabled));
  if (result.ok) return { gameId: draftId, recorded: true };
  console.warn(`[Spotter] Could not start the draft game (${result.code ?? result.status}); recording it as a new game.`);
  const gameId = crypto.randomUUID();
  return { gameId, recorded: await beginGame(loaded, gameId, statsEnabled) };
}

/**
 * A booth guest's Start (Nov 15): his own row turns live, and the host's too
 * if nobody started it yet (it counts once, against the host). There is no
 * fallback to a new id: a guest's game is only ever his row in that booth.
 */
export async function beginBoothGame(boothGameId: string): Promise<{ ok: true; gameId: string } | { ok: false; error: string }> {
  const result = await api<{ guestGameId: string }>("POST", `/api/booth/${encodeURIComponent(boothGameId)}/start`);
  if (result.ok) return { ok: true, gameId: result.data.guestGameId };
  if (result.code === "teams_missing") return { ok: false, error: "The host hasn't picked both teams yet." };
  if (result.status === 404) return { ok: false, error: "That game isn't open to you any more: the host ended it or took you out of the booth." };
  return { ok: false, error: "Could not start the game just now. Check the connection and try again." };
}

/**
 * Finishes the game: ended_at and the counts on its row, game.ended, and the
 * game cleared from this browser. The browser log is kept.
 *
 * `counts` is what the live screen has in memory; without it (a game ended
 * from the menu by starting another) the mirrored counts are used.
 */
export async function endGame(game: GameSnapshot, counts?: LiveCounts, options: { shareInBackground?: boolean } = {}): Promise<void> {
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

  // A scrubbed copy of the log, if it was chosen (lib/log/shareLog.ts). Waits
  // a few seconds at most and never fails the end of the game.
  // Ending a game only to start another does not wait for it: Start must not
  // sit on an upload.
  const shared = shareGameLog({ gameId: game.gameId, sport: game.sport, statsEnabled: game.statsEnabled }).then(() =>
    clearShareChoice(game.gameId),
  );
  if (!options.shareInBackground) await shared;

  clearLiveCounts(game.gameId);
  clearGameSnapshot();
}
