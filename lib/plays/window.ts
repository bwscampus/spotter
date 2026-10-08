import type { PlayUtterance } from "./types";
import type { Utterance } from "./storage";

// =============================================================================
// When to ask, what to send, and what to throw away when it comes back.
//
// All pure, and deliberately so. This is the part of the play feed that can be
// wrong in ways nobody would notice during a game: a window that quietly drops
// its first play, a watermark that slips backwards after a reconnect and starts
// proposing the third quarter again. vitest here has no DOM, so anything that
// needs proving lives in this file rather than in the hook.
// =============================================================================

// =============================================================================
// TUNING: the shape of a window.
// =============================================================================

/**
 * How far back before the watermark a window starts.
 *
 * A play described across a window boundary would otherwise be cut in half and
 * read as two, or as none. Four utterances is about fifteen seconds of speech.
 */
export const WINDOW_OVERLAP = 4;

/** Most utterances in one window, so a long unread stretch cannot produce a huge request. */
export const MAX_WINDOW = 30;

/** Before anything has been read. Not 0: utterance 0 has not been seen either. */
export const NO_WATERMARK = -1;

/**
 * The plain cadence while the mic is open, for a play nobody followed with a
 * down and distance (a kick, the end of a drive). A down and distance still
 * asks at once. 60 s, not 30 (Jed, Oct 4: half the calls on the Oct 2 and 3
 * logs were this timer, and every call costs the same whether it reads a play
 * or not).
 */
export const CADENCE_MS = 60_000;

/**
 * The floor between calls, whatever the triggers say.
 *
 * Jed can say "third and two" twice in ten seconds, and the second one is the
 * same play boundary as the first.
 */
export const MIN_GAP_MS = 10_000;

// =============================================================================

/**
 * Whether this is an announcer marking a play boundary.
 *
 * Down and distance is the single most useful thing in the transcript. Jed says
 * it constantly, and it means the previous play is over, which is exactly the
 * moment worth asking about.
 *
 * Both spellings, because `numerals=true` on the Deepgram socket rewrites the
 * ordinals: "third" arrives as "3rd". That is the same option that turns
 * "twenty three" into "23" and "quarter" into "0.25", and it is not optional
 * because jersey numbers depend on it. See the traps in CLAUDE.md.
 */
const DOWN = "(?:first|1st|second|2nd|third|3rd|fourth|4th)";
const BOUNDARY = new RegExp(`\\b${DOWN}\\s+(?:and|an|&)\\s+\\S+|\\b${DOWN}\\s+down\\b`, "i");

export function isPlayBoundary(text: string): boolean {
  return BOUNDARY.test(text);
}

/**
 * The utterances to send, given everything said and how far reading has got.
 *
 * Takes the most recent MAX_WINDOW rather than the oldest unread ones, so on
 * its own it drops the oldest of a backlog unread. Live stats call it through
 * readingPlan, which reads a backlog in several windows instead (audit M9).
 */
export function windowFor(all: readonly Utterance[], watermark: number): PlayUtterance[] {
  const from = watermark - WINDOW_OVERLAP;
  const eligible: PlayUtterance[] = [];
  for (const utterance of all) {
    if (utterance.seq < from) continue;
    eligible.push({ seq: utterance.seq, text: utterance.text, offsetMs: utterance.offsetMs });
  }
  return eligible.length > MAX_WINDOW ? eligible.slice(-MAX_WINDOW) : eligible;
}

/** What to send to catch up: one window or several, oldest first, and what was left unread. */
export interface ReadingPlan {
  /** Sent one at a time, oldest first, each read and applied before the next goes. */
  windows: PlayUtterance[][];
  /** Lines never sent in any window, because the backlog was longer than `maxWindows` windows hold. */
  skipped: number;
  /** The last skipped line's seq, or null when nothing was skipped. */
  skippedThrough: number | null;
}

/** How many lines `count` windows hold, each reaching WINDOW_OVERLAP back into the one before. */
export function linesInWindows(count: number): number {
  return count <= 0 ? 0 : MAX_WINDOW + (count - 1) * (MAX_WINDOW - WINDOW_OVERLAP);
}

/**
 * What to send, given everything said, how far reading has got (`watermark`,
 * the furthest play read) and the last line already sent in a read that
 * worked (`readThrough`, NO_WATERMARK for none).
 *
 * When the lines never sent fit in one window, it is exactly windowFor: the
 * newest MAX_WINDOW from the overlap before the watermark. When they do not
 * (a run of failures, fast talk before a call, the last read at End game),
 * windowFor would drop the oldest of them unread. Instead the backlog is cut
 * into windows of MAX_WINDOW, oldest first, each reaching WINDOW_OVERLAP back
 * into the one before so no play is cut in half, starting WINDOW_OVERLAP
 * before the first line never sent. At most `maxWindows` of them: past that
 * the oldest lines are left unread and counted in `skipped`, so the reading
 * stays near the present and the caller can say what it skipped.
 */
export function readingPlan(
  all: readonly Utterance[],
  watermark: number,
  readThrough: number,
  maxWindows: number,
): ReadingPlan {
  const cursor = Math.max(watermark, readThrough);
  const unread = all.filter((utterance) => utterance.seq > cursor).length;
  if (unread <= MAX_WINDOW) return { windows: [windowFor(all, watermark)], skipped: 0, skippedThrough: null };

  const from = cursor + 1 - WINDOW_OVERLAP;
  const lines: PlayUtterance[] = [];
  for (const utterance of all) {
    if (utterance.seq < from || utterance.seq < watermark - WINDOW_OVERLAP) continue;
    lines.push({ seq: utterance.seq, text: utterance.text, offsetMs: utterance.offsetMs });
  }

  const room = linesInWindows(Math.max(1, maxWindows));
  const cut = Math.max(0, lines.length - room);
  const skippedLines = lines.slice(0, cut).filter((line) => line.seq > cursor);
  const kept = lines.slice(cut);

  const windows: PlayUtterance[][] = [];
  for (let start = 0; ; start += MAX_WINDOW - WINDOW_OVERLAP) {
    windows.push(kept.slice(start, start + MAX_WINDOW));
    if (start + MAX_WINDOW >= kept.length) break;
  }
  return {
    windows,
    skipped: skippedLines.length,
    skippedThrough: skippedLines.at(-1)?.seq ?? null,
  };
}

/**
 * The plays in this reply that have not been seen before.
 *
 * The whole of deduplication, and it is one comparison rather than any attempt
 * to match summaries against each other. Two windows that overlap will describe
 * the same play in different words; they cannot disagree about which utterance
 * it ended on.
 *
 * Generic over the play's shape because only seqEnd is read: V2's proposed
 * plays and V3's live stats plays (lib/livestats/types.ts) both go through it.
 */
export function newPlays<P extends { seqEnd: number }>(plays: readonly P[], watermark: number): P[] {
  return plays.filter((play) => play.seqEnd > watermark);
}

/** How far reading has got once these plays are in the queue. Never goes backwards. */
export function advanceWatermark(watermark: number, plays: readonly { seqEnd: number }[]): number {
  let highest = watermark;
  for (const play of plays) if (play.seqEnd > highest) highest = play.seqEnd;
  return highest;
}

/**
 * Whether the loop would ask right now.
 *
 * Here rather than in the hook so the replay harness makes exactly the same
 * calls a live game would, which is the only thing that makes a dry run worth
 * anything for tuning the prompt.
 */
export function shouldAsk({
  now,
  lastCallAt,
  boundarySeen,
  worthReading,
}: {
  now: number;
  lastCallAt: number;
  /** A down and distance call since the last ask. Worth jumping the cadence for. */
  boundarySeen: boolean;
  /**
   * Something said since the last ask is worth a call. Live stats count only
   * talk that sounds like football (lib/livestats/playTalk.ts), so dead air,
   * halftime and adverts cost nothing.
   */
  worthReading: boolean;
}): boolean {
  if (!worthReading) return false;
  const since = now - lastCallAt;
  if (since < MIN_GAP_MS) return false;
  return boundarySeen || since >= CADENCE_MS;
}
