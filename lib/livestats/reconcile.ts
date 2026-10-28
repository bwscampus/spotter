import { CANDIDATE_MIN_SCORE } from "./candidates";
import { callExtractor, callUsageOf, type CallOptions, type ExtractCall, type SegmentReply, type SegmentWire } from "./extract/run";
import { playAndPostText, type SegmentRequest } from "./extract/request";
import type { ExtractAnswer } from "./extract/schema";
import type { V7Settings } from "./settings";

// =============================================================================
// Two readers and a tie-break (v7, Part 8). For each segment reader A (Haiku
// 5.5, low) and reader B (GPT-6 Luna, low) are asked in parallel. When their
// agreement key (play type, carrier, passer, receiver) matches, the answer
// is accepted at high confidence, with yardsSaid when both agree or one is
// null and the other's number is in the lines. When the keys differ, a
// tie-break (Haiku at medium) is shown the same request and both answers as
// "Reader 1" and "Reader 2", and its answer is accepted when it matches
// either reader; otherwise only the fields A and B agree on are credited, at
// low confidence.
//
// The cost guard: above GUARD_SKIP_B_USD spent this game, B is skipped on a
// play where A is high-confidence and the list holds one player; above
// GUARD_A_ONLY_USD, A alone; never past the cap (--max-cost or the setting).
// A reader with no zero-retention endpoint is never called (./zdr.ts). Pure
// apart from the calls, which go through the wire handed in.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Dollars spent this game above which B is skipped when A is sure and the list is short. */
export const GUARD_SKIP_B_USD = 0.4;

/** Dollars spent this game above which only A is called. */
export const GUARD_A_ONLY_USD = 0.6;

// =============================================================================

export type Agreement = "agree" | "tiebreak" | "partial" | "a-only" | "b-unavailable" | "aa";

export type GuardMode = "ab" | "skip-b-when-sure" | "a-only";

/** The failure code when reader A's model has no zero-retention endpoint (or the list is unreadable): nothing is sent. */
export const ZDR_REFUSED = "zdr_refused";

/** The mode the spend so far puts the game in. */
export function guardMode(spentUsd: number, maxCostUsd: number | null): GuardMode {
  if (maxCostUsd !== null && spentUsd >= maxCostUsd) return "a-only";
  if (spentUsd >= GUARD_A_ONLY_USD) return "a-only";
  if (spentUsd >= GUARD_SKIP_B_USD) return "skip-b-when-sure";
  return "ab";
}

/** The four fields two readers must agree on. */
export function agreementKey(answer: ExtractAnswer): string {
  return [answer.playType, answer.carrierIdx ?? "null", answer.passerIdx ?? "null", answer.receiverIdx ?? "null"].join("|");
}

/** Whether a number appears as a token in the lines ("picks up 7" holds 7; "17" does not hold 7). */
export function numberInLines(value: number, lines: readonly string[]): boolean {
  const wanted = String(Math.abs(value));
  return lines.some((line) => line.split(/[^0-9]+/).includes(wanted));
}

/**
 * Two answers with the same key, merged: yardsSaid when both say the same, or
 * one is null and the other's number is in the lines; the tackler either
 * named (A's first); confidence high.
 */
export function mergeAgreed(a: ExtractAnswer, b: ExtractAnswer, lines: readonly string[]): ExtractAnswer {
  let yardsSaid: number | null = null;
  if (a.yardsSaid !== null && a.yardsSaid === b.yardsSaid) yardsSaid = a.yardsSaid;
  else if (a.yardsSaid !== null && b.yardsSaid === null && numberInLines(a.yardsSaid, lines)) yardsSaid = a.yardsSaid;
  else if (b.yardsSaid !== null && a.yardsSaid === null && numberInLines(b.yardsSaid, lines)) yardsSaid = b.yardsSaid;
  return {
    ...a,
    yardsSaid,
    tacklerIdx: a.tacklerIdx ?? b.tacklerIdx,
    touchdown: a.touchdown || b.touchdown,
    penalty: a.penalty === b.penalty ? a.penalty : a.penalty === "none" ? b.penalty : a.penalty,
    confidence: "high",
  };
}

/** Only what A and B agree on, at low confidence; a player they disagree on is NOT_NAMED, a figure they disagree on is null. */
export function partialCredit(a: ExtractAnswer, b: ExtractAnswer): ExtractAnswer {
  const same = <T>(x: T, y: T, fallback: T): T => (x === y ? x : fallback);
  const idx = (x: number | null, y: number | null): number | null => (x === y ? x : x === null || y === null ? null : 0);
  return {
    playType: same(a.playType, b.playType, a.playType),
    carrierIdx: idx(a.carrierIdx, b.carrierIdx),
    passerIdx: idx(a.passerIdx, b.passerIdx),
    receiverIdx: idx(a.receiverIdx, b.receiverIdx),
    tacklerIdx: idx(a.tacklerIdx, b.tacklerIdx),
    yardsSaid: same(a.yardsSaid, b.yardsSaid, null),
    touchdown: a.touchdown && b.touchdown,
    penalty: same(a.penalty, b.penalty, "unclear"),
    confidence: "low",
  };
}

export interface Reconciled {
  answer: ExtractAnswer;
  agreement: Agreement;
  calls: ExtractCall[];
}

export interface ReconcileDeps {
  wire: SegmentWire;
  /** Whether a model has a zero-retention endpoint (./zdr.ts). Unknown is false. */
  zdrAllows(model: string): Promise<boolean>;
  log?: (line: string) => void;
  call?: typeof callExtractor;
  callOptions?: CallOptions;
}

/** Whether the candidate list holds exactly one named player (NOT_NAMED aside). */
function oneNamed(request: SegmentRequest): boolean {
  return request.candidates.filter((candidate) => candidate.playerId !== null && candidate.score >= CANDIDATE_MIN_SCORE).length === 1;
}

/**
 * One segment through the readers by the rules above. A's failure fails the
 * segment (its code); B's failure, or B having no zero-retention endpoint,
 * leaves A's answer standing and says so in the agreement.
 */
export async function reconcileSegment(request: SegmentRequest, settings: V7Settings, deps: ReconcileDeps): Promise<Reconciled | { ok: false; code: string; calls: ExtractCall[] }> {
  const call = deps.call ?? callExtractor;
  const options = deps.callOptions ?? {};
  const lines = playAndPostText(request);
  const spent = request.budget?.spentUsd ?? 0;
  const cap = request.budget?.maxCostUsd ?? settings.maxCostUsd;
  const mode = guardMode(spent, cap);
  const readerB = settings.reconcile === "aa" ? settings.modelA : settings.reconcile === "a" ? null : settings.modelB;
  const tieBreak = settings.reconcile === "ab-no-tiebreak" ? null : settings.tieBreak;

  // Fail closed (Part 8): a reader whose model has no zero-retention endpoint
  // on OpenRouter's list, or whose status cannot be read, is not called. For
  // A that fails the segment with ZDR_REFUSED; for B it leaves A alone.
  if (!(await deps.zdrAllows(settings.modelA.model))) {
    deps.log?.(`[Spotter] v7 reader A (${settings.modelA.model}) has no zero-retention endpoint, or the list could not be read; the segment is not read.`);
    return { ok: false, code: ZDR_REFUSED, calls: [] };
  }
  const bAllowed = readerB !== null && mode !== "a-only" && (await deps.zdrAllows(readerB.model));
  if (readerB !== null && mode !== "a-only" && !bAllowed) deps.log?.(`[Spotter] v7 reader B (${readerB.model}) has no zero-retention endpoint; reading with A alone.`);
  const calls: ExtractCall[] = [];

  // Parallel A and B, unless the guard says to ask A first and B only when A is not sure.
  if (bAllowed && mode === "ab") {
    const [a, b] = await Promise.all([call(deps.wire, settings.modelA, request, "a", options), call(deps.wire, readerB!, request, "b", options)]);
    calls.push(a, b);
    if (!a.ok || !a.answer) return { ok: false, code: a.code ?? "bad_response", calls };
    if (!b.ok || !b.answer) return { answer: a.answer, agreement: "b-unavailable", calls };
    return settle(a.answer, b.answer, calls, lines, request, settings, tieBreak, call, deps, options);
  }

  const a = await call(deps.wire, settings.modelA, request, "a", options);
  calls.push(a);
  if (!a.ok || !a.answer) return { ok: false, code: a.code ?? "bad_response", calls };
  const skipB = !bAllowed || (mode === "skip-b-when-sure" && a.answer.confidence === "high" && oneNamed(request));
  if (skipB) return { answer: a.answer, agreement: bAllowed ? "a-only" : readerB === null ? "a-only" : "b-unavailable", calls };
  const b = await call(deps.wire, readerB!, request, "b", options);
  calls.push(b);
  if (!b.ok || !b.answer) return { answer: a.answer, agreement: "b-unavailable", calls };
  return settle(a.answer, b.answer, calls, lines, request, settings, tieBreak, call, deps, options);
}

async function settle(
  a: ExtractAnswer,
  b: ExtractAnswer,
  calls: ExtractCall[],
  lines: readonly string[],
  request: SegmentRequest,
  settings: V7Settings,
  tieBreak: V7Settings["tieBreak"] | null,
  call: typeof callExtractor,
  deps: ReconcileDeps,
  options: CallOptions,
): Promise<Reconciled> {
  const aaMode = settings.reconcile === "aa";
  if (agreementKey(a) === agreementKey(b)) return { answer: mergeAgreed(a, b, lines), agreement: aaMode ? "aa" : "agree", calls };
  const spent = (request.budget?.spentUsd ?? 0) + calls.reduce((sum, made) => sum + made.usage.costUsd, 0);
  const cap = request.budget?.maxCostUsd ?? settings.maxCostUsd;
  if (tieBreak && (cap === null || spent < cap)) {
    const tie = await call(deps.wire, tieBreak, request, "tie", { ...options, readers: [a, b] });
    calls.push(tie);
    if (tie.ok && tie.answer) {
      const key = agreementKey(tie.answer);
      if (key === agreementKey(a)) return { answer: mergeAgreed(a, tie.answer, lines), agreement: "tiebreak", calls };
      if (key === agreementKey(b)) return { answer: mergeAgreed(b, tie.answer, lines), agreement: "tiebreak", calls };
    }
  }
  return { answer: partialCredit(a, b), agreement: "partial", calls };
}

/** A reconciled result as the route's reply. */
export function replyOf(result: Awaited<ReturnType<typeof reconcileSegment>>): SegmentReply {
  if ("ok" in result && result.ok === false) return { ok: false, code: result.code };
  const done = result as Reconciled;
  const answerOf = (role: ExtractCall["role"]) => done.calls.find((made) => made.role === role)?.answer ?? null;
  const answers = { a: answerOf("a"), b: answerOf("b"), tieBreak: answerOf("tie") };
  return { ok: true, answer: done.answer, agreement: done.agreement, calls: done.calls.map(callUsageOf), usedB: done.calls.some((made) => made.role === "b"), answers };
}
