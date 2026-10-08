import { isSport } from "@/lib/rosters/types";
import { api } from "@/lib/apiClient";
import { logWriter, readGameLog } from "./gameLog";
import type { StoredRecord } from "./records";
import { RETAIN_DAYS, SCRUB_VERSION, toSharedLog, withoutInterims, type SharedLog } from "./scrub";
import { countsInSupabase } from "@/lib/deployEnv";

// =============================================================================
// Sharing a scrubbed copy of a game's log, at End game (Jed, Oct 5, testrun).
//
// Off for no game unless the announcer turns it off: the switch on game setup
// is on by default, and the ⋯ menu can turn it off until the game ends. What
// goes is lib/log/scrub.ts's copy (last names kept, first names and schools
// tagged, times relative, no game id, no audio), gzipped and written to shared_game_logs, which has
// no read grant: it can be read only from the Supabase dashboard, and the
// database deletes a row after RETAIN_DAYS. The database stamps each row with a
// one-way hash of the sharer's id (owner_hash, filled by the column default,
// never sent from here), so Delete my account can delete it.
//
// Best effort, like everything that records a game: a failure never stops the
// game ending, and the browser log is kept either way. Browser only.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A bigger upload than this (base64 of the gzip) drops the interim results; still bigger, it is not sent. The table's own cap is the same number. */
export const MAX_SHARE_CHARS = 6_000_000;

/** Longest the End game flow waits for the upload. */
export const SHARE_TIMEOUT_MS = 10_000;

/** A log with fewer records than this has nothing worth sharing: the mic never ran. */
export const MIN_SHARE_RECORDS = 5;

// =============================================================================

/** Said at setup, beside the switch. */
export const SHARE_NOTE = `Sends a copy of this game's log when the game ends, so name and pronunciation problems can be fixed. It keeps players' last names and how they were said. First names and school names are replaced by tags, and there is no audio. A first name that is on neither roster can slip through. Kept ${RETAIN_DAYS} days, and deleted with your account.`;

/** Said when the game ends with the switch on. */
export const LOG_SHARED_NOTE = "A copy is sent when the game ends, with last names kept and first names and schools taken out. The log itself stays in this browser.";

const choiceKey = (gameId: string) => `spotter-share-log-${gameId}`;

/** Whether this game's scrubbed log will be shared. A game with no choice recorded (one started before sharing) is not. */
export function shareChoice(gameId: string): boolean {
  try {
    return localStorage.getItem(choiceKey(gameId)) === "1";
  } catch {
    return false;
  }
}

export function setShareChoice(gameId: string, on: boolean): void {
  try {
    localStorage.setItem(choiceKey(gameId), on ? "1" : "0");
  } catch {
    // Storage blocked: the game is simply not shared.
  }
}

export function clearShareChoice(gameId: string): void {
  try {
    localStorage.removeItem(choiceKey(gameId));
  } catch {
    // Nothing to clear.
  }
}

/** What goes in the table's columns. */
export interface ShareRow {
  sport: string | null;
  stats_enabled: boolean;
  scrub_version: number;
  records: number;
  masked: number;
  interims_dropped: boolean;
  log_gz_b64: string;
}

/** Gzip, then base64: what a text column can hold. Injected so the rest is testable without a browser. */
export type Compress = (text: string) => Promise<string>;

/** CompressionStream is in every browser Spotter runs in, and in Node. */
export const gzipBase64: Compress = async (text) => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
};

/**
 * The row to write for a log, or null when there is nothing worth sharing or
 * it is too big even without its interim results. Pure but for `compress`.
 */
export async function prepareShare(
  records: readonly StoredRecord[],
  game: { sport: string | null; statsEnabled: boolean },
  compress: Compress = gzipBase64,
): Promise<ShareRow | null> {
  if (records.length < MIN_SHARE_RECORDS) return null;
  const { log, masked } = toSharedLog(records);

  const encode = async (shared: SharedLog) => compress(JSON.stringify(shared));
  let payload = await encode(log);
  let interimsDropped = false;
  if (payload.length > MAX_SHARE_CHARS) {
    interimsDropped = true;
    payload = await encode(withoutInterims(log));
    if (payload.length > MAX_SHARE_CHARS) return null;
  }
  return {
    sport: isSport(game.sport) ? game.sport : null,
    stats_enabled: game.statsEnabled,
    scrub_version: SCRUB_VERSION,
    records: log.records.length,
    masked,
    interims_dropped: interimsDropped,
    log_gz_b64: payload,
  };
}

/**
 * Shares this game's scrubbed log if it was chosen. Never throws and never
 * waits longer than SHARE_TIMEOUT_MS; says whether a copy was sent.
 */
export async function shareGameLog(game: { gameId: string; sport: string | null; statsEnabled: boolean }): Promise<boolean> {
  try {
    // Only production (main) collects game logs; a branch preview never sends one.
    if (!countsInSupabase()) return false;
    if (!shareChoice(game.gameId)) return false;
    const work = (async () => {
      await logWriter().flush();
      const row = await prepareShare(await readGameLog(game.gameId), game);
      if (row === null) return false;
      const sent = await api("POST", "/api/game-logs", row);
      if (!sent.ok) console.warn(`[Spotter] Could not share the game's log (${sent.code ?? sent.status}).`);
      return sent.ok;
    })();
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), SHARE_TIMEOUT_MS));
    return await Promise.race([work, timeout]);
  } catch {
    return false;
  }
}
