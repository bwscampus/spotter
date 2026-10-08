import { api } from "@/lib/apiClient";

// =============================================================================
// Deleting the signed-in account, from Settings (audit B3). Browser only.
//
// DELETE /api/me does the deleting: public.delete_my_account() removes the
// account's shared game logs and then its users row, and every table cascades
// from users. It needs the current password for a password account, or a
// recent Google sign-in (AUTH-5). What is left is this browser's own copy: the
// open game in localStorage and the game logs in IndexedDB, both cleared here.
// =============================================================================

/**
 * The IndexedDB database lib/log/gameLog.ts keeps every game's log in. That
 * file does not export it; test/uploadConsent.test.ts holds the two equal.
 */
export const GAME_LOG_DB = "spotter-v3-log";

export type DeleteResult = { ok: true } | { ok: false; message: string };

export async function deleteMyAccount(password?: string): Promise<DeleteResult> {
  const result = await api("DELETE", "/api/me", password === undefined ? {} : { password });
  if (!result.ok) {
    console.warn(`[Spotter] Could not delete the account (${result.code ?? result.status}).`);
    // The server's own sentences say what to do (wrong password, sign in again).
    return { ok: false, message: result.error ?? "Could not delete the account. Nothing was deleted. Try again, or email us." };
  }

  // The server ended the session and cleared its cookie; this browser's copy goes too.
  clearBrowserData();
  return { ok: true };
}

/** Everything Spotter keeps in this browser: the open game, settings, and every game log. */
export function clearBrowserData(): void {
  try {
    localStorage.clear();
  } catch {
    // Storage blocked: nothing was kept there.
  }
  try {
    sessionStorage.clear();
  } catch {
    // As above.
  }
  try {
    indexedDB.deleteDatabase(GAME_LOG_DB);
  } catch {
    // No IndexedDB: no logs were kept.
  }
}
