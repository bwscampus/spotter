import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SegmentRequest } from "@/lib/livestats/extract/request";
import type { SegmentReply } from "@/lib/livestats/extract/run";
import { NOT_A_PLAY } from "@/lib/livestats/extract/schema";
import { runLiveReplay, type LiveReplayResult, type ReplayExtract } from "@/lib/livestats/liveReplay";
import { extractStatsPlaysOpenRouter } from "@/lib/livestats/openrouter";
import { PLAYS_JSON_FORMAT, playsJsonPathProblem, replayPlaysFile } from "@/lib/livestats/playsJson";
import { parseReplayArgs, ReplayArgsError } from "@/lib/livestats/replayArgs";
import { readReplayLog } from "@/lib/livestats/replayLog";
import { DEFAULT_LIVE_STATS_SETTING, DEFAULT_V7_MODEL_A } from "@/lib/livestats/settings";
import { chatReply, fakeFetch } from "./fakeOpenRouter";

// =============================================================================
// `npm run replay:stats -- <log> --plays-json <path>` (lib/livestats/playsJson.ts):
// every play as the live replay left it, on the made-up G5 log with a fake
// OpenRouter. Nothing is sent and nothing is written to disk.
// =============================================================================

const RAW = JSON.parse(readFileSync(new URL("./fixtures/g5-synthetic-log.json", import.meta.url), "utf8"));
const GAME = readReplayLog(RAW);
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

type Body = { messages: Array<{ content: unknown }> };

/** Fennimore's run on lines 1 and 2: first read with no yards and a tackler nobody has, every later read with 6 yards. */
function run(yards: number | null, extra: Array<{ playerId: string; action: string }>) {
  return {
    seqStart: 1,
    seqEnd: 2,
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
    summary: "FENNIMORE run up the middle",
    evidence: "fennimore up the middle for six brought down by quillon",
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: { on: "none", noPlay: false, beforeSnap: false },
    events: [
      { playerId: "H22-FENNIMORE", action: "rush", yards, yardsSource: yards === null ? null : "stated", made: null },
      ...extra.map((event) => ({ ...event, yards: null, yardsSource: null, made: null })),
    ],
  };
}

function wire() {
  let reads = 0;
  const fetcher = fakeFetch<Body>((body) => {
    const content = typeof body.messages[1].content === "string" ? body.messages[1].content : JSON.stringify(body.messages[1].content);
    const seqs = [...content.matchAll(/^(\d+)\t/gm)].map((match) => Number(match[1]));
    if (!seqs.includes(2)) return chatReply({ plays: [], statLines: [] });
    reads += 1;
    const play = reads === 1 ? run(null, [{ playerId: "A99-NOBODY", action: "tackle" }]) : run(6, []);
    return chatReply({ plays: [play], statLines: [] });
  });
  const extract: ReplayExtract = (request, setting) => extractStatsPlaysOpenRouter("test-key", request, new AbortController().signal, fetcher, setting);
  return { extract, reads: () => reads };
}

describe("--plays-json: every play as the replay finally left it", () => {
  it("writes the session's final plays in the stats_play shape, with when each was first returned", async () => {
    const { extract, reads } = wire();
    const result = await runLiveReplay(GAME, { setting: DEFAULT_LIVE_STATS_SETTING, extract });
    const file = replayPlaysFile(result, GAME);

    expect(file.format).toBe(PLAYS_JSON_FORMAT);
    expect(file.reader).toBe("Gemini 3.8 Flash minimal");
    expect(file.game).toBe("Millbrook at Harborview");
    // One play, however many reads returned it: dedupe and updates are already in.
    expect(reads()).toBeGreaterThan(1);
    expect(file.plays).toHaveLength(result.session.plays.length);
    const fennimore = file.plays.filter((entry) => entry.play.seqStart === 1 && entry.play.seqEnd === 2);
    expect(fennimore).toHaveLength(1);
    const [entry] = fennimore;

    // The final state is the session's own play, changes and notes.
    const final = result.session.plays.find((play) => play.playId === entry.playId)!;
    expect(entry.play).toEqual(final.play);
    expect(entry.changes).toEqual(final.changes);
    expect(entry.dropped).toEqual(final.dropped);
    expect(entry.status).toBe("applied");
    expect(entry.changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_att", amount: 1, estimated: false });

    // The tackler nobody has was dropped by the stat rules, and says so.
    expect(entry.dropped.some((drop) => drop.playerId === "A99-NOBODY" && drop.rule === "R9")).toBe(true);

    // `at` is the first stats_play record's time: after the line that ended the play, on the log's clock.
    expect(entry.at).toBe(result.firstReturnedAt.get(entry.playId));
    expect(entry.at).toBeGreaterThanOrEqual(GAME.utterances[2].at);

    // Plain JSON all the way down: what the script writes reads back the same.
    expect(JSON.parse(JSON.stringify(file))).toEqual(file);
  });

  it("takes the yards a later read gave the same play", async () => {
    const { extract } = wire();
    const result = await runLiveReplay(GAME, { setting: DEFAULT_LIVE_STATS_SETTING, extract });
    const entry = replayPlaysFile(result, GAME).plays.find((each) => each.play.seqStart === 1)!;
    expect(entry.changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 6, estimated: false });
  });
});

describe("--plays-json: the flag", () => {
  it("is off unless asked for, so the replay writes nothing by default", () => {
    expect(parseReplayArgs(["log.json"]).playsJson).toBeNull();
    expect(parseReplayArgs(["log.json", "--plays-json", "/tmp/plays.json"]).playsJson).toBe("/tmp/plays.json");
    expect(parseReplayArgs(["log.json", "--plays-json=/tmp/p.json"]).playsJson).toBe("/tmp/p.json");
  });

  it("goes with a live replay, or a dry one under v7, and needs a path", () => {
    for (const mode of ["--dry", "--recorded", "--compare"]) {
      expect(() => parseReplayArgs(["log.json", mode, "--plays-json", "/tmp/plays.json"])).toThrow(ReplayArgsError);
    }
    expect(parseReplayArgs(["log.json", "--pipeline", "v7", "--dry", "--plays-json", "/tmp/plays.json"])).toMatchObject({ mode: "dry", pipeline: "v7", playsJson: "/tmp/plays.json" });
    expect(() => parseReplayArgs(["log.json", "--pipeline", "v7", "--compare", "--plays-json", "/tmp/plays.json"])).toThrow(ReplayArgsError);
    expect(() => parseReplayArgs(["log.json", "--plays-json"])).toThrow(/needs a value/);
    expect(() => parseReplayArgs(["log.json", "--plays-json="])).toThrow(/needs a path/);
  });

  it("refuses a path inside this repository, and nowhere else", () => {
    expect(playsJsonPathProblem(path.join(REPO_ROOT, "plays.json"), REPO_ROOT)).toMatch(/inside this repository/);
    expect(playsJsonPathProblem(path.join(REPO_ROOT, "test", "fixtures", "plays.json"), REPO_ROOT)).toMatch(/inside this repository/);
    expect(playsJsonPathProblem(path.join(os.homedir(), "SpotterTestSet", "plays.json"), REPO_ROOT)).toBeNull();
    // A sibling folder whose name starts the same is not inside.
    expect(playsJsonPathProblem(`${REPO_ROOT}-test-set/plays.json`, REPO_ROOT)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// v7 (fix 1, Part 0): the replay on the transcript's own clock, every request
// recorded as sent, and a run that stops short written as partial.
// -----------------------------------------------------------------------------

/** A fake segment route: Fennimore's run is a rush, everything else not a play; each call costs `cost` and takes `took` ms on the replay's clock. */
function segmentWire(options: { took?: number; cost?: number } = {}) {
  const requests: SegmentRequest[] = [];
  let clock = 0;
  const extractSegment = async (request: SegmentRequest): Promise<SegmentReply> => {
    requests.push(request);
    clock += options.took ?? 0;
    const text = request.segment.lines.filter((line) => line.role === "play").map((line) => line.text).join(" ");
    const idx = (id: string) => request.candidates.find((candidate) => candidate.playerId === id)?.idx ?? 0;
    const answer = text.includes("fennimore up the middle") ? { ...NOT_A_PLAY, playType: "rush" as const, carrierIdx: idx("H22-FENNIMORE"), yardsSaid: 6, confidence: "high" as const } : { ...NOT_A_PLAY, confidence: "high" as const };
    return { ok: true, answer, agreement: "agree", answers: { a: answer, b: null, tieBreak: null }, usedB: false, calls: [{ model: DEFAULT_V7_MODEL_A.model, role: "a", promptTokens: 100, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 20, reasoningTokens: 0, costUsd: options.cost ?? 0.001, seconds: (options.took ?? 0) / 1000, ok: true }] };
  };
  // The real clock the replay times each call by: it moves only inside a call.
  return { extractSegment, requests, now: () => clock };
}

const segmentsOf = (result: LiveReplayResult) => result.segments.map((segment) => `${segment.lineStart}-${segment.lineEnd}:${segment.closedBy}`);

describe("--pipeline v7: the replay", () => {
  it("cuts the same segments whether a read takes no time or fifteen seconds, and lands a slow reply after the lines said meanwhile", async () => {
    const instant = segmentWire();
    const slow = segmentWire({ took: 15_000 });
    const fast = await runLiveReplay(GAME, { setting: DEFAULT_V7_MODEL_A, extract: async () => ({ plays: [], usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 } }), pipeline: "v7", extractSegment: instant.extractSegment, now: instant.now });
    const late = await runLiveReplay(GAME, { setting: DEFAULT_V7_MODEL_A, extract: async () => ({ plays: [], usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 } }), pipeline: "v7", extractSegment: slow.extractSegment, now: slow.now });
    expect(fast.segments.length).toBeGreaterThan(2);
    expect(segmentsOf(late)).toEqual(segmentsOf(fast));
    expect(late.calls).toBe(fast.calls);
    expect(fast.calls).toBe(instant.requests.length);
    // The same play either way, applied about fifteen seconds later when the read was slow.
    expect(late.session.plays.map((play) => play.playId)).toEqual(fast.session.plays.map((play) => play.playId));
    expect(fast.session.plays).toHaveLength(1);
    expect(late.latencies[0] - fast.latencies[0]).toBeGreaterThanOrEqual(14);
  });

  it("records every request exactly as it was sent, with each reader's answer and the play it became", async () => {
    const wire = segmentWire();
    const result = await runLiveReplay(GAME, { setting: DEFAULT_V7_MODEL_A, extract: async () => ({ plays: [], usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 } }), pipeline: "v7", extractSegment: wire.extractSegment, now: wire.now });
    expect(result.segmentDetail).toHaveLength(wire.requests.length);
    result.segmentDetail.forEach((detail, index) => {
      const request = wire.requests[index];
      expect(detail.segmentId).toBe(request.segment.id);
      expect(detail.look).toBe(request.look);
      expect(detail.lines).toEqual(request.segment.lines);
      expect(detail.candidates).toEqual(request.candidates.map(({ idx, playerId, label, score, tags }) => ({ idx, playerId, label, score, tags })));
      expect(detail.gameState.offense).toBe(request.gameState.offense);
      expect(detail.reconciled).not.toBeNull();
      expect(detail.answers?.a).toEqual(detail.reconciled);
    });
    const run = result.segmentDetail.find((detail) => detail.reconciled?.playType === "rush")!;
    expect(run.playId).toBe(result.session.plays[0].playId);
    const file = replayPlaysFile(result, GAME);
    expect(file.segmentDetail).toHaveLength(result.segmentDetail.length);
    expect(file.partial).toBeUndefined();
  });

  it("stops where it is at the cost cap, and the file says it is partial", async () => {
    const wire = segmentWire({ cost: 0.6 });
    let peek: (() => LiveReplayResult) | null = null;
    const result = await runLiveReplay(GAME, { setting: DEFAULT_V7_MODEL_A, extract: async () => ({ plays: [], usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 } }), pipeline: "v7", extractSegment: wire.extractSegment, now: wire.now, hardCapUsd: 1, onStart: (snapshot) => (peek = snapshot) });
    expect(result.stoppedBy).toBe("max_cost");
    expect(wire.requests).toHaveLength(2);
    expect(peek).not.toBeNull();
    // The read the cap stopped is in the record as not sent.
    expect(peek!().segmentDetail.map((detail) => detail.failed)).toEqual([null, null, "max_cost"]);
    const file = replayPlaysFile(result, GAME, { stoppedBy: "max_cost" });
    expect(file).toMatchObject({ partial: true, stoppedBy: "max_cost" });
  });
});
