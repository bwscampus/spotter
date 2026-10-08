import { describe, expect, it, vi } from "vitest";
import { OPENROUTER_RATES, usageFromOpenRouter } from "@/lib/livestats/cost";
import { OPENROUTER_STATS_MODEL, OPENROUTER_URL, extractStatsPlaysOpenRouter, openRouterBody } from "@/lib/livestats/openrouter";
import { DEFAULT_STATS_PROVIDER, statsProvider } from "@/lib/livestats/provider";
import { STATS_SCHEMA } from "@/lib/livestats/prompt";
import { statsRoster } from "@/lib/livestats/roster";
import type { ExtractStatsRequest } from "@/lib/livestats/types";
import { ExtractionError } from "@/lib/rosters/extractWithClaude";

// The live stats call through OpenRouter (Jed, Oct 5): Gemini 3.8 Flash by
// default, with the privacy rules on every request. No network: the fetch is a
// fake. Made-up names only.

const ROSTER = statsRoster(
  [{ jersey: "22", first_name: "Sam", last_name: "Langan", position: "RB" }],
  [{ jersey: "44", first_name: "Abe", last_name: "Keslow", position: "LB" }],
);

const REQUEST: ExtractStatsRequest = {
  utterances: [
    { seq: 10, text: "first and ten", offsetMs: 60_000 },
    { seq: 11, text: "langan picks up 8 brought down by keslow", offsetMs: 64_000 },
  ],
  rosters: ROSTER,
  recentPlays: [],
};

const PLAY = {
  seqStart: 10,
  seqEnd: 11,
  quarter: 2,
  clock: "4 12",
  down: 1,
  distance: 10,
  offense: "home",
  playType: "run",
  nullified: false,
  touchdown: false,
  firstDown: false,
  confidence: 0.9,
  summary: "LANGAN 8 yd run",
  evidence: "langan picks up 8",
  updates: null,
  events: [
    { playerId: "H22-LANGAN", action: "rush", yards: 8, yardsSource: "stated", made: null },
    { playerId: "A44-KESLOW", action: "tackle", yards: null, yardsSource: null, made: null },
  ],
};

function answer(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const GOOD = {
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ plays: [PLAY] }) } }],
  usage: { prompt_tokens: 5000, completion_tokens: 300, cost: 0.0041, prompt_tokens_details: { cached_tokens: 4000 } },
};

describe("what is sent", () => {
  const body = openRouterBody(REQUEST);

  it("asks Gemini 3.8 Flash for the plays in the schema's shape, with the rosters cached", () => {
    expect(body.model).toBe("google/gemini-3.8-flash");
    expect(OPENROUTER_STATS_MODEL).toBe(body.model);
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "plays", strict: true, schema: STATS_SCHEMA } });
    const system = body.messages[0].content as Array<{ text: string; cache_control?: unknown }>;
    expect(system[1].text).toContain("H22-LANGAN Sam RB");
    expect(system[1].cache_control).toEqual({ type: "ephemeral" });
    expect(system[0].cache_control).toBeUndefined();
    expect(body.messages[1].content).toContain("langan picks up 8");
  });

  it("only goes to providers that keep nothing and do not train on it, or fails", () => {
    expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true });
  });

  it("sends no temperature, which Gemini 3.8 does not take and which leaves no provider", () => {
    expect(body).not.toHaveProperty("temperature");
  });

  it("thinks as little as it may, and asks for what the call cost", () => {
    expect(body.reasoning).toEqual({ effort: "minimal" });
    expect(body.usage).toEqual({ include: true });
  });

  it("posts to OpenRouter with the key as a bearer token", async () => {
    const fetcher = answer(GOOD);
    await extractStatsPlaysOpenRouter("sk-or-test", REQUEST, new AbortController().signal, fetcher as never);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-test");
    expect(init.method).toBe("POST");
  });

  it("sends nothing when there is nothing to read", async () => {
    const fetcher = answer(GOOD);
    expect(await extractStatsPlaysOpenRouter("k", { ...REQUEST, utterances: [] }, new AbortController().signal, fetcher as never)).toMatchObject({ plays: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("what comes back", () => {
  const signal = new AbortController().signal;

  it("is checked by the same validation as Claude's answer, and its usage is the call's", async () => {
    const result = await extractStatsPlaysOpenRouter("k", REQUEST, signal, answer(GOOD) as never);
    expect(result.plays).toHaveLength(1);
    expect(result.plays[0]).toMatchObject({ seqEnd: 11, summary: "LANGAN 8 yd run" });
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 4000, costUsd: 0.0041 });
  });

  it("drops a player who is not on either roster, as a Claude answer would be", async () => {
    const bad = { ...PLAY, events: [{ playerId: "H99-NOBODY", action: "rush", yards: 3, yardsSource: "stated", made: null }] };
    const reply = { ...GOOD, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ plays: [bad] }) } }] };
    const result = await extractStatsPlaysOpenRouter("k", REQUEST, signal, answer(reply) as never);
    // Unknown ids survive validation on purpose so rule R9 can drop them and the log can say why.
    expect(result.plays[0].events[0].playerId).toBe("H99-NOBODY");
  });

  it("is a bad window, not an error, when the answer is cut off, empty or not JSON", async () => {
    const length = { choices: [{ finish_reason: "length", message: { content: null } }], usage: { prompt_tokens: 10, completion_tokens: 4000 } };
    const empty = { choices: [{ finish_reason: "stop", message: { content: "" } }] };
    const junk = { choices: [{ finish_reason: "stop", message: { content: "plays: none" } }] };
    for (const body of [length, empty, junk, {}]) {
      expect((await extractStatsPlaysOpenRouter("k", REQUEST, signal, answer(body) as never)).plays).toEqual([]);
    }
    expect((await extractStatsPlaysOpenRouter("k", REQUEST, signal, answer(length) as never)).usage.outputTokens).toBe(4000);
  });

  it("is a refusal when the provider refuses or filters it", async () => {
    const refused = { choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] };
    const filtered = { choices: [{ finish_reason: "content_filter", message: { content: null } }] };
    for (const body of [refused, filtered]) {
      await expect(extractStatsPlaysOpenRouter("k", REQUEST, signal, answer(body) as never)).rejects.toMatchObject({ code: "claude_refused" });
    }
  });

  it("puts nothing from the transcript in the console when it cannot read the answer", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const junk = { choices: [{ finish_reason: "stop", message: { content: "langan keslow 8 yards" } }] };
    await extractStatsPlaysOpenRouter("k", REQUEST, signal, answer(junk) as never);
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/langan|keslow/i);
    spy.mockRestore();
  });
});

describe("when it fails", () => {
  const signal = new AbortController().signal;
  const code = async (status: number) => {
    try {
      await extractStatsPlaysOpenRouter("k", REQUEST, signal, answer({ error: { message: "secret transcript words" } }, status) as never);
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      return (error as ExtractionError).code;
    }
    return null;
  };

  it("says a code the live screen already knows, for each kind of failure", async () => {
    expect(await code(401)).toBe("claude_key_rejected");
    expect(await code(402)).toBe("claude_no_model_access");
    expect(await code(404)).toBe("claude_model_missing");
    expect(await code(400)).toBe("claude_bad_request");
    expect(await code(429)).toBe("claude_rate_limited");
    expect(await code(503)).toBe("claude_overloaded");
    expect(await code(504)).toBe("claude_timeout");
    expect(await code(418)).toBe("unknown");
  });

  it("is a timeout when the call is aborted, and unreachable when the network is down", async () => {
    const aborted = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(extractStatsPlaysOpenRouter("k", REQUEST, signal, aborted as never)).rejects.toMatchObject({ code: "claude_timeout" });
    await expect(extractStatsPlaysOpenRouter("k", REQUEST, signal, down as never)).rejects.toMatchObject({ code: "claude_unreachable" });
  });
});

describe("what a call costs", () => {
  it("takes the cached tokens out of the input, and uses the cost the reply carries", () => {
    expect(usageFromOpenRouter({ prompt_tokens: 7300, completion_tokens: 150, cost: 0.0016, prompt_tokens_details: { cached_tokens: 6800 } })).toEqual({
      inputTokens: 500,
      outputTokens: 150,
      cacheWriteTokens: 0,
      cacheReadTokens: 6800,
      costUsd: 0.0016,
    });
  });

  it("works the cost out from Gemini's rates when the reply has none", () => {
    const usage = usageFromOpenRouter({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
    expect(usage.costUsd).toBeCloseTo(OPENROUTER_RATES.input + OPENROUTER_RATES.output, 5);
  });

  it("is zero for a reply with no usage", () => {
    expect(usageFromOpenRouter({})).toEqual({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 });
  });
});

describe("which model reads the plays", () => {
  it("is Gemini through OpenRouter, unless LIVE_STATS_PROVIDER says anthropic", () => {
    expect(DEFAULT_STATS_PROVIDER).toBe("openrouter");
    expect(statsProvider(undefined)).toBe("openrouter");
    expect(statsProvider("")).toBe("openrouter");
    expect(statsProvider("gibberish")).toBe("openrouter");
    expect(statsProvider("anthropic")).toBe("anthropic");
    expect(statsProvider(" Anthropic ")).toBe("anthropic");
  });
});

describe("the strip when the server has no key", () => {
  it("names the OpenRouter key, not Anthropic's, because Gemini through OpenRouter reads the plays", async () => {
    const { loopWords } = await import("@/components/livestats/StatsStrip");
    const words = loopWords({ kind: "paused", code: "missing_key" }).text;
    expect(words).toContain("OPENROUTER_API_KEY");
    expect(words).not.toContain("Anthropic");
  });
});
