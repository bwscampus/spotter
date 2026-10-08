import { clearLiveCounts } from "@/lib/game/liveCounts";
import { clearGameSnapshot, storedGameId } from "@/lib/game/snapshot";
import { clearAllGameLogs, flushPendingLog, pruneGameLogs } from "@/lib/log/gameLog";
import { clearShareChoice } from "@/lib/log/shareLog";

// =============================================================================
// This browser's game data on a shared laptop (pre-launch audit M3): what
// signing out clears, and the once-a-load tidy of old logs. Browser only,
// never on the hot path and never on the live screen.
// =============================================================================

/** The longest signing out waits for the browser's data to clear before it goes anyway. */
export const CLEAR_WAIT_MS = 2000;

/**
 * Signing out: the open game (both rosters), its counts and share choice, and
 * every game's log. The device and sound settings stay: they belong to the
 * laptop, not to the account.
 */
export async function clearBrowserData(): Promise<void> {
  const gameId = storedGameId();
  if (gameId) {
    clearLiveCounts(gameId);
    clearShareChoice(gameId);
  }
  clearGameSnapshot();
  // What the live screen still had queued would otherwise land after the clear.
  await flushPendingLog().catch(() => undefined);
  await clearAllGameLogs().catch(() => undefined);
}

/** clearBrowserData, but never longer than CLEAR_WAIT_MS: signing out always happens. */
export function clearBrowserDataWithin(ms: number = CLEAR_WAIT_MS): Promise<void> {
  return Promise.race([clearBrowserData().catch(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, ms))]);
}

let pruned = false;

/** Deletes logs past their keep, once per page load. */
export function pruneOldLogsOnce(now: number = Date.now()) {
  if (pruned) return;
  pruned = true;
  void pruneGameLogs(now).catch(() => undefined);
}
