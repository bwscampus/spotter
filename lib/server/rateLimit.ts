import { NO_STORE } from "./request";

// In-memory token buckets (Production Standard AUTH-3, API4), from papaspuzzles.
// Enough for one Railway replica; they reset on deploy and are not shared across
// replicas (docs/SECURITY-GAPS.md). Memory is bounded: idle buckets are swept and
// the table never grows past MAX_BUCKETS.

/** Every limit in one place. `per` is the window in milliseconds. */
export const RATE_LIMITS = {
  // Credential endpoint, keyed by client IP.
  googleSignIn: { limit: 10, per: 60_000 },
  // Paid routes, keyed by user: a cost guard against a script or a stuck loop.
  deepgramToken: { limit: 30, per: 60_000 },
  keytermCheck: { limit: 10, per: 60_000 },
  rosterExtract: { limit: 20, per: 60 * 60_000 },
  statsExtract: { limit: 20, per: 60 * 60_000 },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

type Bucket = { tokens: number; updatedAt: number };

const MAX_BUCKETS = 10_000;
const SWEEP_EVERY = 1000;
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
    // Still full after a sweep means a flood of distinct keys: drop the oldest.
    while (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
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
