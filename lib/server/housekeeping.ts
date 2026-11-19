import { deleteExpired } from "./repo/account";
import { endStaleBoothGames } from "./repo/booth";
import { checkUsageReport } from "./usageReport";

// Daily cleanup V3 ran with Supabase's pg_cron: shared game logs past their
// keep date and crash reports past theirs (public.delete_expired_shared_logs,
// public.delete_old_client_errors). Railway Postgres has no pg_cron, so the
// one app server runs them: a minute after it starts, then every day. Both are
// idempotent, so a second replica or a restart running them again is harmless.
// The daily usage email (below) is not idempotent, so it claims its day in the
// database before it sends.

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;

async function runOnce(): Promise<void> {
  try {
    await deleteExpired();
  } catch (error) {
    console.error(`[Spotter] Daily cleanup failed (${(error as { code?: string }).code ?? "unknown"}).`);
  }
}

/** Booth partners (Nov 15): hourly, so a guest's read of a host's rosters never outlives the night by much. */
const HOUR_MS = 60 * 60 * 1000;

async function endStaleBooths(): Promise<void> {
  try {
    await endStaleBoothGames();
  } catch (error) {
    console.error(`[Spotter] Booth cleanup failed (${(error as { code?: string }).code ?? "unknown"}).`);
  }
}

/**
 * The daily usage email (Nov 19): every 15 minutes, sends yesterday's report
 * once it is past 6:00 AM Pacific, in production with STATS_REPORT_TO set.
 * Claimed in usage_reports first, so a restart or a second replica never sends twice.
 */
const REPORT_CHECK_MS = 15 * 60 * 1000;

export function startHousekeeping(): void {
  if (!process.env.DATABASE_URL) return;
  setTimeout(() => void runOnce(), FIRST_RUN_MS).unref();
  setInterval(() => void runOnce(), DAY_MS).unref();
  setTimeout(() => void endStaleBooths(), FIRST_RUN_MS).unref();
  setInterval(() => void endStaleBooths(), HOUR_MS).unref();
  setTimeout(() => void checkUsageReport(), FIRST_RUN_MS).unref();
  setInterval(() => void checkUsageReport(), REPORT_CHECK_MS).unref();
}
