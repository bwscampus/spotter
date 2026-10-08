import { NO_STORE } from "./request";

// In-memory token buckets (Production Standard AUTH-3, API4), from papaspuzzles.
// Enough for one Railway replica; they reset on deploy and are not shared across
// replicas (docs/SECURITY-GAPS.md). Memory is bounded: idle buckets are swept and
// the table never grows past MAX_BUCKETS.

/** Every limit in one place. `per` is the window in milliseconds. */
export const RATE_LIMITS = {
  // Credential endpoint, keyed by client IP.
  googleSignIn: { limit: 10, per: 60_000 },
  // Email and password (AUTH-3, AUTH-7). Keyed by client IP, and the ones that
  // name an address by that address too, so neither one network nor many
  // networks can hammer one account or one inbox. An address bucket refuses the
  // same way whether or not the account exists.
  passwordSignInIp: { limit: 20, per: 15 * 60_000 },
  passwordSignInEmail: { limit: 10, per: 15 * 60_000 },
  signUpIp: { limit: 5, per: 60 * 60_000 },
  // At most this many "you already have an account" emails to one inbox; past
  // it sign-up still answers the same, it just sends nothing.
  signUpNoticeEmail: { limit: 2, per: 60 * 60_000 },
  forgotPasswordIp: { limit: 10, per: 60 * 60_000 },
  forgotPasswordEmail: { limit: 3, per: 60 * 60_000 },
  resetPasswordIp: { limit: 10, per: 15 * 60_000 },
  verifyEmailIp: { limit: 20, per: 60 * 60_000 },
  resendVerificationIp: { limit: 10, per: 60 * 60_000 },
  resendVerificationEmail: { limit: 3, per: 60 * 60_000 },
  // Paid routes are limited by the spend ledger in the database instead
  // (public.usage_begin through lib/server/usage.ts), shared by every replica.
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

type Bucket = { tokens: number; updatedAt: number };

const MAX_BUCKETS = 10_000;
const SWEEP_EVERY = 1000;
/** Where a flood is evicted down to: room for a tenth of the table before the next sweep. */
const EVICT_TO = Math.floor(MAX_BUCKETS * 0.9);
const buckets = new Map<string, Bucket>();
let opsSinceSweep = 0;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    const [name] = key.split(":", 1) as [RateLimitName];
    if (now - bucket.updatedAt > (RATE_LIMITS[name]?.per ?? 0)) buckets.delete(key);
  }
}

/** Takes one token for `subject` (an IP or a user id). False when the bucket is empty. */
export function takeToken(name: RateLimitName, subject: string, now = Date.now()): boolean {
  const { limit, per } = RATE_LIMITS[name];
  if (++opsSinceSweep >= SWEEP_EVERY || buckets.size >= MAX_BUCKETS) {
    opsSinceSweep = 0;
    sweep(now);
    // Still full after a sweep means a flood of distinct keys: drop the oldest
    // down to EVICT_TO, so the next calls do not each sweep the whole table again.
    if (buckets.size >= MAX_BUCKETS) {
      for (const key of buckets.keys()) {
        if (buckets.size <= EVICT_TO) break;
        buckets.delete(key);
      }
    }
  }

  const key = `${name}:${subject}`;
  const bucket = buckets.get(key) ?? { tokens: limit, updatedAt: now };
  bucket.tokens = Math.min(limit, bucket.tokens + ((now - bucket.updatedAt) * limit) / per);
  bucket.updatedAt = now;
  // Re-insert so Map order tracks recency for the eviction above.
  buckets.delete(key);
  buckets.set(key, bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export function tooManyRequests(): Response {
  return Response.json(
    { code: "rate_limited", error: "Too many tries. Wait a moment and try again." },
    { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
  );
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
  opsSinceSweep = 0;
}
