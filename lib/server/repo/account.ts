import type { ClientErrorReport } from "@/lib/errors/clean";
import type { FlatValues, PieceRow } from "@/lib/log/sharedLogWire";
import { query, queryOne } from "../db";

// The signed-in account itself: its upload consent, its crash reports, its
// shared game logs, and deleting it. Each calls one database function
// (db/migrations 0008-0011) with the session's user id as the owner.

/** Whether the account signs in with a password (and so must type it to delete). */
export async function hasPassword(ownerId: string): Promise<boolean> {
  const row = await queryOne<{ has: boolean }>("select password_hash is not null as has from users where id = $1", [ownerId]);
  return row?.has ?? false;
}

export async function passwordHash(ownerId: string): Promise<string | null> {
  const row = await queryOne<{ password_hash: string | null }>("select password_hash from users where id = $1", [ownerId]);
  return row?.password_hash ?? null;
}

/** Records that the account has the right to use what it uploads (V3 audit M5). Keeps the first time. */
export async function acceptUploadTerms(ownerId: string): Promise<void> {
  await query("select public.accept_upload_terms($1)", [ownerId]);
}

/** Deletes the account: its shared logs, then the users row, and everything else by cascade. */
export async function deleteAccount(ownerId: string): Promise<void> {
  await query("select public.delete_my_account($1)", [ownerId]);
}

/** False when the database declined it (more than 20 in an hour for this account). */
export async function recordClientError(ownerId: string, appVersion: string, report: ClientErrorReport): Promise<boolean> {
  const row = await queryOne<{ recorded: boolean }>(
    "select public.record_client_error($1, 'production', $2, $3, $4, $5, $6) as recorded",
    [ownerId, appVersion, report.path, report.name, report.message, report.digest],
  );
  return row?.recorded ?? false;
}

export type SharedLogRow = {
  sport: string | null;
  stats_enabled: boolean;
  scrub_version: number;
  records: number;
  masked: number;
  interims_dropped: boolean;
  log_gz_b64: string;
};

/** Stores one scrubbed game log. Throws the database's refusal (daily limit, size) for the route to map. */
export async function shareGameLog(ownerId: string, log: SharedLogRow): Promise<void> {
  await query("select public.share_game_log($1, $2, $3, $4, $5, $6, $7, $8)", [
    ownerId,
    log.sport,
    log.stats_enabled,
    log.scrub_version,
    log.records,
    log.masked,
    log.interims_dropped,
    log.log_gz_b64,
  ]);
}

/** How the database answered a shared-log write (db/migrations/0020_shared_log_pieces.sql). */
export type ShareOutcome = "ok" | "not_found" | "daily_limit" | "too_large" | "not_approved";

/** The database's refusals as outcomes; anything else is thrown on. */
function shareRefusal(error: unknown): ShareOutcome {
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  if (code === "P0002") return "not_found";
  if (code === "P0001" && message?.includes("shared_log_daily_limit")) return "daily_limit";
  if (code === "P0001" && message?.includes("shared_log_too_large")) return "too_large";
  if (code === "42501") return "not_approved";
  throw error;
}

/** Writes one piece of a shared log (and its header, on the first piece to arrive). */
export async function shareGameLogPiece(ownerId: string, piece: PieceRow): Promise<ShareOutcome> {
  try {
    await query("select public.share_game_log_piece($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)", [
      ownerId,
      piece.share_id,
      piece.part,
      piece.sport,
      piece.stats_enabled,
      piece.scrub_version,
      piece.records,
      piece.masked,
      piece.log_gz_b64,
      piece.app_commit,
      piece.header === null ? null : JSON.stringify(piece.header),
    ]);
    return "ok";
  } catch (error) {
    return shareRefusal(error);
  }
}

/** End game reached the share: complete, with the game's counts. */
export async function finishSharedLog(ownerId: string, shareId: string, counts: FlatValues | null): Promise<ShareOutcome> {
  try {
    await query("select public.finish_shared_log($1, $2, $3)", [ownerId, shareId, counts === null ? null : JSON.stringify(counts)]);
    return "ok";
  } catch (error) {
    return shareRefusal(error);
  }
}

/** The end-of-game card's rating and chips on the share, never its note. */
export async function rateSharedLog(ownerId: string, shareId: string, rating: number, blockers: readonly string[]): Promise<ShareOutcome> {
  try {
    await query("select public.rate_shared_log($1, $2, $3, $4)", [ownerId, shareId, rating, blockers]);
    return "ok";
  } catch (error) {
    return shareRefusal(error);
  }
}

/** Daily housekeeping: shared logs past their keep date, and old crash reports. */
export async function deleteExpired(): Promise<void> {
  await query("select public.delete_expired_shared_logs()");
  await query("select public.delete_old_client_errors()");
}
