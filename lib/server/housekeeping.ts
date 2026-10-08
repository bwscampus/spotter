import { deleteExpired } from "./repo/account";

// Daily cleanup V3 ran with Supabase's pg_cron: shared game logs past their
// keep date and crash reports past theirs (public.delete_expired_shared_logs,
// public.delete_old_client_errors). Railway Postgres has no pg_cron, so the
// one app server runs them: a minute after it starts, then every day. Both are
// idempotent, so a second replica or a restart running them again is harmless.

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;

async function runOnce(): Promise<void> {
  try {
    await deleteExpired();
  } catch (error) {
    console.error(`[Spotter] Daily cleanup failed (${(error as { code?: string }).code ?? "unknown"}).`);
  }
}

export function startHousekeeping(): void {
  if (!process.env.DATABASE_URL) return;
  setTimeout(() => void runOnce(), FIRST_RUN_MS).unref();
  setInterval(() => void runOnce(), DAY_MS).unref();
}
