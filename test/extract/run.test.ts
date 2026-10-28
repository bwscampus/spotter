import { describe, expect, it, vi } from "vitest";
import type { ChatOutcome, ChatRequest } from "@/lib/ai/openrouter";
import { ExtractionError } from "@/lib/rosters/extractErrors";
import { callExtractor, EXTRACT_RETRIES, type SegmentWire } from "@/lib/livestats/extract/run";
import type { SegmentRequest } from "@/lib/livestats/extract/request";
import { DEFAULT_V7_MODEL_A } from "@/lib/livestats/settings";

// One extractor call (v7, Part 5): the retry on an unreadable answer, the
// codes on a failure, the usage recorded. No network: the wire is a fake.

const REQUEST: SegmentRequest = {
  look: "segment",
  segment: { id: "seg-1-1", lines: [{ seq: 1, text: "fennimore up the middle for 6", role: "play" }], dd: null },
  candidates: [{ idx: 1, playerId: "H22-FENNIMORE", label: "#22 Reed Fennimore RB HOME", heardAs: [], score: 1, side: "home", tags: [] }, { idx: 0, playerId: null, label: "NOT_NAMED", heardAs: [], score: 0, side: null, tags: [] }],
  gameState: {},
};

const GOOD = { playType: "rush", carrierIdx: 1, passerIdx: null, receiverIdx: null, tacklerIdx: null, yardsSaid: 6, touchdown: false, penalty: "none", confidence: "high" };
const usage = { prompt_tokens: 3_000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 2_500 }, completion_tokens_details: { reasoning_tokens: 10 } };

function wire(...outcomes: Array<ChatOutcome | Error>): { wire: SegmentWire; calls: ChatRequest[] } {
  const calls: ChatRequest[] = [];
  return {
    calls,
    wire: async (request) => {
      calls.push(request);
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next ?? { kind: "empty", usage: {} };
    },
  };
}

describe("callExtractor", () => {
  it("returns the answer with its usage, through the one wire, with the schema and no temperature", async () => {
    const fake = wire({ kind: "text", text: JSON.stringify(GOOD), usage });
    const call = await callExtractor(fake.wire, DEFAULT_V7_MODEL_A, REQUEST, "a");
    expect(call).toMatchObject({ role: "a", ok: true, retried: false, model: DEFAULT_V7_MODEL_A.model, answer: GOOD });
    expect(call.usage).toMatchObject({ promptTokens: 500, cachedTokens: 2_500, completionTokens: 40, reasoningTokens: 10 });
    expect(call.usage.costUsd).toBeGreaterThan(0);
    expect(fake.calls[0].schemaName).toBe("play");
    expect(fake.calls[0].reasoning).toBe("low");
  });

  it("tries once more when the answer does not read, then gives up as bad_response", async () => {
    const fake = wire({ kind: "text", text: "not json", usage }, { kind: "text", text: JSON.stringify(GOOD), usage });
    const call = await callExtractor(fake.wire, DEFAULT_V7_MODEL_A, REQUEST, "a");
    expect(call).toMatchObject({ ok: true, retried: true });
    expect(fake.calls).toHaveLength(2);
    expect(call.usage.completionTokens).toBe(80);

    const twice = wire({ kind: "text", text: JSON.stringify({ ...GOOD, playType: "kneel" }), usage }, { kind: "length", usage });
    const failed = await callExtractor(twice.wire, DEFAULT_V7_MODEL_A, REQUEST, "b");
    expect(failed).toMatchObject({ ok: false, code: "bad_response", answer: null, role: "b" });
    expect(twice.calls).toHaveLength(EXTRACT_RETRIES + 1);
  });

  it("is the failure's code on a transport failure, with no retry", async () => {
    const fake = wire(new ExtractionError("claude_timeout"));
    const call = await callExtractor(fake.wire, DEFAULT_V7_MODEL_A, REQUEST, "a");
    expect(call).toMatchObject({ ok: false, code: "claude_timeout" });
    expect(fake.calls).toHaveLength(1);
  });

  it("names the two readers only as Reader 1 and Reader 2 on a tie-break", async () => {
    const fake = wire({ kind: "text", text: JSON.stringify(GOOD), usage });
    const spy = vi.fn(fake.wire);
    await callExtractor(spy, { ...DEFAULT_V7_MODEL_A, effort: "medium" }, REQUEST, "tie", { readers: [GOOD as never, { ...GOOD, carrierIdx: 0 } as never] });
    const content = String(spy.mock.calls[0][0].content);
    expect(content).toMatch(/Reader 1: \{/);
    expect(content).toMatch(/Reader 2: \{/);
    expect(content).not.toMatch(/haiku|luna|gpt|claude/i);
  });
});
