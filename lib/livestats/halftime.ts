import type { StatsPlay } from "./types";

// =============================================================================
// The halftime checkup (Oct 11, Part 8): one careful read of the whole first
// half by a stronger model, with everything the booth said, before the second
// half starts. It runs once a game, in the background, the first time any of
// these happens:
//   a. the transcript says halftime, the end of the first half, or the start
//      of the second (numerals=true writes "half" as "0.5": "end of the 1st
//      0.5", see the traps in CLAUDE.md), once enough of a half has been
//      counted for the word to mean the break rather than talk about it;
//   b. the reader returns a play in the third quarter or later;
//   c. no football talk for HALFTIME_QUIET_MS after a play in the second
//      quarter;
// or when the announcer presses H. What it sends, the model it goes to and
// how long it may take are the loop's (lib/livestats/controller.ts) and the
// server's (lib/livestats/settings.ts, app/api/livestats/halftime). Pure.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/**
 * No football talk for this long after a play in the second quarter is the
 * break: a TV halftime runs 12 to 20 minutes, a high school one 10 to 15, and
 * a timeout or an injury stoppage is under three.
 */
export const HALFTIME_QUIET_MS = 6 * 60_000;

/**
 * How long the checkup may take: the whole first half is a few thousand lines
 * and the model reads it once, under the ~100 s the proxy allows a request.
 */
export const HALFTIME_TIMEOUT_MS = 90_000;

/**
 * "Halftime" said before this many plays have been counted is talk about the
 * halftime show, not the break: half a football game is 60 to 80 plays.
 */
export const HALFTIME_MIN_PLAYS = 20;

// =============================================================================

/** The code the log carries when the checkup never came back. */
export const HALFTIME_TIMEOUT = "halftime_timeout";

const SAID = [
  /\bhalf\s?time\b/i,
  /\b0\.5\s?time\b/i,
  /\bintermission\b/i,
  /\b(?:end|close|final \w+) of the (?:first|1st|opening) (?:half|0\.5)\b/i,
  /\b(?:do|be|that) it for the (?:first|1st|opening) (?:half|0\.5)\b/i,
  /\b(?:first|1st) (?:half|0\.5) (?:is|comes to an|in the|has come to an) (?:over|end|books)\b/i,
  /\b(?:second|2nd) (?:half|0\.5)\b/i,
];

/** Whether a line says it is halftime, the end of the first half, or the start of the second. */
export function halftimeSaid(text: string): boolean {
  return SAID.some((pattern) => pattern.test(text));
}

/** Whether a play the reader returned is in the second half. */
export function secondHalfPlay(play: Pick<StatsPlay, "quarter">): boolean {
  return play.quarter !== null && play.quarter >= 3;
}

export interface HalftimeSignals {
  /** A line said halftime, and at least HALFTIME_MIN_PLAYS plays have been counted, none of them in the second half yet known. */
  said: boolean;
  /** The reader returned a play in the third quarter or later. */
  secondHalfPlay: boolean;
  /** The last counted play with a quarter was in the second, and nothing like football has been said for HALFTIME_QUIET_MS. */
  quietAfterSecondQuarter: boolean;
}

/** Whether the checkup should run now. */
export function halftimeDue(signals: HalftimeSignals): boolean {
  return signals.said || signals.secondHalfPlay || signals.quietAfterSecondQuarter;
}

/**
 * The last line of the first half: the line before the first second-half play
 * begins, else the line that said halftime, else everything so far.
 */
export function firstHalfEnd(plays: ReadonlyArray<{ play: StatsPlay; status: string }>, halftimeLine: number | null, lastSeq: number): number {
  const secondHalf = plays.filter((entry) => entry.status !== "discarded" && secondHalfPlay(entry.play)).map((entry) => entry.play.seqStart);
  if (secondHalf.length > 0) return Math.max(0, Math.min(...secondHalf) - 1);
  if (halftimeLine !== null) return halftimeLine;
  return lastSeq;
}
