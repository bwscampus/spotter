import type { ChatOutcome, ChatRequest, ReasoningEffort } from "@/lib/ai/openrouter";
import { ExtractionError } from "@/lib/rosters/extractErrors";
import { callUsageFromOpenRouter, NO_CALL_USAGE, type CallUsage } from "../prices";
import type { LiveStatsSetting } from "../settings";
import { renderExamples } from "./examples";
import { EXTRACT_SYSTEM_PROMPT } from "./prompt";
import { renderSegmentUser, type SegmentRequest } from "./request";
import { EXTRACT_SCHEMA, validateAnswer, type ExtractAnswer } from "./schema";

// =============================================================================
// One extractor call (v7, Part 5): the cached prefix (the system prompt and
// the worked examples, byte-identical all game), the segment as the user
// message, the strict schema, max_tokens 1500, a 12 s budget, one retry when
// the answer does not read, and the usage recorded. The wire is handed in
// (lib/livestats/openrouter.ts's chat, through lib/ai/openrouter.ts, with the
// privacy routing on every request), so a test runs it with a fake and the
// non-negotiable holds: every model call goes through that one file.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

export const EXTRACT_MAX_TOKENS = 1_500;
export const EXTRACT_TIMEOUT_MS = 12_000;
/** Retries after an answer that does not read as the schema (never after a transport failure). */
export const EXTRACT_RETRIES = 1;

// =============================================================================

export type CallRole = "a" | "b" | "tie";

/** The usage of one of the route's calls, as the reply carries it back to the browser and the harness. */
export interface SegmentCallUsage extends CallUsage {
  role: CallRole | "halftime";
  seconds: number;
  ok: boolean;
}

export interface ExtractCall {
  role: CallRole;
  model: string;
  effort: ReasoningEffort;
  /** Null when the call failed or its answer never read. */
  answer: ExtractAnswer | null;
  usage: CallUsage;
  seconds: number;
  ok: boolean;
  code?: string;
  retried: boolean;
}

/** Each reader's own answer, before the reconcile step made one of them (null for a reader not asked, or not read). */
export interface ReaderAnswers {
  a: ExtractAnswer | null;
  b: ExtractAnswer | null;
  tieBreak: ExtractAnswer | null;
}

/**
 * What POST /api/livestats/segment returns (and the harness's segment wire).
 * `answers` is the harness's (the plays file's segmentDetail): the route takes
 * it off before replying, so the browser is sent what it always was.
 */
export type SegmentReply =
  | { ok: true; answer: ExtractAnswer; agreement: string; calls: SegmentCallUsage[]; usedB: boolean; answers?: ReaderAnswers }
  | { ok: false; code: string };

/** The wire: lib/ai/openrouter.ts's chat with the key and fetch bound, so this file never sees the key. */
export type SegmentWire = (request: ChatRequest, signal: AbortSignal) => Promise<ChatOutcome>;

/** The cached prefix: the prompt and the examples, one text part with the cache breakpoint on it. */
export function cachedPrefix(): string {
  return `${EXTRACT_SYSTEM_PROMPT}\n\n${renderExamples()}`;
}

/**
 * The chat request for a segment. `readers`, on the tie-break, are the two
 * answers as "Reader 1" and "Reader 2" (never the models' names).
 */
export function segmentChatRequest(request: SegmentRequest, setting: LiveStatsSetting, readers?: readonly [ExtractAnswer, ExtractAnswer]): ChatRequest {
  let content = renderSegmentUser(request);
  if (readers) {
    content += `\n\nTWO READERS DISAGREE\nReader 1: ${JSON.stringify(readers[0])}\nReader 2: ${JSON.stringify(readers[1])}\nDecide from the lines. Your answer should match one of them unless both are wrong.`;
  }
  return {
    model: setting.model,
    system: [{ type: "text", text: cachedPrefix(), cache_control: { type: "ephemeral" } }],
    content,
    schema: EXTRACT_SCHEMA,
    schemaName: "play",
    maxTokens: EXTRACT_MAX_TOKENS,
    reasoning: setting.effort,
  };
}

export interface CallOptions {
  readers?: readonly [ExtractAnswer, ExtractAnswer];
  now?: () => number;
  timeoutMs?: number;
  /** The signal that abandons the whole segment (End game). */
  signal?: AbortSignal;
}

/**
 * One extractor call through the wire: the answer, or why not. A transport
 * failure or a refusal is its code; an answer that does not read (not JSON,
 * or off the schema's values) is tried once more, and a second such answer
 * is "bad_response". Never throws.
 */
export async function callExtractor(wire: SegmentWire, setting: LiveStatsSetting, request: SegmentRequest, role: CallRole, options: CallOptions = {}): Promise<ExtractCall> {
  const now = options.now ?? Date.now;
  const started = now();
  const chatRequest = segmentChatRequest(request, setting, options.readers);
  const most = Math.max(0, ...request.candidates.map((candidate) => candidate.idx));
  let usage: CallUsage = { model: setting.model, ...NO_CALL_USAGE };
  let retried = false;
  for (let attempt = 0; attempt <= EXTRACT_RETRIES; attempt++) {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? EXTRACT_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    let outcome: ChatOutcome;
    try {
      outcome = await wire(chatRequest, signal);
    } catch (error) {
      const code = error instanceof ExtractionError ? error.code : "unknown";
      return { role, model: setting.model, effort: setting.effort, answer: null, usage, seconds: (now() - started) / 1000, ok: false, code, retried };
    }
    const made = callUsageFromOpenRouter(outcome.usage, setting.model);
    usage = { model: setting.model, promptTokens: usage.promptTokens + made.promptTokens, cachedTokens: usage.cachedTokens + made.cachedTokens, cacheWriteTokens: usage.cacheWriteTokens + made.cacheWriteTokens, completionTokens: usage.completionTokens + made.completionTokens, reasoningTokens: usage.reasoningTokens + made.reasoningTokens, costUsd: Math.round((usage.costUsd + made.costUsd) * 1e6) / 1e6 };
    if (outcome.kind === "text") {
      let raw: unknown = null;
      try {
        raw = JSON.parse(outcome.text);
      } catch {
        raw = null;
      }
      const answer = raw === null ? null : validateAnswer(raw, most);
      if (answer) return { role, model: setting.model, effort: setting.effort, answer, usage, seconds: (now() - started) / 1000, ok: true, retried };
    }
    retried = attempt < EXTRACT_RETRIES;
  }
  return { role, model: setting.model, effort: setting.effort, answer: null, usage, seconds: (now() - started) / 1000, ok: false, code: "bad_response", retried: true };
}

/** An ExtractCall as the reply carries it. */
export function callUsageOf(call: ExtractCall): SegmentCallUsage {
  return { ...call.usage, role: call.role, seconds: Math.round(call.seconds * 1000) / 1000, ok: call.ok };
}
