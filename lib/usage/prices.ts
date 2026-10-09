import type { OpenRouterUsage } from "@/lib/ai/openrouter";

// =============================================================================
// What a model call cost, for the usage ledger (roster, stats and storyline
// imports). OpenRouter says what it charged on every reply, and that is the
// number recorded; the rates below are only for a reply that leaves it out.
// Live stats has its own, older arithmetic in lib/livestats/cost.ts.
// =============================================================================

// =============================================================================
// TUNING: anthropic/claude-sonnet-5 through OpenRouter (IMPORT_MODEL, Oct 8),
// US dollars per million tokens, from OpenRouter's model list. ESTIMATES, used
// only when a reply carries no cost of its own.
// =============================================================================

export interface TokenPrices {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const FALLBACK_PRICES: TokenPrices = { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 };

// =============================================================================

const PER_MILLION = 1_000_000;

/** Token counts and dollars, added up over one or more calls. */
export interface MeteredUsage {
  calls: number;
  /** Every input token, cached or not. */
  inputTokens: number;
  outputTokens: number;
  /** The part of inputTokens read from the cache. */
  cachedTokens: number;
  costUsd: number;
}

export const NO_METERED_USAGE: MeteredUsage = { calls: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0 };

/** One OpenRouter reply's usage as tokens and dollars. prompt_tokens includes the cached part. */
export function meterOpenRouter(usage: OpenRouterUsage | null | undefined): MeteredUsage {
  const prompt = count(usage?.prompt_tokens);
  const output = count(usage?.completion_tokens);
  const read = Math.min(count(usage?.prompt_tokens_details?.cached_tokens), prompt);
  const written = Math.min(count(usage?.prompt_tokens_details?.cache_write_tokens), prompt - read);
  const charged = usage?.cost;
  const dollars =
    typeof charged === "number" && Number.isFinite(charged) && charged >= 0
      ? charged
      : ((prompt - read - written) * FALLBACK_PRICES.input +
          output * FALLBACK_PRICES.output +
          written * FALLBACK_PRICES.cacheWrite +
          read * FALLBACK_PRICES.cacheRead) /
        PER_MILLION;
  return { calls: 1, inputTokens: prompt, outputTokens: output, cachedTokens: read, costUsd: round(dollars) };
}

export function addMetered(total: MeteredUsage, next: MeteredUsage): MeteredUsage {
  return {
    calls: total.calls + next.calls,
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    cachedTokens: total.cachedTokens + next.cachedTokens,
    costUsd: round(total.costUsd + next.costUsd),
  };
}

/**
 * Collects every model reply a route gets, including the ones that end in
 * an error (a refusal, a reply cut off at max_tokens), because those are paid
 * for too. Handed down into the extraction code, which calls add() right after
 * each reply arrives.
 */
export class UsageMeter {
  private total: MeteredUsage = NO_METERED_USAGE;

  add(usage: OpenRouterUsage | null | undefined): void {
    this.total = addMetered(this.total, meterOpenRouter(usage));
  }

  get usage(): MeteredUsage {
    return this.total;
  }
}

/** The piece of UsageMeter the extraction code needs, so it can take a stand-in. */
export type UsageSink = Pick<UsageMeter, "add">;

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function round(dollars: number): number {
  return Math.round(dollars * 1e6) / 1e6;
}
