import { GEMINI_38_FLASH, priceFor, type TokenRates } from "./prices";
import { NO_USAGE, type StatsUsage } from "./types";

// =============================================================================
// What live stats costs, in dollars, from OpenRouter's usage for the live
// stats model (its own charged cost when the reply carries one). Ported from V2's
// lib/plays/cost.ts.
//
// Here rather than in the route because three things need it: the route, which
// reports one call; the live screen, which adds up a game for game.ended
// (spec 8.9); and the replay harness, which is how the estimate gets checked
// against a real game.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/**
 * google/gemini-3.8-flash through OpenRouter (LIVE_STATS_MODEL, the default
 * reader until Oct 28, when GPT-6 Luna took over), per million tokens, for
 * when a reply carries no cost of its own and the model is not on the list.
 * The number lives in ./prices.ts with every other price (v7, Part 0); this
 * name stays for the callers that had it. Another allowed model has its own
 * (ratesFor in ./settings.ts).
 */
export const OPENROUTER_RATES: TokenRates = priceFor(GEMINI_38_FLASH)!;

/** Dollars per million tokens. The table is ./prices.ts. */
export type { TokenRates } from "./prices";

// =============================================================================

const PER_TOKEN = 1_000_000;

/**
 * An OpenRouter reply's usage as StatsUsage. prompt_tokens includes the cached
 * part, which is split out. The reply's own cost, when it carries one, is
 * what was charged; otherwise it is worked out at `rates`, the model's own
 * (ratesFor in ./settings.ts), the default reader's when not given.
 */
export function usageFromOpenRouter(
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  },
  rates: TokenRates = OPENROUTER_RATES,
): StatsUsage {
  const cached = Math.min(count(usage.prompt_tokens_details?.cached_tokens), count(usage.prompt_tokens));
  const written = Math.min(count(usage.prompt_tokens_details?.cache_write_tokens), count(usage.prompt_tokens) - cached);
  const counted: StatsUsage = {
    inputTokens: count(usage.prompt_tokens) - cached - written,
    outputTokens: count(usage.completion_tokens),
    cacheWriteTokens: written,
    cacheReadTokens: cached,
    costUsd: 0,
  };
  const charged = typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null;
  const reasoning = Math.min(count(usage.completion_tokens_details?.reasoning_tokens), counted.outputTokens);
  return { ...counted, costUsd: charged !== null ? Math.round(charged * 1e6) / 1e6 : costOf(counted, rates), ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}) };
}

export function costOf(usage: StatsUsage, rates: TokenRates = OPENROUTER_RATES): number {
  const dollars =
    (usage.inputTokens * rates.input +
      usage.outputTokens * rates.output +
      usage.cacheWriteTokens * rates.cacheWrite +
      usage.cacheReadTokens * rates.cacheRead) /
    PER_TOKEN;
  // Six places: a single call is worth a fraction of a cent and rounding it to
  // cents would show a game's worth of them as zero.
  return Math.round(dollars * 1e6) / 1e6;
}

export function addUsage(total: StatsUsage, next: StatsUsage): StatsUsage {
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    cacheWriteTokens: total.cacheWriteTokens + next.cacheWriteTokens,
    cacheReadTokens: total.cacheReadTokens + next.cacheReadTokens,
    costUsd: Math.round((total.costUsd + next.costUsd) * 1e6) / 1e6,
    ...((total.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0) > 0 ? { reasoningTokens: (total.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0) } : {}),
  };
}

export function sumUsage(all: readonly StatsUsage[]): StatsUsage {
  return all.reduce(addUsage, NO_USAGE);
}

/**
 * The token counts game.ended carries, under the property names
 * admin.metrics_stats reads (docs/METRICS.md). tokens_in is every input token,
 * cached or not; tokens_cached is the part of it read from the cache.
 */
export function gameTokens(usage: StatsUsage): { tokens_in: number; tokens_out: number; tokens_cached: number } {
  return {
    tokens_in: usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens,
    tokens_out: usage.outputTokens,
    tokens_cached: usage.cacheReadTokens,
  };
}

/** Dollars as a screen or the harness shows them. Never rounds a real cost down to nothing. */
export function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "under $0.01";
  return `$${usd.toFixed(2)}`;
}

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
