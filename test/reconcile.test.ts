import { describe, expect, it } from "vitest";
import type { ExtractCall } from "@/lib/livestats/extract/run";
import type { SegmentRequest } from "@/lib/livestats/extract/request";
import { NOT_A_PLAY, type ExtractAnswer } from "@/lib/livestats/extract/schema";
import { agreementKey, GUARD_A_ONLY_USD, GUARD_SKIP_B_USD, guardMode, mergeAgreed, partialCredit, reconcileSegment, replyOf, ZDR_REFUSED } from "@/lib/livestats/reconcile";
import { DEFAULT_V7_SETTINGS, HAIKU_MODEL, LUNA_MODEL, type V7Settings } from "@/lib/livestats/settings";
import { fetchZdrModels, zdrAllows, ZdrCheck, zdrModelsOf } from "@/lib/livestats/zdr";

// Two readers and a tie-break (v7, Part 8): the agree path, a disagreement
// the tie-break settles, one it does not (partial credit), reader B
// unavailable, and the cost guard changing mode. No network: the extractor
// call is a fake that answers by role.

const A: ExtractAnswer = { ...NOT_A_PLAY, playType: "rush", carrierIdx: 2, tacklerIdx: 3, yardsSaid: 6, confidence: "high" };
const B_SAME: ExtractAnswer = { ...A, tacklerIdx: null, yardsSaid: null };
const B_OTHER: ExtractAnswer = { ...A, carrierIdx: 1, yardsSaid: 4 };

const REQUEST: SegmentRequest = {
  look: "segment",
  segment: { id: "seg-1-2", lines: [{ seq: 1, text: "fennimore up the middle picks up 6", role: "play" }, { seq: 2, text: "brought down by quillon", role: "play" }], dd: null },
  candidates: [
    { idx: 1, playerId: "H7-CASTELLANE", label: "#7 Dax Castellane QB HOME", heardAs: [], score: 0, side: "home", tags: ["prior:qb"] },
    { idx: 2, playerId: "H22-FENNIMORE", label: "#22 Reed Fennimore RB HOME", heardAs: [], score: 1, side: "home", tags: [] },
    { idx: 3, playerId: "A17-QUILLON", label: "#17 Marek Quillon LB AWAY", heardAs: [], score: 1, side: "away", tags: [] },
    { idx: 0, playerId: null, label: "NOT_NAMED", heardAs: [], score: 0, side: null, tags: [] },
  ],
  gameState: { offense: "home" },
  budget: { spentUsd: 0, maxCostUsd: 1 },
};

type Answers = Partial<Record<"a" | "b" | "tie", ExtractAnswer | "fail">>;

/** A fake extractor that answers by role and records the calls it got. */
function readers(answers: Answers, zdr: boolean | "all" = true) {
  const calls: Array<{ role: string; model: string; readers?: unknown }> = [];
  const call = async (_wire: unknown, setting: { model: string; effort: string }, _request: unknown, role: "a" | "b" | "tie", options?: { readers?: unknown }): Promise<ExtractCall> => {
    calls.push({ role, model: setting.model, readers: options?.readers });
    const answer = answers[role];
    const usage = { model: setting.model, promptTokens: 100, cachedTokens: 2_000, cacheWriteTokens: 0, completionTokens: 40, reasoningTokens: 0, costUsd: 0.0005 };
    if (answer === undefined || answer === "fail") return { role, model: setting.model, effort: setting.effort as never, answer: null, usage, seconds: 1, ok: false, code: "claude_timeout", retried: false };
    return { role, model: setting.model, effort: setting.effort as never, answer, usage, seconds: 1, ok: true, retried: false };
  };
  // The zero-retention check: `zdr` false refuses reader B's model only; "all" refuses every model.
  const deps = { wire: async () => ({ kind: "empty" as const, usage: {} }), zdrAllows: async (model: string) => (zdr === "all" ? false : zdr || model === HAIKU_MODEL), call: call as never };
  return { calls, deps };
}

const run = (answers: Answers, settings: Partial<V7Settings> = {}, request = REQUEST, zdr: boolean | "all" = true) => {
  const fake = readers(answers, zdr);
  return reconcileSegment(request, { ...DEFAULT_V7_SETTINGS, ...settings }, fake.deps).then((result) => ({ result, calls: fake.calls }));
};

describe("the agreement key", () => {
  it("is the play type and the three players, not the tackler or the yards", () => {
    expect(agreementKey(A)).toBe(agreementKey(B_SAME));
    expect(agreementKey(A)).not.toBe(agreementKey(B_OTHER));
  });

  it("merges agreed answers: yards when both say it or one does and the number is in the lines", () => {
    const lines = ["fennimore up the middle picks up 6"];
    expect(mergeAgreed(A, B_SAME, lines)).toMatchObject({ yardsSaid: 6, tacklerIdx: 3, confidence: "high" });
    expect(mergeAgreed(A, { ...A, yardsSaid: 7 }, lines).yardsSaid).toBeNull();
    expect(mergeAgreed({ ...A, yardsSaid: 16 }, B_SAME, lines).yardsSaid).toBeNull();
    expect(mergeAgreed(B_SAME, A, lines)).toMatchObject({ yardsSaid: 6, tacklerIdx: 3 });
  });

  it("credits only what both agree on when they do not, at low confidence", () => {
    expect(partialCredit(A, B_OTHER)).toEqual({ ...A, carrierIdx: 0, yardsSaid: null, confidence: "low" });
    expect(partialCredit(A, { ...A, playType: "pass_complete", receiverIdx: 2 })).toMatchObject({ playType: "rush", receiverIdx: null, confidence: "low" });
  });
});

describe("reconcileSegment", () => {
  it("accepts two readers who agree, in parallel, as high confidence", async () => {
    const { result, calls } = await run({ a: A, b: B_SAME });
    expect(result).toMatchObject({ agreement: "agree", answer: { ...A, confidence: "high" } });
    expect(calls.map((call) => call.role)).toEqual(["a", "b"]);
    expect(calls[1].model).toBe(LUNA_MODEL);
    const reply = replyOf(result);
    expect(reply).toMatchObject({ ok: true, usedB: true });
    if (reply.ok) expect(reply.calls.map((call) => call.role)).toEqual(["a", "b"]);
  });

  it("runs the tie-break when they disagree and takes its answer when it matches either", async () => {
    const { result, calls } = await run({ a: A, b: B_OTHER, tie: { ...B_OTHER, confidence: "medium" } });
    expect(result).toMatchObject({ agreement: "tiebreak", answer: { carrierIdx: 1, confidence: "high" } });
    expect(calls.map((call) => call.role)).toEqual(["a", "b", "tie"]);
    expect(calls[2].model).toBe(HAIKU_MODEL);
    expect(calls[2].readers).toEqual([A, B_OTHER]);
  });

  it("credits only the agreed fields when the tie-break matches neither, or fails", async () => {
    const neither = await run({ a: A, b: B_OTHER, tie: { ...A, carrierIdx: 3 } });
    expect(neither.result).toMatchObject({ agreement: "partial", answer: { carrierIdx: 0, yardsSaid: null, confidence: "low" } });
    const failed = await run({ a: A, b: B_OTHER, tie: "fail" });
    expect(failed.result).toMatchObject({ agreement: "partial" });
    const noTie = await run({ a: A, b: B_OTHER, tie: A }, { reconcile: "ab-no-tiebreak" });
    expect(noTie.result).toMatchObject({ agreement: "partial" });
    expect(noTie.calls.map((call) => call.role)).toEqual(["a", "b"]);
  });

  it("stands on A when B is unavailable, fails, or has no zero-retention endpoint", async () => {
    const failed = await run({ a: A, b: "fail" });
    expect(failed.result).toMatchObject({ agreement: "b-unavailable", answer: A });
    const noZdr = await run({ a: A, b: B_SAME }, {}, REQUEST, false);
    expect(noZdr.result).toMatchObject({ agreement: "b-unavailable", answer: A });
    expect(noZdr.calls.map((call) => call.role)).toEqual(["a"]);
    const alone = await run({ a: A, b: B_SAME }, { reconcile: "a" });
    expect(alone.result).toMatchObject({ agreement: "a-only" });
    expect(alone.calls).toHaveLength(1);
  });

  it("fails closed, sending nothing, when reader A's model has no zero-retention endpoint or the list cannot be read", async () => {
    const refused = await run({ a: A, b: B_SAME }, {}, REQUEST, "all");
    expect(refused.result).toMatchObject({ ok: false, code: ZDR_REFUSED });
    expect(refused.calls).toEqual([]);
  });

  it("fails the segment when A fails", async () => {
    const { result } = await run({ a: "fail", b: B_SAME });
    expect(result).toMatchObject({ ok: false, code: "claude_timeout" });
    expect(replyOf(result)).toEqual({ ok: false, code: "claude_timeout" });
  });

  it("runs A twice in the aa ablation", async () => {
    const { result, calls } = await run({ a: A, b: B_SAME }, { reconcile: "aa" });
    expect(calls.map((call) => call.model)).toEqual([HAIKU_MODEL, HAIKU_MODEL]);
    expect(result).toMatchObject({ agreement: "aa" });
  });

  it("switches mode with the spend: B skipped when A is sure on a short list, then A alone, never past the cap", async () => {
    expect(guardMode(0, null)).toBe("ab");
    expect(guardMode(GUARD_SKIP_B_USD, null)).toBe("skip-b-when-sure");
    expect(guardMode(GUARD_A_ONLY_USD, null)).toBe("a-only");
    expect(guardMode(0.2, 0.2)).toBe("a-only");

    const oneNamed: SegmentRequest = { ...REQUEST, candidates: REQUEST.candidates.filter((candidate) => candidate.idx !== 3), budget: { spentUsd: 0.45, maxCostUsd: 1 } };
    const sure = await run({ a: A, b: B_SAME }, {}, oneNamed);
    expect(sure.calls.map((call) => call.role)).toEqual(["a"]);
    expect(sure.result).toMatchObject({ agreement: "a-only" });
    const unsure = await run({ a: { ...A, confidence: "medium" }, b: B_SAME }, {}, oneNamed);
    expect(unsure.calls.map((call) => call.role)).toEqual(["a", "b"]);
    const twoNamed = await run({ a: A, b: B_SAME }, {}, { ...REQUEST, budget: { spentUsd: 0.45, maxCostUsd: 1 } });
    expect(twoNamed.calls.map((call) => call.role)).toEqual(["a", "b"]);
    const aOnly = await run({ a: A, b: B_SAME }, {}, { ...REQUEST, budget: { spentUsd: 0.7, maxCostUsd: 1 } });
    expect(aOnly.calls.map((call) => call.role)).toEqual(["a"]);
    const capped = await run({ a: A, b: B_OTHER, tie: B_OTHER }, {}, { ...REQUEST, budget: { spentUsd: 0.3, maxCostUsd: 0.3 } });
    expect(capped.calls.map((call) => call.role)).toEqual(["a"]);
  });
});

describe("the ZDR check", () => {
  const list = { data: [{ id: "anthropic/claude-haiku-5.5", name: "Anthropic: Claude Haiku 5.5", endpoints: [{ provider_name: "Anthropic" }] }, { model: { id: "openai/gpt-6-luna" } }] };

  it("reads the slugs out of OpenRouter's list however it is shaped, and allows what it names", () => {
    const models = zdrModelsOf(list);
    expect([...models].sort()).toEqual(["anthropic/claude-haiku-5.5", "openai/gpt-6-luna"]);
    expect(zdrAllows(models, HAIKU_MODEL)).toBe(true);
    expect(zdrAllows(models, "anthropic/claude-sonnet-5.5")).toBe(false);
    expect(zdrAllows(new Set(["openai/gpt-6-luna:extended"]), LUNA_MODEL)).toBe(true);
  });

  it("fails closed: nothing is allowed when the list cannot be read, is empty, or does not name the model", async () => {
    const down = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchZdrModels(down)).toBeNull();
    const empty = (async () => Response.json({ data: [] })) as unknown as typeof fetch;
    expect(await fetchZdrModels(empty)).toBeNull();
    const check = new ZdrCheck({ fetcher: down });
    expect(await check.allows(HAIKU_MODEL)).toBe(false);
    const ok = new ZdrCheck({ fetcher: (async () => Response.json(list)) as unknown as typeof fetch });
    expect(await ok.allows(HAIKU_MODEL)).toBe(true);
    expect(await ok.allows("deepseek/deepseek-v4")).toBe(false);
  });

  it("asks once and remembers, until the hour is up", async () => {
    let fetches = 0;
    let now = 0;
    const fetcher = (async () => {
      fetches += 1;
      return Response.json(list);
    }) as unknown as typeof fetch;
    const check = new ZdrCheck({ fetcher, now: () => now });
    await check.allows(HAIKU_MODEL);
    await check.allows(LUNA_MODEL);
    expect(fetches).toBe(1);
    now += 61 * 60_000;
    await check.allows(HAIKU_MODEL);
    expect(fetches).toBe(2);
  });
});
