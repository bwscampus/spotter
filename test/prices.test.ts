import { describe, expect, it } from "vitest";
import { OPENROUTER_RATES, usageFromOpenRouter } from "@/lib/livestats/cost";
import { addCallUsage, callUsageFromOpenRouter, costFromUsage, GEMINI_38_FLASH, GPT_6_LUNA, HAIKU_55, NO_CALL_USAGE, priceFor, PRICES, SONNET_55 } from "@/lib/livestats/prices";
import { HALFTIME_RATES, ratesFor } from "@/lib/livestats/settings";

// Every price in one place (v7, Part 0), and the cost math on a known usage.

describe("the price table", () => {
  it("prices Haiku 5.5 and GPT-6 Luna at $0.10 in, $0.50 out, $0.125 a cache write and $0.01 a cached read", () => {
    for (const model of [HAIKU_55, GPT_6_LUNA]) expect(priceFor(model)).toEqual({ input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 });
  });

  it("is where the older rates come from", () => {
    expect(OPENROUTER_RATES).toBe(priceFor(GEMINI_38_FLASH));
    expect(HALFTIME_RATES).toBe(priceFor(SONNET_55));
    expect(ratesFor(HAIKU_55)).toBe(priceFor(HAIKU_55));
    expect(ratesFor(GPT_6_LUNA)).toBe(priceFor(GPT_6_LUNA));
    expect(PRICES.every((entry) => entry.checked.length > 0)).toBe(true);
  });

  it("takes a model with or without its provider prefix, and knows nothing about the rest", () => {
    expect(priceFor("claude-haiku-5.5")).toEqual(priceFor(HAIKU_55));
    expect(priceFor("openai/gpt-9")).toBeNull();
  });
});

describe("the cost of a call", () => {
  const usage = { model: HAIKU_55, promptTokens: 1_000, cachedTokens: 2_500, cacheWriteTokens: 0, completionTokens: 400, reasoningTokens: 100 };
  const paid = { ...usage, costUsd: 0.000325 };

  it("adds up the four kinds of token at the model's rates", () => {
    // 1000 * 0.10 + 400 * 0.50 + 2500 * 0.01 = 100 + 200 + 25 = 325 millionths.
    expect(costFromUsage(usage)).toBeCloseTo(0.000325, 9);
    expect(costFromUsage({ ...usage, cacheWriteTokens: 2_000, cachedTokens: 0 })).toBeCloseTo((1_000 * 0.1 + 400 * 0.5 + 2_000 * 0.125) / 1e6, 9);
    expect(costFromUsage({ ...usage, model: "nobody/knows" })).toBe(0);
  });

  it("reads OpenRouter's usage block, the thinking tokens apart, and takes the charged cost when there is one", () => {
    const read = callUsageFromOpenRouter(
      { prompt_tokens: 3_500, completion_tokens: 400, prompt_tokens_details: { cached_tokens: 2_500 }, completion_tokens_details: { reasoning_tokens: 100 } },
      HAIKU_55,
    );
    expect(read).toEqual({ model: HAIKU_55, promptTokens: 1_000, cachedTokens: 2_500, cacheWriteTokens: 0, completionTokens: 400, reasoningTokens: 100, costUsd: 0.000325 });
    expect(callUsageFromOpenRouter({ prompt_tokens: 10, completion_tokens: 10, cost: 0.5 }, HAIKU_55).costUsd).toBe(0.5);
    // The old shape learns the thinking tokens too.
    expect(usageFromOpenRouter({ prompt_tokens: 10, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 30 } }).reasoningTokens).toBe(30);
    expect(usageFromOpenRouter({ prompt_tokens: 10, completion_tokens: 50 })).not.toHaveProperty("reasoningTokens");
  });

  it("adds calls up", () => {
    const total = addCallUsage(addCallUsage(NO_CALL_USAGE, paid), { ...usage, costUsd: 0.001 });
    expect(total).toMatchObject({ promptTokens: 2_000, cachedTokens: 5_000, completionTokens: 800, reasoningTokens: 200, costUsd: 0.001325 });
  });
});
