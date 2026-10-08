// =============================================================================
// Where the play feed keeps things in this browser, and how one game's worth of
// them is measured and removed.
//
// PRIVACY: everything under these keys is a recording of an announcer naming
// high school players, and what Claude made of it. None of it is ever uploaded.
// It is kept here so a game can be reviewed afterwards and so the prompt can be
// tuned against what was actually said.
//
// A transcript is chunked rather than held in one value because the tail is the
// only chunk ever rewritten. A whole game in one key would mean rewriting the
// entire transcript every ten seconds for two and a half hours: hundreds of
// megabytes of setItem, on the main thread, during a broadcast.
// =============================================================================

export const TRANSCRIPT_PREFIX = "spotter.transcript.v1.";
export const TRANSCRIPT_INDEX_PREFIX = "spotter.transcriptIndex.v1.";
export const PLAYS_PREFIX = "spotter.plays.v1.";

// =============================================================================
// TUNING: how much of a game this browser is willing to hold.
// =============================================================================

/** Utterances per chunk. A sealed chunk is written once and never touched again. */
export const CHUNK_UTTERANCES = 250;

/**
 * The most transcript one game may take. About 4,000 utterances, comfortably
 * past a 150 minute game. Enforced before writing rather than by catching the
 * quota error, because localStorage reserves nothing per key: the write that
 * fails is whichever one happens to cross the line, and it might be the match
 * log's.
 */
export const MAX_TRANSCRIPT_CHARS = 600_000;

/** Roughly what a row costs beyond its text: the keys, the ISO date, the braces. */
const ENVELOPE_CHARS = 72;

// =============================================================================

/** One finalized thing the announcer said. */
export interface Utterance {
  /** Contiguous from 0 within a game, across reconnects and reloads. */
  seq: number;
  text: string;
  /** ISO time it was recorded. */
  at: string;
  /** Milliseconds since the game was built. */
  offsetMs: number;
  /** Which Deepgram socket it came from. Word clocks only compare within one. */
  connectionId: number;
}

export interface TranscriptIndex {
  chunks: number;
  utterances: number;
  chars: number;
}

const NO_INDEX: TranscriptIndex = { chunks: 0, utterances: 0, chars: 0 };

/** What a row will cost in storage, without paying for a stringify to find out. */
export function utteranceChars(text: string): number {
  return text.length + ENVELOPE_CHARS;
}

export function transcriptIndexOf(gameId: string): TranscriptIndex {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_INDEX_PREFIX + gameId);
    if (!raw) return NO_INDEX;
    const parsed = JSON.parse(raw) as Partial<TranscriptIndex> | null;
    if (!parsed) return NO_INDEX;
    return {
      chunks: Math.max(0, Math.round(parsed.chunks ?? 0)),
      utterances: Math.max(0, Math.round(parsed.utterances ?? 0)),
      chars: Math.max(0, Math.round(parsed.chars ?? 0)),
    };
  } catch {
    return NO_INDEX;
  }
}

export function writeTranscriptIndex(gameId: string, index: TranscriptIndex) {
  localStorage.setItem(TRANSCRIPT_INDEX_PREFIX + gameId, JSON.stringify(index));
}

export function transcriptChunkKey(gameId: string, chunk: number): string {
  return `${TRANSCRIPT_PREFIX}${gameId}.${chunk}`;
}

/** Every chunk of a stored transcript, oldest first. */
export function readStoredTranscript(gameId: string): Utterance[] {
  const { chunks } = transcriptIndexOf(gameId);
  const all: Utterance[] = [];
  for (let chunk = 0; chunk < chunks; chunk++) {
    try {
      const raw = localStorage.getItem(transcriptChunkKey(gameId, chunk));
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) all.push(...(parsed as Utterance[]));
    } catch {
      // A chunk that will not parse is a gap, not a reason to lose the rest.
    }
  }
  return all;
}

/**
 * Drops one game's transcript, chunks and index together.
 *
 * Falls back to scanning the key space when the index is missing, which happens
 * if a write was interrupted. Without the fallback an interrupted write leaks
 * chunks nothing will ever delete.
 */
export function removeTranscript(gameId: string) {
  try {
    const { chunks } = transcriptIndexOf(gameId);
    for (let chunk = 0; chunk < chunks; chunk++) {
      localStorage.removeItem(transcriptChunkKey(gameId, chunk));
    }
    localStorage.removeItem(TRANSCRIPT_INDEX_PREFIX + gameId);
    if (chunks === 0) removeByPrefix(`${TRANSCRIPT_PREFIX}${gameId}.`);
  } catch {
    // Storage is blocked. Nothing to recover from and nothing to say.
  }
}

/** Every key this browser holds for one game, across all of the play feed's kinds. */
export function removePlayFeedData(gameId: string) {
  removeTranscript(gameId);
  try {
    localStorage.removeItem(PLAYS_PREFIX + gameId);
  } catch {
    // As above.
  }
}

/** What one game's play feed data costs, for pruning by size rather than by count. */
export function playFeedChars(gameId: string): number {
  let total = transcriptIndexOf(gameId).chars;
  try {
    total += localStorage.getItem(PLAYS_PREFIX + gameId)?.length ?? 0;
  } catch {
    // Unreadable is not the same as large. Count what could be read.
  }
  return total;
}

function removeByPrefix(prefix: string) {
  const doomed: string[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) doomed.push(key);
  }
  for (const key of doomed) localStorage.removeItem(key);
}
