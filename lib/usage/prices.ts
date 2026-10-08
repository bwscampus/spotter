// =============================================================================
// What an Anthropic call cost, worked out on the server from the token counts
// in its reply, for the usage ledger (roster and stats imports). Live stats
// has its own, older arithmetic in lib/livestats/cost.ts, which also takes
// OpenRouter's own charged cost; the routes use that for live stats.
// =============================================================================

// =============================================================================
// TUNING: published list prices, US dollars per million tokens. ESTIMATES:
// they are what the pricing page said on 2026-09-25, not what the invoice
// says, and a model this table does not know is priced as the dearest one in
// it so a new model is never recorded as free. Check them against
// https://platform.claude.com/docs/en/about-claude/pricing before trusting a
// number, and add a row when a route changes model.
//
// Cache writes (five minute TTL) are 1.25x input; cache reads are as published
// (0.1x input on most models).
// =============================================================================

export interface TokenPrices {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const MODEL_PRICES: Record<string, TokenPrices> = {
  "claude-sonnet-5": { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4.0, output: 20.0, cacheWrite: 5.0, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
};

// =============================================================================

const PER_MILLION = 1_000_000;

const DEAREST: TokenPrices = Object.values(MODEL_PRICES).reduce((most, prices) =>
  prices.input + prices.output > most.input + most.output ? prices : most,
);

/** The usage block of an Anthropic Messages reply, as far as cost goes. */
export interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

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

/** One Anthropic reply's usage as tokens and dollars. */
export function meterAnthropic(model: string, usage: AnthropicUsage | null | undefined): MeteredUsage {
  const prices = MODEL_PRICES[model] ?? DEAREST;
  const input = count(usage?.input_tokens);
  const output = count(usage?.output_tokens);
  const written = count(usage?.cache_creation_input_tokens);
  const read = count(usage?.cache_read_input_tokens);
  const dollars =
    (input * prices.input + output * prices.output + written * prices.cacheWrite + read * prices.cacheRead) / PER_MILLION;
  return {
    calls: 1,
    inputTokens: input + written + read,
    outputTokens: output,
    cachedTokens: read,
    costUsd: round(dollars),
  };
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
 * Collects every Anthropic reply a route gets, including the ones that end in
 * an error (a refusal, a reply cut off at max_tokens), because those are paid
 * for too. Handed down into the extraction code, which calls add() right after
 * each reply arrives.
 */
export class UsageMeter {
  private total: MeteredUsage = NO_METERED_USAGE;

  add(model: string, usage: AnthropicUsage | null | undefined): void {
    this.total = addMetered(this.total, meterAnthropic(model, usage));
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
