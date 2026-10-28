// =============================================================================
// Retrying a live stats call (Oct 26, the second v6 push). The first push's
// runs lost whole stretches of a game to calls that failed and were never
// asked again: a burst of rate limits, the network dropping, a provider slow
// to answer. A call that fails because nothing answered, it took too long or
// it was rate limited is asked again, up to RETRY_WAITS_MS.length more times,
// after each wait plus a little jitter, each attempt with its own time limit,
// and never past the deadline. Any other failure (a refused key, a model
// missing, a bad request) is final at once. The live route and the replay
// harness both go through it. Pure apart from the timers it is handed.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** The waits before the second, third and fourth attempt. */
export const RETRY_WAITS_MS = [2_000, 5_000, 12_000] as const;

/** Up to this much is added to each wait, so calls that failed together do not all come back at once. */
export const RETRY_JITTER_MS = 1_000;

// =============================================================================

/** The failures worth asking again: nothing answered, it took too long, or a rate limit. */
export const RETRY_CODES: ReadonlySet<string> = new Set(["claude_unreachable", "claude_timeout", "claude_rate_limited"]);

export interface RetryOptions {
  /** Each attempt's own limit. */
  perAttemptMs: number;
  /** No attempt starts once this much has passed since the first began. Absent, none. */
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

/** What a failure's code is, for deciding whether to ask again: an ExtractionError's own, else nothing. */
export function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/** How many times the call was asked again before this failure came back (set by withRetries). */
export function retriesOf(error: unknown): number {
  const retries = (error as { retries?: unknown } | null)?.retries;
  return typeof retries === "number" ? retries : 0;
}

/**
 * The attempt, asked again on a retryable failure. Resolves with the first
 * answer and how many retries it took; rejects with the last failure, which
 * carries `retries` too.
 */
export async function withRetries<T>(attempt: (signal: AbortSignal) => Promise<T>, options: RetryOptions): Promise<{ value: T; retries: number }> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const began = now();
  for (let retries = 0; ; retries++) {
    try {
      return { value: await attempt(AbortSignal.timeout(options.perAttemptMs)), retries };
    } catch (error) {
      const wait = RETRY_WAITS_MS[retries];
      const code = codeOf(error);
      const pause = wait === undefined ? 0 : wait + Math.round(random() * RETRY_JITTER_MS);
      const late = options.deadlineMs !== undefined && now() - began + pause >= options.deadlineMs;
      if (wait === undefined || code === null || !RETRY_CODES.has(code) || late) {
        if (error !== null && typeof error === "object") Object.assign(error, { retries });
        throw error;
      }
      await sleep(pause);
    }
  }
}
