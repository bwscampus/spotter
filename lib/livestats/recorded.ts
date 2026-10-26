import type { TonightTally } from "@/lib/cards/tonight";
import { foldBooth, foldStats, type LoggedDrop, type PlayStatus } from "@/lib/log/statsLog";
import { advanceWatermark, NO_WATERMARK } from "@/lib/plays/window";
import { UPDATE_LOOKBACK } from "./merge";
import { discardPlay, EMPTY_SESSION, freshReads, okPlay, readBoothLines, readPlays, restoreSession, talliesOf, type ReadContext, type SessionPlay, type StatsSession } from "./session";
import type { SegmentRequest } from "./extract/request";
import type { SegmentReply } from "./extract/run";
import { NOT_A_PLAY, type ExtractAnswer } from "./extract/schema";
import { DRIVE_REREAD_TIMEOUT_MS } from "./controller";
import { HALFTIME_TIMEOUT_MS } from "./halftime";
import { RecordedCallFailure, type ReplayExtract } from "./liveReplay";
import type { CallRecord } from "./manifest";
import type { RecordedCall } from "./playsJson";
import { NO_USAGE, type BoothStatLine, type StatsPlay, type StatsRosterPlayer } from "./types";
import type { SegmentDetail } from "./v7";
import { validateStatLines } from "./validate";

// =============================================================================
// Replaying a game's recorded replies with no network: the browser log keeps
// every play Claude returned (the stats_reply records), so the check and the
// stat rules can be run again over exactly what the reader said that night,
// and the totals compared with what the game counted at the time.
//
// "Before" is what the game counted: the plays as logged, with the decisions
// the announcer (or autoOk) made. "After" is the same replies through today's
// readPlays, with the same decisions applied by playId, so the only difference
// is the code. Pure, so a test can hand it a made-up log.
// =============================================================================

export interface RecordedNote {
  playId: string;
  summary: string;
  note: LoggedDrop;
}

export interface RecordedReplay {
  /** Replies that came back with plays. */
  replies: number;
  /** Plays the game read that night (stats_play records). */
  readByGame: number;
  /** The plays as today's code reads them, in order. */
  plays: SessionPlay[];
  /** The session as today's code leaves it, booth lines included. */
  session: StatsSession;
  before: Map<string, TonightTally>;
  after: Map<string, TonightTally>;
  /** Every event today's code moved, filled in, dropped or changed, with its rule. */
  notes: RecordedNote[];
}

export function replayRecorded(records: readonly { kind: string }[], roster: readonly StatsRosterPlayer[], context: ReadContext = {}): RecordedReplay {
  const logged = foldStats(records);
  const decided = new Map<string, PlayStatus>(logged.map((play) => [play.playId, play.status]));
  const before = talliesOf(restoreSession(logged, foldBooth(records)));

  // What was said, numbered the way the live loop numbers it (every non-blank
  // final, in order), so the check reads each play's own lines. Each reply
  // sees only what had been said by the time it came back.
  const said: Array<{ seq: number; text: string; offsetMs: number; at: number }> = [];
  for (const record of records) {
    const utterance = record as { kind: string; text?: unknown; at?: unknown };
    if (utterance.kind !== "utterance" || typeof utterance.text !== "string" || typeof utterance.at !== "number") continue;
    if (utterance.text.trim().length === 0) continue;
    said.push({ seq: said.length, text: utterance.text, offsetMs: utterance.at - (said[0]?.at ?? utterance.at), at: utterance.at });
  }

  // Who was out tonight before each reply: the game record's list, then every change (Part 3).
  let out = new Set<string>(outInGameRecord(records));
  let session: StatsSession = EMPTY_SESSION;
  let watermark = NO_WATERMARK;
  let replies = 0;
  for (const record of records) {
    if (record.kind === "stats_out") {
      const ids = (record as { playerIds?: unknown }).playerIds;
      if (Array.isArray(ids)) out = new Set(ids.filter((id): id is string => typeof id === "string"));
      continue;
    }
    if (record.kind !== "stats_reply") continue;
    const reply = record as { ok?: boolean; plays?: unknown; statLines?: unknown; at?: number; seqFrom?: unknown; seqTo?: unknown };
    if (reply.ok !== true || !Array.isArray(reply.plays)) continue;
    // A reply with no plays still moves the name check on, as it does live.
    if (reply.plays.length > 0) replies += 1;
    const plays = reply.plays as StatsPlay[];
    // The plays that call was sent: the last few read before it, as the live loop sends them.
    const recentIds = new Set(session.plays.filter((play) => play.status !== "discarded").slice(-UPDATE_LOOKBACK).map((play) => play.playId));
    const fresh = freshReads(plays, session, watermark, recentIds);
    watermark = advanceWatermark(watermark, plays);
    const at = typeof reply.at === "number" ? reply.at : 0;
    const utterances = context.utterances ?? said.filter((utterance) => utterance.at <= at);
    const readThrough = typeof reply.seqTo === "number" ? reply.seqTo : context.readThrough;
    const read = readPlays(session, fresh, roster, at, { ...context, out, utterances, ...(readThrough !== undefined ? { readThrough } : {}) });
    session = read.session;
    for (const play of read.added) {
      // The same decision the game made about this play; a play the game never
      // decided on counts, as autoOk would have counted it.
      const status = decided.get(play.playId) ?? "applied";
      if (status === "applied") session = okPlay(session, at, play.playId).session;
      else if (status === "discarded") session = discardPlay(session, at, play.playId).session;
    }
    // The stat lines the booth read in this reply (fix 6, Part 1), checked again today, after its plays.
    if (Array.isArray(reply.statLines) && typeof reply.seqFrom === "number" && readThrough !== undefined) {
      const window = utterances.filter((utterance) => utterance.seq >= (reply.seqFrom as number) && utterance.seq <= readThrough);
      const lines: BoothStatLine[] = validateStatLines(reply.statLines, { utterances: window.map((utterance) => ({ seq: utterance.seq, text: utterance.text, offsetMs: utterance.offsetMs ?? 0 })) });
      session = readBoothLines(session, lines, roster, { utterances, readThrough }).session;
    }
  }

  const notes: RecordedNote[] = [];
  for (const play of session.plays) for (const note of play.dropped) notes.push({ playId: play.playId, summary: play.play.summary, note });

  return {
    replies,
    readByGame: logged.length,
    plays: session.plays,
    session,
    before,
    after: talliesOf(session),
    notes,
  };
}

/** The players the first game record says were out when the game was built. */
function outInGameRecord(records: readonly { kind: string }[]): string[] {
  for (const record of records) {
    if (record.kind !== "game") continue;
    const out = (record as { snapshot?: { out?: unknown } }).snapshot?.out;
    return Array.isArray(out) ? out.filter((id): id is string => typeof id === "string") : [];
  }
  return [];
}

// -----------------------------------------------------------------------------
// v7 (fix 1, Part 6): a run's recorded answers, re-run through today's code.
// -----------------------------------------------------------------------------

/** What a v7 plays file and its manifest hold that a recorded re-run needs. */
export interface RecordedV7Run {
  segmentDetail: readonly SegmentDetail[];
  /** The manifest's calls, for each request's cost; absent, a re-run costs nothing. */
  calls?: readonly CallRecord[];
}

export interface RecordedV7Misses {
  /** Requests today's code made that the recorded run never made, by look. */
  byLook: Record<string, number>;
  /** Requests answered from the record. */
  answered: number;
}

/**
 * A segment route that answers from a recorded run (`--pipeline v7 --recorded
 * --answers <plays file>`): each request by its segment id, its look and how
 * many times that pair was asked before, the answer's indexes mapped through
 * the playerIds of the list it was given to today's list (a player not on
 * today's list is NOT_NAMED), and each call's recorded cost echoed. A request
 * the record does not have is a miss, counted: a re-read gets its current
 * answer back (nothing changes), anything else is not a play. `now` is the
 * clock the replay times calls by: an answer takes as long as its recorded
 * call did, so it lands when it landed live. No network; pure apart from its
 * own counters.
 */
export function recordedSegmentExtract(run: RecordedV7Run): { extract: (request: SegmentRequest) => Promise<SegmentReply>; misses: () => RecordedV7Misses; now: () => number } {
  const byKey = new Map<string, SegmentDetail[]>();
  for (const detail of run.segmentDetail) {
    const key = `${detail.segmentId}|${detail.look}`;
    byKey.set(key, [...(byKey.get(key) ?? []), detail]);
  }
  const callsByKey = new Map<string, CallRecord[]>();
  for (const call of run.calls ?? []) {
    if (!call.segmentId) continue;
    const key = `${call.segmentId}|${call.look}`;
    callsByKey.set(key, [...(callsByKey.get(key) ?? []), call]);
  }
  const asked = new Map<string, number>();
  const misses: RecordedV7Misses = { byLook: {}, answered: 0 };
  /** The replay's "real" clock (lib/livestats/liveReplay.ts `now`): each answer takes as long as its recorded calls did, so it lands when it landed live. */
  let clock = 0;

  const extract = async (request: SegmentRequest): Promise<SegmentReply> => {
    const key = `${request.segment.id}|${request.look}`;
    const nth = asked.get(key) ?? 0;
    asked.set(key, nth + 1);
    const detail = byKey.get(key)?.[nth];
    if (!detail) {
      misses.byLook[request.look] = (misses.byLook[request.look] ?? 0) + 1;
      const answer = request.look === "reread" && request.current ? request.current : NOT_A_PLAY;
      return { ok: true, answer, agreement: "recorded-missing", calls: [], usedB: false };
    }
    if (detail.failed !== null || !detail.reconciled) return { ok: false, code: detail.failed ?? "recorded_failed" };
    misses.answered += 1;
    const remap = (idx: number | null): number | null => {
      if (idx === null || idx === 0) return idx;
      const playerId = detail.candidates.find((candidate) => candidate.idx === idx)?.playerId ?? null;
      return request.candidates.find((candidate) => candidate.playerId !== null && candidate.playerId === playerId)?.idx ?? 0;
    };
    const mapped = (answer: ExtractAnswer | null): ExtractAnswer | null => (answer ? { ...answer, carrierIdx: remap(answer.carrierIdx), passerIdx: remap(answer.passerIdx), receiverIdx: remap(answer.receiverIdx), tacklerIdx: remap(answer.tacklerIdx) } : null);
    const recordedCalls = callsByKey.get(key) ?? [];
    // One call a request when the run read with A alone; otherwise the request's calls are not told apart, and nothing is echoed.
    const perRequest = recordedCalls.length === (byKey.get(key)?.length ?? 0) ? [recordedCalls[nth]] : [];
    clock += Math.round(perRequest.reduce((sum, call) => sum + call.seconds, 0) * 1000);
    return {
      ok: true,
      answer: mapped(detail.reconciled)!,
      agreement: detail.agreement ?? "recorded",
      answers: detail.answers ? { a: mapped(detail.answers.a), b: mapped(detail.answers.b), tieBreak: mapped(detail.answers.tieBreak) } : undefined,
      calls: perRequest.map((call) => ({ model: call.model, role: call.role === "halftime" || call.role === "reader" ? "a" : call.role, promptTokens: call.promptTokens, cachedTokens: call.cachedTokens, cacheWriteTokens: call.cacheWriteTokens, completionTokens: call.completionTokens, reasoningTokens: call.reasoningTokens, costUsd: call.costUsd, seconds: call.seconds, ok: call.ok })),
      usedB: false,
    };
  };
  return { extract, misses: () => ({ byLook: { ...misses.byLook }, answered: misses.answered }), now: () => clock };
}

// -----------------------------------------------------------------------------
// v6 (Oct 22): a run's recorded replies, re-run through today's code.
// -----------------------------------------------------------------------------

export interface RecordedV6Misses {
  /** Requests today's code made that the recorded run never made, by look. */
  byLook: Record<string, number>;
  /** Requests answered from the record. */
  answered: number;
}

/**
 * How long a reply the loop is not ready for is held, in real time, before it
 * is let go anyway: longer than the loop's own wait on a re-read
 * (DRIVE_REREAD_TIMEOUT_MS, 20 s), so a re-read that ran late in the run runs
 * late again here. Only code that asks differently from the run ever waits it
 * out.
 */
export const RECORDED_HOLD_MS = 25_000;

/** How long past the loop's own wait a late re-read is held, so the loop's timer goes first. */
export const LATE_MARGIN_MS = 1_000;

/**
 * The wire for `--recorded --replies <plays file>`: each request answered
 * with the reply the recorded run got for the same look and lines (its first
 * and last seq, and how many times that was asked before), with no network.
 * v6 can have several calls in flight at once (a second look beside a drive
 * re-read, or the next read after the loop gave up waiting on a slow
 * re-read), and which reply the loop gets first moves the clock and so the
 * next window. So replies are let go one at a time, strictly in the order the
 * run got them back (`done`), each after the loop has finished with the one
 * before, and none before the loop has asked as many more calls after it as
 * the run had when that reply came back (`askedBefore` less the call's own
 * index: counted from the request, so a request the run never made does not
 * shift every reply after it). A re-read that came back after the loop had stopped
 * waiting for it in the run (`late`) is held, in real time, past the loop's
 * own wait, so the loop stops waiting again. A reply the loop is not ready
 * for after RECORDED_HOLD_MS goes anyway. Each carries its recorded timing, so the replay's clock moves
 * as it did in the run. A request the record does not have gets no plays,
 * taking no time, and is counted.
 */
export function recordedReplies(calls: readonly RecordedCall[], holdMs = RECORDED_HOLD_MS): { extract: ReplayExtract; misses: () => RecordedV6Misses } {
  const keyOf = (look: string, seqFrom: number | null | undefined, seqTo: number | null | undefined) => `${look}|${seqFrom ?? ""}|${seqTo ?? ""}`;
  const byKey = new Map<string, RecordedCall[]>();
  for (const call of [...calls].sort((a, b) => a.index - b.index)) {
    const key = keyOf(call.look, call.seqFrom, call.seqTo);
    byKey.set(key, [...(byKey.get(key) ?? []), call]);
  }
  const asked = new Map<string, number>();
  const misses: RecordedV6Misses = { byLook: {}, answered: 0 };
  const waiting: Array<{ done: number; order: number; askedBefore: number; notBefore: number; release: () => void }> = [];
  let order = 0;
  let scheduled = false;
  let holding: ReturnType<typeof setTimeout> | null = null;
  const go = (entry: (typeof waiting)[number]) => {
    waiting.splice(waiting.indexOf(entry), 1);
    if (holding) clearTimeout(holding);
    holding = null;
    entry.release();
    if (waiting.length > 0) schedule();
  };
  // A timer, not a microtask: the loop's continuation of the last reply, and any request it makes, comes first.
  const next = () => {
    scheduled = false;
    // Strictly in the order the run got them back: only the first may go, and only once the loop is ready for it.
    waiting.sort((a, b) => a.done - b.done || a.order - b.order);
    const head = waiting[0];
    if (!head) return;
    if (head.askedBefore <= order) {
      const wait = head.notBefore - Date.now();
      // A late re-read goes once the loop's own wait is over.
      if (wait <= 0) return go(head);
      setTimeout(schedule, wait);
      return;
    }
    // The loop has not asked as many calls yet: wait for it, or let the first go once it plainly will not.
    if (!holding) holding = setTimeout(() => waiting.length > 0 && go(waiting[0]), holdMs);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(next, 0);
  };

  const extract: ReplayExtract = (request) => {
    const look = request.look ?? "first";
    const key = keyOf(look, request.utterances[0]?.seq, request.utterances.at(-1)?.seq);
    const nth = asked.get(key) ?? 0;
    asked.set(key, nth + 1);
    const call = byKey.get(key)?.[nth];
    if (call) misses.answered += 1;
    else misses.byLook[look] = (misses.byLook[look] ?? 0) + 1;
    order += 1;
    const asOf = order;
    return new Promise((resolve, reject) => {
      const release = () => {
        if (!call) return resolve({ plays: [], statLines: [], usage: NO_USAGE, timing: { tookMs: 0, returnAfterMs: 0 } });
        const timing = { tookMs: call.tookMs, returnAfterMs: call.returnAfterMs, ...(call.late ? { late: true } : {}), ...(call.retries ? { retries: call.retries } : {}) };
        if (!call.ok) return reject(new RecordedCallFailure(call.code ?? "recorded_failed", timing));
        resolve({ plays: call.plays ?? [], statLines: call.statLines ?? [], usage: call.usage ?? NO_USAGE, timing });
      };
      // Held until as many more calls have been asked after it as in the run. A miss is let go after everything recorded.
      const after = call ? Math.max(0, (call.askedBefore ?? call.index) - call.index) : 0;
      const lateBy = call?.late ? (look === "halftime" ? HALFTIME_TIMEOUT_MS : DRIVE_REREAD_TIMEOUT_MS) + LATE_MARGIN_MS : 0;
      waiting.push({ done: call ? call.done : Number.POSITIVE_INFINITY, order: asOf, askedBefore: asOf + after, notBefore: Date.now() + lateBy, release });
      schedule();
    });
  };
  return { extract, misses: () => ({ byLook: { ...misses.byLook }, answered: misses.answered }) };
}
