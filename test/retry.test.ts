import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isVoid, longestCallMs, REPLAY_MAX_CALL_MS, REPLAY_RATE_LIMIT_PAUSE_MS, REPLAY_RATE_LIMIT_STREAK, runLiveReplay, type ReplayExtract } from "@/lib/livestats/liveReplay";
import { buildManifest } from "@/lib/livestats/manifest";
import { extractStatsPlaysWithRetries } from "@/lib/livestats/openrouter";
import { RETRY_JITTER_MS, RETRY_WAITS_MS, retriesOf, withRetries } from "@/lib/livestats/retry";
import { readReplayLog } from "@/lib/livestats/replayLog";
import { DEFAULT_LIVE_STATS_SETTING } from "@/lib/livestats/settings";
import { NO_USAGE } from "@/lib/livestats/types";
import { ExtractionError } from "@/lib/rosters/extractErrors";
import { chatReply, fakeFetch } from "./fakeOpenRouter";

// =============================================================================
// Retries, the rate-limit pause and the void rule (Oct 26, the second v6
// push, Part A). Made-up names only.
// =============================================================================

const GAME = readReplayLog(JSON.parse(readFileSync(new URL("./fixtures/g5-synthetic-log.json", import.meta.url), "utf8")));
const noJitter = () => 0;

describe("withRetries", () => {
  it("asks again after nothing answered, and answers on the third try, waiting 2 s then 5 s", async () => {
    const waits: number[] = [];
    let tries = 0;
    const result = await withRetries(async () => {
      tries += 1;
      if (tries < 3) throw new ExtractionError("claude_unreachable");
      return "plays";
    }, { perAttemptMs: 1_000, sleep: async (ms) => void waits.push(ms), random: noJitter });
    expect(result).toEqual({ value: "plays", retries: 2 });
    expect(waits).toEqual([RETRY_WAITS_MS[0], RETRY_WAITS_MS[1]]);
  });

  it("retries a timeout and a rate limit, at most three times, and the last failure says how many", async () => {
    const waits: number[] = [];
    const error = await withRetries(async () => {
      throw new ExtractionError("claude_rate_limited");
    }, { perAttemptMs: 1_000, sleep: async (ms) => void waits.push(ms), random: () => 1 }).catch((caught: unknown) => caught);
    expect((error as ExtractionError).code).toBe("claude_rate_limited");
    expect(retriesOf(error)).toBe(3);
    expect(waits).toEqual(RETRY_WAITS_MS.map((wait) => wait + RETRY_JITTER_MS));
  });

  it("never retries a failure that will not change (a refused key, a model missing, a bad request)", async () => {
    for (const code of ["claude_key_rejected", "claude_model_missing", "claude_bad_request"] as const) {
      let tries = 0;
      const error = await withRetries(async () => {
        tries += 1;
        throw new ExtractionError(code);
      }, { perAttemptMs: 1_000, sleep: async () => undefined }).catch((caught: unknown) => caught);
      expect(tries).toBe(1);
      expect(retriesOf(error)).toBe(0);
    }
  });

  it("starts no retry past the deadline", async () => {
    let clock = 0;
    let tries = 0;
    await withRetries(async () => {
      tries += 1;
      clock += 20_000;
      throw new ExtractionError("claude_timeout");
    }, { perAttemptMs: 25_000, deadlineMs: 30_000, now: () => clock, sleep: async (ms) => void (clock += ms), random: noJitter }).catch(() => undefined);
    // 20 s, wait 2 s, 20 s more: the next retry would start past 30 s.
    expect(tries).toBe(2);
  });
});

describe("the retrying wire", () => {
  it("answers through OpenRouter on the third try after two network failures, and says it retried twice", async () => {
    let calls = 0;
    const answer = fakeFetch(() => chatReply({ plays: [], statLines: [] }));
    const flaky: typeof fetch = async (input, init) => {
      calls += 1;
      if (calls <= 2) throw new TypeError("fetch failed");
      return answer(input, init);
    };
    const reply = await extractStatsPlaysWithRetries("test-key", { utterances: [{ seq: 1, text: "wexcombe up the middle", offsetMs: 0 }], rosters: [{ playerId: "H22-WEXCOMBE", side: "home", jersey: "22", first: "Bram", last: "Wexcombe", position: "RB" }], recentPlays: [] }, { fetcher: flaky, setting: DEFAULT_LIVE_STATS_SETTING, sleep: async () => undefined });
    expect(calls).toBe(3);
    expect(reply.retries).toBe(2);
    expect(reply.plays).toEqual([]);
  });
});

describe("the replay with retries, a burst of rate limits and a void run", () => {
  it("counts a retried answer as no failure, and caps a call's time by its attempts", async () => {
    const extract: ReplayExtract = async () => ({ plays: [], statLines: [], usage: NO_USAGE, retries: 2 });
    const result = await runLiveReplay(GAME, { setting: DEFAULT_LIVE_STATS_SETTING, extract });
    expect(result.failures).toBe(0);
    expect(result.retries).toBe(2 * result.calls);
    expect(result.callDetail.every((call) => call.retries === 2)).toBe(true);
    expect(longestCallMs(0)).toBe(REPLAY_MAX_CALL_MS);
    expect(longestCallMs(2)).toBe(3 * REPLAY_MAX_CALL_MS + RETRY_WAITS_MS[0] + RETRY_WAITS_MS[1] + 2 * RETRY_JITTER_MS);
  });

  it("pauses 90 s after 20 rate-limited calls in a row, with the replay's clock standing still", async () => {
    // The made-up game said ten times over, so the loop asks well over 20 times.
    const span = GAME.utterances.at(-1)!.at - GAME.utterances[0].at + 60_000;
    const long = { ...GAME, utterances: Array.from({ length: 10 }, (_, round) => GAME.utterances.map((line) => ({ ...line, at: line.at + round * span, offsetMs: line.offsetMs + round * span }))).flat().map((line, seq) => ({ ...line, seq })) };
    const pauses: number[] = [];
    const extract: ReplayExtract = async () => {
      throw Object.assign(new ExtractionError("claude_rate_limited"), { retries: 3 });
    };
    const lines: string[] = [];
    const result = await runLiveReplay(long, { setting: DEFAULT_LIVE_STATS_SETTING, extract, sleep: async (ms) => void pauses.push(ms), log: (line) => lines.push(line) });
    expect(result.calls).toBeGreaterThan(REPLAY_RATE_LIMIT_STREAK);
    expect(result.rateLimitPauses).toBeGreaterThan(0);
    expect(pauses).toContain(REPLAY_RATE_LIMIT_PAUSE_MS);
    // The pause is real time only: the next call is asked where the clock stood, not 90 s later.
    const before = result.callDetail[REPLAY_RATE_LIMIT_STREAK - 1];
    const after = result.callDetail[REPLAY_RATE_LIMIT_STREAK];
    expect(after.askedAtMs - before.askedAtMs).toBeLessThan(REPLAY_RATE_LIMIT_PAUSE_MS);
    expect(lines.some((line) => line.includes("rate limited: pausing 90 s"))).toBe(true);
    // A free re-run never pauses.
    const again: number[] = [];
    await runLiveReplay(long, { setting: DEFAULT_LIVE_STATS_SETTING, extract, sleep: async (ms) => void again.push(ms), rateLimitPauseMs: 0 });
    expect(again).not.toContain(REPLAY_RATE_LIMIT_PAUSE_MS);
  });

  it("is void when more than 3% of calls failed after their retries, and the manifest says so", () => {
    expect(isVoid({ calls: 100, failures: 3 })).toBe(false);
    expect(isVoid({ calls: 100, failures: 4 })).toBe(true);
    expect(isVoid({ calls: 0, failures: 0 })).toBe(false);
    const manifest = buildManifest({ runId: null, gitSha: "x", now: new Date(0), game: { away: "A", home: "H" }, logName: "log.json", pipeline: "v6", setting: DEFAULT_LIVE_STATS_SETTING, modelB: null, tieBreak: null, reconcile: null, inferRb: false, maxCostUsd: null, halftime: false, calls: [{ index: 1, look: "first", role: "reader", model: "m", promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0, seconds: 1, ok: true, retries: 2 }], latencies: [], plays: { returned: 0, read: 0, applied: 0, discarded: 0 }, counts: { playsApplied: 0, playsUndone: 0, offMidGame: false, tokensIn: 0, tokensOut: 0, tokensCached: 0 }, partial: null, void: true });
    expect(manifest.void).toBe(true);
    expect(manifest.totals.retries).toBe(2);
  });
});
