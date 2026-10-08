import { shareGameLog, type SharedLogRow } from "@/lib/server/repo/account";
import { failure, forUser, json } from "@/lib/server/route";
import { isSport } from "@/lib/rosters/types";
import { readJsonBody } from "@/lib/usage/body";

// POST: one game's scrubbed browser log, sent at End game while the "Share
// game log" switch is on (lib/log/shareLog.ts; scrubbing is lib/log/scrub.ts:
// last names kept, first names and schools out). Stored by
// public.share_game_log(), which stamps a hash of the owner rather than the
// id, caps the size at 6,000,000 characters and an account at 5 a day. Only
// production sends one.

/** The gzipped, base64 log is capped at 6,000,000 characters by the database. */
const MAX_BODY_BYTES = 6_100_000;

function isSharedLog(value: unknown): value is SharedLogRow {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const count = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  return (
    (v.sport === null || (typeof v.sport === "string" && isSport(v.sport))) &&
    typeof v.stats_enabled === "boolean" &&
    count(v.scrub_version) &&
    count(v.records) &&
    count(v.masked) &&
    typeof v.interims_dropped === "boolean" &&
    typeof v.log_gz_b64 === "string" &&
    /^[A-Za-z0-9+/=]+$/.test(v.log_gz_b64)
  );
}

export function POST(request: Request) {
  return forUser(request, async ({ user }) => {
    if (process.env.RAILWAY_ENVIRONMENT_NAME !== "production") return new Response(null, { status: 204 });
    const body = await readJsonBody(request, MAX_BODY_BYTES);
    if (body.kind === "too_large") return failure(413, "too_large", "That game log is too large to share.");
    if (body.kind !== "ok" || !isSharedLog(body.value)) return failure(400, "bad_request", "That game log could not be read.");
    try {
      await shareGameLog(user.id, body.value);
    } catch (error) {
      const { code, message } = (error ?? {}) as { code?: string; message?: string };
      if (code === "P0001" && message?.includes("shared_log_daily_limit")) {
        return failure(429, "shared_log_daily_limit", "Five game logs a day have already been shared.");
      }
      if (code === "42501") return failure(403, "not_approved", "This account cannot share game logs.");
      if (code === "23514") return failure(413, "too_large", "That game log is too large to share.");
      throw error;
    }
    return json({ ok: true }, 201);
  });
}
