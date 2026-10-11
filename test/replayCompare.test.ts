import fs from "node:fs";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compactLine,
  estimateCost,
  loggedTokens,
  median,
  playerTable,
  runComparison,
  runLiveReplay,
  summaryTable,
  type ReplayExtract,
} from "@/lib/livestats/liveReplay";
import { extractStatsPlaysOpenRouter } from "@/lib/livestats/openrouter";
import { readReplayLog } from "@/lib/livestats/replayLog";
import { allSettings, DEFAULT_LIVE_STATS_SETTING } from "@/lib/livestats/settings";
import { NO_USAGE } from "@/lib/livestats/types";
import { chatReply, fakeFetch } from "./fakeOpenRouter";

// =============================================================================
// The live replay and the three-way comparison (lib/livestats/liveReplay.ts),
// on the made-up G5 log, with a fake OpenRouter. Nothing is sent, and nothing
// is written to disk.
// =============================================================================

const RAW = JSON.parse(readFileSync(new URL("./fixtures/g5-synthetic-log.json", import.meta.url), "utf8")) as { records: Array<{ kind: string }> };
const GAME = readReplayLog(RAW);

type Body = { model: string; reasoning: { effort: string }; messages: Array<{ content: unknown }> };

/** A fake wire: every call is recorded; the first one credits Fennimore with a carry, written with extra words. */
function wire() {
  const sent: Array<{ model: string; effort: string }> = [];
  const fetcher = fakeFetch<Body>((body) => {
    sent.push({ model: body.model, effort: body.reasoning.effort });
    const content = body.messages[1].content as string;
    const seqs = [...content.matchAll(/^(\d+)\t/gm)].map((match) => Number(match[1]));
    const last = Math.max(...seqs);
    const first = sent.filter((each) => each.model === body.model && each.effort === body.reasoning.effort).length === 1;
    const plays = first
      ? [
          {
            seqStart: last,
            seqEnd: last,
            quarter: 1,
            clock: null,
            down: 1,
            distance: 10,
            offense: "home",
            playType: "run",
            nullified: false,
            touchdown: false,
            firstDown: false,
            confidence: 0.9,
            summary: "FENNIMORE run for 6",
            evidence: "fennimore up the middle for six",
            updates: "",
            startSpot: null,
            endSpot: null,
            shortBy: null,
            score: null,
            penalty: { on: "none", noPlay: false, beforeSnap: false },
            events: [{ playerId: "H22-FENNIMORE Reed RB", action: "rush", yards: 6, yardsSource: "stated", made: null }],
          },
        ]
      : [];
    return chatReply({ plays }, { prompt_tokens: 1000, completion_tokens: 50, cost: 0.001 });
  });
  const extract: ReplayExtract = (request, setting) => extractStatsPlaysOpenRouter("test-key", request, new AbortController().signal, fetcher, setting);
  return { sent, extract };
}

afterEach(() => vi.restoreAllMocks());

describe("a live replay", () => {
  it("reads replies in through readPlays, so the id match and the rules apply", async () => {
    const { sent, extract } = wire();
    const result = await runLiveReplay(GAME, { setting: DEFAULT_LIVE_STATS_SETTING, extract });
    expect(result.calls).toBeGreaterThan(0);
    expect(sent).toHaveLength(result.calls);
    expect(result.playsReturned).toBe(1);
    expect(result.emptyCalls).toBe(result.calls - 1);
    expect(result.usage.costUsd).toBeCloseTo(0.001 * result.calls, 6);
    expect(result.totals.get("H22-FENNIMORE")?.stats).toMatchObject({ rush_att: 1, rush_yds: 6 });
    expect(result.plays[0].dropped).toContainEqual(expect.objectContaining({ rule: "R33", to: "H22-FENNIMORE" }));
    expect(result.seconds).toHaveLength(result.calls);
  });

  it("counts a call that throws as failed, and goes on", async () => {
    const result = await runLiveReplay(GAME, {
      setting: DEFAULT_LIVE_STATS_SETTING,
      extract: async () => {
        throw new Error("claude_timeout");
      },
    });
    expect(result.failures).toBe(result.calls);
    expect(result.plays).toEqual([]);
  });
});

describe("the comparison", () => {
  it("runs each allowed setting exactly once, one after another, and writes nothing to disk", async () => {
    const writes = [
      vi.spyOn(fs, "writeFileSync"),
      vi.spyOn(fs, "appendFileSync"),
      vi.spyOn(fs.promises, "writeFile"),
      vi.spyOn(fs.promises, "appendFile"),
    ];
    const { sent, extract } = wire();
    const results = await runComparison(GAME, allSettings(), { extract });
    expect(results.map((result) => result.setting)).toEqual(allSettings());
    const calls = results[0].calls;
    expect(results.every((result) => result.calls === calls)).toBe(true);
    // Every call of a setting before any call of the next.
    const order = sent.map((each) => `${each.model} ${each.effort}`);
    expect(order).toEqual(allSettings().flatMap((setting) => Array<string>(calls).fill(`${setting.model} ${setting.effort}`)));
    for (const result of results) expect(result.totals.get("H22-FENNIMORE")?.stats.rush_att).toBe(1);
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();

    const summary = summaryTable(results);
    expect(summary).toContain("Haiku 5.5 low");
    expect(summary).toContain("Haiku 5.5 medium");
    expect(summary).toContain("Gemini 3.8 Flash minimal");
    expect(summary).toMatch(/Calls with no plays/);
    expect(summary).toMatch(/Median s a call/);
    expect(playerTable(results)).toMatch(/FENNIMORE #22 \(H\)\s+1car 6ry\s+1car 6ry\s+1car 6ry/);
  });

  it("the replay code never touches the file system", () => {
    const source = readFileSync(new URL("../lib/livestats/liveReplay.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/node:fs|from "fs"/);
  });

  it("estimates the cost from the log's own token counts before spending anything", () => {
    const records = [
      { kind: "stats_reply", ok: true, tokensIn: 1_000_000, tokensOut: 100_000, tokensCached: 900_000 },
      { kind: "stats_reply", ok: false, code: "claude_timeout" },
    ];
    const tokens = loggedTokens(records);
    expect(tokens).toEqual({ calls: 1, tokensIn: 1_000_000, tokensOut: 100_000, tokensCached: 900_000 });
    const [gemini, low, medium] = allSettings().map((setting) => estimateCost(tokens, setting));
    expect(low).toBeCloseTo(0.1 * 0.1 + 0.9 * 0.01 + 0.1 * 0.5, 6);
    expect(medium).toBeGreaterThan(low);
    expect(gemini).toBeCloseTo(0.1 * 0.75 + 0.9 * 0.075 + 0.1 * 3.75, 6);
  });

  it("says a player's night in one cell, and takes a median", () => {
    expect(compactLine({ stats: { pass_cmp: 14, pass_att: 18, pass_yds: 158, pass_td: 1, rush_att: 4, rush_yds: -1 }, estimated: [] } as never)).toBe(
      "14/18 158py 1ptd · 4car -1ry",
    );
    expect(compactLine(undefined)).toBe("");
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(NO_USAGE.costUsd).toBe(0);
  });
});
