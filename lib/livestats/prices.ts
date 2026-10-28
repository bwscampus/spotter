import type { OpenRouterUsage } from "@/lib/ai/openrouter";

// =============================================================================
// Every price live stats reasons with, in one place (Oct 20, v7 Part 0): what
// each model costs per million tokens through OpenRouter, and what one call
// cost from the usage block OpenRouter sends back. The replay harness, the
// run manifest, the cost guard (lib/livestats/reconcile.ts) and the settings
// all read these; nothing else carries a price.
//
// OpenRouter passes provider prices through without markup and says what it
// charged on every reply (`cost`); that number wins when it is there. The
// table below is for a reply that leaves it out, and for the estimate a
// --compare or a cost guard makes before spending.
// =============================================================================

// =============================================================================
// TUNING: US dollars per million tokens. Checked against openrouter.ai when
// each entry was added (the date beside it); a price that moves is changed
// here and nowhere else.
// =============================================================================

export interface TokenRates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const HAIKU_55 = "anthropic/claude-haiku-5.5";
export const GPT_6_LUNA = "openai/gpt-6-luna";
export const GEMINI_38_FLASH = "google/gemini-3.8-flash";
export const SONNET_55 = "anthropic/claude-sonnet-5.5";

export const PRICES: ReadonlyArray<{ model: string; rates: TokenRates; checked: string }> = [
  // Jed's brief, Oct 20: $0.10 in, $0.50 out, $0.125 a cache write, $0.01 a cached read.
  { model: HAIKU_55, rates: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }, checked: "2026-10-20 (brief)" },
  { model: GPT_6_LUNA, rates: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }, checked: "2026-10-20 (brief)" },
  // openrouter.ai, Oct 5.
  { model: GEMINI_38_FLASH, rates: { input: 0.75, output: 3.75, cacheWrite: 0, cacheRead: 0.075 }, checked: "2026-10-05" },
  // openrouter.ai, Oct 11 (the halftime check).
  { model: SONNET_55, rates: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 }, checked: "2026-10-11" },
];

// =============================================================================

const PER_MILLION = 1_000_000;

/** The rates for a model, with or without its "provider/" prefix; null for one not in the table. */
export function priceFor(model: string): TokenRates | null {
  const wanted = model.trim();
  const entry = PRICES.find((each) => each.model === wanted || each.model.split("/")[1] === wanted);
  return entry ? entry.rates : null;
}

/**
 * One call's usage, as the manifest records it: every token count OpenRouter
 * reports, split the way it bills them, and the dollars. `reasoningTokens`
 * are inside `completionTokens` (thinking bills as output on this wire) and
 * are kept apart so a run can say how much of the output was thinking.
 */
export interface CallUsage {
  model: string;
  /** Uncached input tokens. */
  promptTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costUsd: number;
}

export const NO_CALL_USAGE: Omit<CallUsage, "model"> = { promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0 };

/** Dollars for a call at the table's rates for its model. 0 for a model the table lacks. */
export function costFromUsage(usage: Omit<CallUsage, "costUsd">, rates: TokenRates | null = priceFor(usage.model)): number {
  if (!rates) return 0;
  const dollars = (usage.promptTokens * rates.input + usage.completionTokens * rates.output + usage.cacheWriteTokens * rates.cacheWrite + usage.cachedTokens * rates.cacheRead) / PER_MILLION;
  return round(dollars);
}

/**
 * OpenRouter's usage block as a CallUsage for `model`. prompt_tokens includes
 * the cached and cache-written parts, which are split out;
 * completion_tokens_details.reasoning_tokens is the thinking inside the
 * completion. The reply's own `cost` wins when it is there and sensible.
 */
export function callUsageFromOpenRouter(usage: OpenRouterUsage & { completion_tokens_details?: { reasoning_tokens?: number } }, model: string): CallUsage {
  const prompt = count(usage.prompt_tokens);
  const cached = Math.min(count(usage.prompt_tokens_details?.cached_tokens), prompt);
  const written = Math.min(count(usage.prompt_tokens_details?.cache_write_tokens), prompt - cached);
  const completion = count(usage.completion_tokens);
  const reasoning = Math.min(count(usage.completion_tokens_details?.reasoning_tokens), completion);
  const counted = { model, promptTokens: prompt - cached - written, cachedTokens: cached, cacheWriteTokens: written, completionTokens: completion, reasoningTokens: reasoning };
  const charged = typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0 ? usage.cost : null;
  return { ...counted, costUsd: charged !== null ? round(charged) : costFromUsage(counted) };
}

export function addCallUsage(total: Omit<CallUsage, "model">, next: Omit<CallUsage, "model">): Omit<CallUsage, "model"> {
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    cachedTokens: total.cachedTokens + next.cachedTokens,
    cacheWriteTokens: total.cacheWriteTokens + next.cacheWriteTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    reasoningTokens: total.reasoningTokens + next.reasoningTokens,
    costUsd: round(total.costUsd + next.costUsd),
  };
}

function count(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Six places: a call is a fraction of a cent, and a game is hundreds of them. */
function round(dollars: number): number {
  return Math.round(dollars * 1e6) / 1e6;
}
