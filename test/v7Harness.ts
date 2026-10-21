import type { EventName, EventProps } from "@/lib/analytics/events";
import type { StatsChange } from "@/lib/game/statsBridge";
import { StatsController, type SegmentReply } from "@/lib/livestats/controller";
import type { SegmentRequest } from "@/lib/livestats/extract/request";
import { NOT_A_PLAY, type ExtractAnswer } from "@/lib/livestats/extract/schema";
import type { StatsRecord } from "@/lib/log/statsLog";
import { ROSTER, TEAMS } from "./parse/roster";

// A v7 loop with everything faked (the segment route, the log, analytics,
// the clock), for test/v7Pipeline.test.ts and test/reread.test.ts. The route
// is a function of the request: the test says what each segment is answered.

export const START = 1_800_000_000_000;

export type Answerer = (request: SegmentRequest) => ExtractAnswer | "fail" | SegmentReply;

/** The candidate index of a player in a request, or 0 when he is not on the list. */
export function idxOf(request: SegmentRequest, playerId: string): number {
  return request.candidates.find((candidate) => candidate.playerId === playerId)?.idx ?? 0;
}

/** The play's own lines, joined, so an answerer can read what the segment said. */
export function playText(request: SegmentRequest): string {
  return request.segment.lines.filter((line) => line.role === "play").map((line) => line.text).join(" ");
}

export const answer = (extra: Partial<ExtractAnswer>): ExtractAnswer => ({ ...NOT_A_PLAY, confidence: "high", ...extra });

export function v7Harness(options: { answerer?: Answerer; log?: readonly { kind: string }[]; autoOk?: boolean; maxCostUsd?: number | null; allowInferredRb?: boolean; costPerCall?: number; roster?: typeof ROSTER; recordDetail?: boolean } = {}) {
  let now = START;
  const requests: SegmentRequest[] = [];
  const logged: StatsRecord[] = [];
  const tracked: Array<{ name: EventName; props: EventProps }> = [];
  const changes: StatsChange[] = [];
  let answerer: Answerer = options.answerer ?? (() => NOT_A_PLAY);
  const cost = options.costPerCall ?? 0.0004;

  const controller = new StatsController({
    gameId: "game-v7",
    startedAt: START,
    roster: options.roster ?? ROSTER,
    teams: TEAMS,
    autoOk: options.autoOk ?? true,
    pipeline: "v7",
    maxCostUsd: options.maxCostUsd ?? null,
    allowInferredRb: options.allowInferredRb ?? false,
    recordDetail: options.recordDetail ?? false,
    deps: {
      extract: async () => ({ ok: false, code: "v6_not_used" }),
      extractSegment: async (request) => {
        requests.push(request);
        const reply = answerer(request);
        if (reply === "fail") return { ok: false, code: "claude_timeout" };
        if ("playType" in reply) {
          return {
            ok: true,
            answer: reply,
            agreement: "agree",
            calls: [{ model: "anthropic/claude-haiku-5.5", role: "a", promptTokens: 100, cachedTokens: 2_500, cacheWriteTokens: 0, completionTokens: 40, reasoningTokens: 10, costUsd: cost, seconds: 1, ok: true }],
            usedB: false,
          };
        }
        return reply;
      },
      log: (record) => logged.push(record),
      readLog: async () => options.log ?? [],
      track: (name, props) => tracked.push({ name, props }),
      now: () => now,
    },
  });
  controller.bridge.subscribe((change) => changes.push(change));

  return {
    controller,
    requests,
    logged,
    tracked,
    changes,
    setAnswerer(next: Answerer) {
      answerer = next;
    },
    /** Something was said, `ms` after the last thing. */
    say(text: string, ms = 2_000) {
      now += ms;
      controller.heard(text, now);
    },
    /** The live screen's two-second timer, for `ms`. */
    async wait(ms: number) {
      const until = now + ms;
      while (now < until) {
        now = Math.min(until, now + 2_000);
        controller.tick();
        await controller.idle();
      }
    },
    async settle() {
      await controller.idle();
    },
    get now() {
      return now;
    },
  };
}

export async function started(options?: Parameters<typeof v7Harness>[0]) {
  const h = v7Harness(options);
  await h.controller.start();
  return h;
}
