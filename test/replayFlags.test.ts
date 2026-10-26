import { describe, expect, it } from "vitest";
import { buildManifest, manifestPathFor, percentile, summarizeLatency } from "@/lib/livestats/manifest";
import { parseReplayArgs, ReplayArgsError } from "@/lib/livestats/replayArgs";
import { DEFAULT_LIVE_STATS_SETTING, DEFAULT_V7_MODEL_A, DEFAULT_V7_MODEL_B, HAIKU_MODEL, LUNA_MODEL, liveStatsPipeline, v7Settings } from "@/lib/livestats/settings";
import { NO_STATS_COUNTS } from "@/lib/game/statsBridge";

// The replay harness's v7 flags (Part 0), the pipeline setting, and the run manifest.

describe("the v7 flags", () => {
  it("default to v6, with nothing of v7's set", () => {
    const args = parseReplayArgs(["game.json"]);
    expect(args).toMatchObject({ pipeline: "v6", modelB: undefined, reconcile: "ab", inferRb: false, runId: null, maxCostUsd: null, setting: DEFAULT_LIVE_STATS_SETTING });
  });

  it("read --pipeline v7 with its own default readers", () => {
    const args = parseReplayArgs(["game.json", "--pipeline", "v7"]);
    expect(args.pipeline).toBe("v7");
    expect(args.setting).toEqual(DEFAULT_V7_MODEL_A);
    expect(args.modelB).toBeUndefined();
    expect(parseReplayArgs(["game.json", "--pipeline=v7", "--model", HAIKU_MODEL, "--effort", "none"]).setting).toEqual({ model: HAIKU_MODEL, effort: "none" });
    expect(parseReplayArgs(["game.json", "--pipeline", "v7", "--model", "openai/gpt-6-luna", "--effort", "low"]).setting).toEqual({ model: LUNA_MODEL, effort: "low" });
  });

  it("read reader B, off, the reconcile mode and the running-back prior", () => {
    expect(parseReplayArgs(["g.json", "--pipeline", "v7", "--model-b", "openai/gpt-6-luna", "--effort-b", "low"]).modelB).toEqual(DEFAULT_V7_MODEL_B);
    expect(parseReplayArgs(["g.json", "--pipeline", "v7", "--model-b", "off"]).modelB).toBeNull();
    expect(parseReplayArgs(["g.json", "--pipeline", "v7", "--reconcile", "aa"]).reconcile).toBe("aa");
    expect(parseReplayArgs(["g.json", "--pipeline", "v7", "--reconcile", "a"]).modelB).toBeNull();
    expect(parseReplayArgs(["g.json", "--pipeline", "v7", "--infer-rb"]).inferRb).toBe(true);
  });

  it("read --run-id and --max-cost", () => {
    const args = parseReplayArgs(["g.json", "--run-id", "P0-baseline", "--max-cost", "0.50"]);
    expect(args.runId).toBe("P0-baseline");
    expect(args.maxCostUsd).toBe(0.5);
    expect(parseReplayArgs(["g.json", "--max-cost=$1.25"]).maxCostUsd).toBe(1.25);
  });

  it("refuse what cannot be run", () => {
    expect(() => parseReplayArgs(["g.json", "--pipeline", "v8"])).toThrow(ReplayArgsError);
    expect(() => parseReplayArgs(["g.json", "--model-b", "off"])).toThrow(/add --pipeline v7/);
    expect(() => parseReplayArgs(["g.json", "--pipeline", "v7", "--recorded"])).toThrow(/add --answers/);
    expect(() => parseReplayArgs(["g.json", "--pipeline", "v7", "--compare"])).toThrow(/--compare runs v6/);
    expect(() => parseReplayArgs(["g.json", "--pipeline", "v7", "--model-b", "openai/gpt-9"])).toThrow(/not an allowed setting for reader B/);
    expect(() => parseReplayArgs(["g.json", "--pipeline", "v7", "--model-b", "off", "--effort-b", "low"])).toThrow(/no reader/);
    expect(() => parseReplayArgs(["g.json", "--pipeline", "v7", "--reconcile", "abc"])).toThrow(/--reconcile takes/);
    expect(() => parseReplayArgs(["g.json", "--max-cost", "free"])).toThrow(/--max-cost takes dollars/);
    expect(() => parseReplayArgs(["g.json", "--max-cost", "0"])).toThrow(/--max-cost takes dollars/);
    expect(() => parseReplayArgs(["g.json", "--run-id", "runs/x"])).toThrow(/a name, not a path/);
  });
});

describe("the pipeline setting", () => {
  it("is v6 unless LIVE_STATS_PIPELINE says v7", () => {
    expect(liveStatsPipeline({})).toBe("v6");
    expect(liveStatsPipeline({ LIVE_STATS_PIPELINE: "v7" })).toBe("v7");
    expect(liveStatsPipeline({ LIVE_STATS_PIPELINE: "v9" })).toBe("v6");
  });

  it("reads v7's own settings from the environment, with safe defaults", () => {
    expect(v7Settings({})).toMatchObject({ modelA: DEFAULT_V7_MODEL_A, modelB: DEFAULT_V7_MODEL_B, reconcile: "ab", allowInferredRb: false, maxCostUsd: 1 });
    expect(v7Settings({ LIVE_STATS_MODEL_B: "off" }).modelB).toBeNull();
    expect(v7Settings({ LIVE_STATS_RECONCILE: "a" }).modelB).toBeNull();
    expect(v7Settings({ LIVE_STATS_INFER_RB: "1" }).allowInferredRb).toBe(true);
    expect(v7Settings({ LIVE_STATS_MAX_COST_USD: "0.40" }).maxCostUsd).toBe(0.4);
    expect(v7Settings({ LIVE_STATS_MAX_COST_USD: "lots" }).maxCostUsd).toBe(1);
    expect(v7Settings({ LIVE_STATS_MODEL: "anthropic/claude-haiku-5.5", LIVE_STATS_EFFORT: "none" }).modelA).toEqual({ model: HAIKU_MODEL, effort: "none" });
    expect(v7Settings({ LIVE_STATS_TIE_BREAK_EFFORT: "low" }).tieBreak).toEqual({ model: HAIKU_MODEL, effort: "low" });
  });
});

describe("the run manifest", () => {
  it("takes nearest-rank percentiles", () => {
    expect(percentile([], 0.5)).toBe(0);
    expect(percentile([5], 0.95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(summarizeLatency([3, 1, 2])).toEqual({ count: 3, p50: 2, p95: 3, max: 3 });
  });

  it("adds the calls up and names nothing but the game and the log file", () => {
    const manifest = buildManifest({
      runId: "P0-baseline",
      gitSha: "abc123",
      now: new Date("2026-10-20T12:00:00Z"),
      game: { away: "Millbrook", home: "Harborview" },
      logName: "2026-10-10-millbrook-at-harborview.json",
      pipeline: "v7",
      setting: DEFAULT_V7_MODEL_A,
      modelB: DEFAULT_V7_MODEL_B,
      tieBreak: { model: HAIKU_MODEL, effort: "medium" },
      reconcile: "ab",
      inferRb: false,
      maxCostUsd: 1,
      halftime: false,
      calls: [
        { index: 1, look: "segment", role: "a", model: HAIKU_MODEL, promptTokens: 100, cachedTokens: 2_000, cacheWriteTokens: 0, completionTokens: 50, reasoningTokens: 10, costUsd: 0.0001, seconds: 2.5, ok: true, segmentId: "s1" },
        { index: 2, look: "segment", role: "b", model: LUNA_MODEL, promptTokens: 100, cachedTokens: 2_000, cacheWriteTokens: 0, completionTokens: 40, reasoningTokens: 0, costUsd: 0.0001, seconds: 3, ok: true, segmentId: "s1" },
        { index: 3, look: "segment", role: "a", model: HAIKU_MODEL, promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0, seconds: 12, ok: false, segmentId: "s2" },
      ],
      latencies: [8, 12, 30],
      plays: { returned: 2, read: 2, applied: 2, discarded: 0 },
      counts: NO_STATS_COUNTS,
    });
    expect(manifest.format).toBe("spotter-replay-manifest");
    expect(manifest.totals).toEqual({ promptTokens: 200, cachedTokens: 4_000, cacheWriteTokens: 0, completionTokens: 90, reasoningTokens: 10, costUsd: 0.0002, calls: 3, failed: 1, retries: 0 });
    expect(manifest.latency).toEqual({ count: 3, p50: 12, p95: 30, max: 30 });
    expect(manifest.flags).toMatchObject({ model: HAIKU_MODEL, effort: "low", modelB: LUNA_MODEL, effortB: "low", reconcile: "ab" });
    expect(JSON.stringify(manifest)).not.toMatch(/fennimore|castellane/i);
    expect(manifestPathFor("/x/runs/P0/game.json")).toBe("/x/runs/P0/game.manifest.json");
  });
});
