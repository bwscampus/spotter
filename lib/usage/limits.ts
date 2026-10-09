// =============================================================================
// What public.usage_begin answers, and the response a paid route sends when it
// says no (supabase/migrations/20261007043948_v3_usage_limits.sql). Pure: no
// Supabase, no network, so a test can hand it anything. The limits themselves
// live in the SQL function's TUNING block, where they are enforced.
// =============================================================================

/** The paid routes, as usage.route names them. */
export const USAGE_ROUTES = ["deepgram_token", "deepgram_keyterms", "livestats", "roster_import", "stats_import"] as const;
export type UsageRoute = (typeof USAGE_ROUTES)[number];

/** Why usage_begin refused a call it could have made. */
export const LIMIT_CODES = ["rate_limited", "daily_cap", "global_cap"] as const;
export type LimitCode = (typeof LIMIT_CODES)[number];

/** The limit codes plus the one for a check that could not run. */
export type UsageCode = LimitCode | "usage_unavailable";

/** What the announcer reads. Plain English, and says when it will work again. */
export const USAGE_MESSAGES: Record<UsageCode, string> = {
  rate_limited: "Slow down a moment and try again.",
  daily_cap: "You've hit today's limit. It resets at midnight UTC.",
  global_cap: "StatCast has hit its daily limit for everyone. Try again tomorrow.",
  usage_unavailable: "Could not check your usage just now. Try again in a moment.",
};

export type BeginReply =
  | { kind: "ok"; id: string; nonce: string }
  | { kind: "limited"; code: LimitCode; retryAfterS: number }
  /**
   * The function's own account checks. Every account is approved when it
   * signs up (Oct 7), so not_approved means one switched off in the
   * dashboard, or a missing profile.
   */
  | { kind: "refused"; code: "signed_out" | "not_approved" }
  /** The call failed, or the answer was not one the function gives. */
  | { kind: "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Longest Retry-After a refusal carries: one UTC day. */
const MAX_RETRY_AFTER_S = 24 * 60 * 60;

/** usage_begin's reply, as the Supabase client hands it back ({ data, error }). */
export function readBeginReply(data: unknown, error: unknown): BeginReply {
  if (error || typeof data !== "object" || data === null || Array.isArray(data)) return { kind: "unavailable" };
  const reply = data as Record<string, unknown>;
  if (reply.ok === true) {
    if (typeof reply.id === "string" && UUID.test(reply.id) && typeof reply.nonce === "string" && UUID.test(reply.nonce)) {
      return { kind: "ok", id: reply.id, nonce: reply.nonce };
    }
    return { kind: "unavailable" };
  }
  if (reply.ok !== false) return { kind: "unavailable" };
  const code = reply.code;
  if (isLimitCode(code)) return { kind: "limited", code, retryAfterS: retryAfter(reply.retry_after_s) };
  if (code === "signed_out" || code === "not_approved") return { kind: "refused", code };
  return { kind: "unavailable" };
}

export function isLimitCode(value: unknown): value is LimitCode {
  return typeof value === "string" && (LIMIT_CODES as readonly string[]).includes(value);
}

function retryAfter(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(MAX_RETRY_AFTER_S, Math.max(1, Math.ceil(value)));
}

const NO_STORE = { "Cache-Control": "no-store" };

/** 429 with a stable code, the sentence to show, and when to try again. */
export function limitResponse(code: LimitCode, retryAfterS: number): Response {
  const seconds = retryAfter(retryAfterS);
  return Response.json(
    { code, error: USAGE_MESSAGES[code], retryAfterS: seconds },
    { status: 429, headers: { ...NO_STORE, "Retry-After": String(seconds) } },
  );
}

/** 503 when the usage check itself could not run. Paid routes fail closed on it, except a Deepgram token. */
export function usageUnavailableResponse(): Response {
  return Response.json(
    { code: "usage_unavailable", error: USAGE_MESSAGES.usage_unavailable },
    { status: 503, headers: NO_STORE },
  );
}

/** The function's own account refusals. */
export const SWITCHED_OFF_NOTE = "This account can't use StatCast right now. Contact us.";

export function accountRefusalResponse(code: "signed_out" | "not_approved"): Response {
  return code === "signed_out"
    ? Response.json({ code, error: "Sign in first." }, { status: 401, headers: NO_STORE })
    : Response.json({ code, error: SWITCHED_OFF_NOTE }, { status: 403, headers: NO_STORE });
}
