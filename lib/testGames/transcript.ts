// =============================================================================
// A transcript file, as the lines a live game would have logged (Oct 13, for
// `npm run make:game`, scripts/make-test-game.ts).
//
// A live game logs one utterance per Deepgram final: lowercase, no
// punctuation (smart_format and punctuate are off), numbers as digits
// (numerals=true), a few seconds each. This turns whatever text file a game's
// commentary came in into lines of that shape, each with when it was said:
//   - Deepgram's JSON (the pre-recorded endpoint or the playground's download):
//     its words, cut into final-sized lines at pauses, each with its own time;
//   - captions (.srt or .vtt): each caption, at its start time;
//   - plain text: one line per line, with a time when the line starts with one
//     ("[00:12:34]", "12:34", "1:02:03.5"), else spaced at a talking pace.
//
// Live stats decides when to call on this clock (lib/plays/window.ts), so a
// transcript with real times replays the way the game would have; one without
// still reads every play, but its latency number means nothing.
//
// Pure: the script reads the file and hands the text in.
// =============================================================================

// =============================================================================
// TUNING: how lines are cut and paced.
// =============================================================================

/** A pause this long between two words ends a line, as Deepgram's endpointing ends a final. */
export const LINE_GAP_S = 0.6;
/** A line never runs longer than this, in seconds or words, however fast the talk. */
export const MAX_LINE_S = 10;
export const MAX_LINE_WORDS = 30;
/** For text with no times: how fast an announcer talks, and the pause between lines. */
export const WORDS_PER_SECOND = 2.6;
export const PAUSE_S = 0.6;

// =============================================================================

export interface TranscriptLine {
  /** Milliseconds from the start of the transcript. */
  startMs: number;
  text: string;
}

export interface Transcript {
  format: "deepgram" | "captions" | "text";
  lines: TranscriptLine[];
  /** False when the file had no times and the lines were spaced at a talking pace. */
  timed: boolean;
  /** True when the file had no digits, so number words were written as digits the way numerals=true would. */
  numbersConverted: boolean;
}

/** Why a file cannot be read as a transcript, in words for the terminal. */
export class TranscriptError extends Error {}

export function readTranscript(raw: string): Transcript {
  const source = raw.replace(/^﻿/, "");
  const trimmed = source.trim();
  if (trimmed.length === 0) throw new TranscriptError("The transcript file is empty.");

  let lines: TranscriptLine[];
  let format: Transcript["format"];
  let timed = true;
  // "[00:00:05] Welcome..." starts like a JSON list too, so only a "{" that will not parse is a broken file.
  const json = trimmed.startsWith("{") || trimmed.startsWith("[") ? parseJson(trimmed) : undefined;
  if (json === undefined && trimmed.startsWith("{")) {
    throw new TranscriptError("The transcript looks like JSON but does not read as JSON. Download it from Deepgram again.");
  }
  if (json !== undefined) {
    const fromJson = deepgramLines(json);
    if (fromJson === null) throw new TranscriptError("This JSON is not a Deepgram transcript: it has no words, utterances or transcript in it.");
    ({ lines, timed } = fromJson);
    format = "deepgram";
  } else if (/-->/.test(trimmed)) {
    lines = captionLines(trimmed);
    format = "captions";
  } else {
    ({ lines, timed } = textLines(trimmed));
    format = "text";
  }

  const numbersConverted = !lines.some((line) => /\d/.test(line.text));
  const out: TranscriptLine[] = [];
  let last = 0;
  for (const line of lines) {
    const text = normalizeLine(line.text, numbersConverted);
    if (text.length === 0) continue;
    // Never backwards, whatever the file says.
    last = Math.max(last, Math.round(line.startMs));
    out.push({ startMs: last, text });
  }
  if (out.length === 0) throw new TranscriptError("The transcript has no words in it.");
  return { format, lines: out, timed, numbersConverted };
}

// -----------------------------------------------------------------------------
// Several files for one game.
// -----------------------------------------------------------------------------

/**
 * Two transcripts are the same speech when this share of the shorter one's
 * four-word runs is in the other. Deepgram's JSON, text, .srt and .vtt of one
 * recording share nearly all of theirs; two stretches of one game share few,
 * however many names and football words they have in common.
 */
export const SAME_SPEECH_SHARE = 0.5;
/** The pause put between two parts of a game whose times both start at zero. */
export const PART_GAP_S = 2;

export interface NamedTranscript {
  name: string;
  transcript: Transcript;
}

export interface Combined {
  transcript: Transcript;
  /** The files whose lines were used, in the order they were joined. */
  used: string[];
  /** Files left out because another file held the same speech in a better format. */
  duplicates: string[];
}

/**
 * Every file dropped in for one game as one transcript. Files holding the same
 * speech (one recording downloaded as JSON, text and captions) count once, the
 * best of them used: Deepgram's JSON, then captions, then timed text, then
 * untimed. What is left are parts of the game, joined in file name order
 * ("part 2" before "part 10"); a part whose times start over is placed after
 * the one before it.
 */
export function combineTranscripts(files: readonly NamedTranscript[]): Combined {
  if (files.length === 0) throw new TranscriptError("No transcript file was given.");
  const runs = files.map((file) => fourWordRuns(file.transcript));

  // Group the files that hold the same speech.
  const group = files.map((_, index) => index);
  const root = (index: number): number => (group[index] === index ? index : (group[index] = root(group[index])));
  for (let a = 0; a < files.length; a++) {
    for (let b = a + 1; b < files.length; b++) if (sameSpeech(runs[a], runs[b])) group[root(b)] = root(a);
  }
  const groups = new Map<number, number[]>();
  files.forEach((_, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), index]));

  const best: NamedTranscript[] = [];
  const duplicates: string[] = [];
  for (const members of groups.values()) {
    const ranked = [...members].sort((a, b) => rank(files[b].transcript) - rank(files[a].transcript) || files[a].name.localeCompare(files[b].name));
    best.push(files[ranked[0]]);
    for (const index of ranked.slice(1)) duplicates.push(files[index].name);
  }
  best.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  const lines: TranscriptLine[] = [];
  for (const part of best) {
    const previous = lines[lines.length - 1];
    const first = part.transcript.lines[0];
    // A part that carries on the game's clock keeps its times; one that starts over goes after the last part.
    const shift = previous && first.startMs <= previous.startMs ? previous.startMs + spokenMs(previous.text) + PART_GAP_S * 1000 - first.startMs : 0;
    for (const line of part.transcript.lines) lines.push({ startMs: line.startMs + shift, text: line.text });
  }
  const format = best.length === 1 ? best[0].transcript.format : best.every((part) => part.transcript.format === best[0].transcript.format) ? best[0].transcript.format : "text";
  return {
    transcript: {
      format,
      lines,
      timed: best.every((part) => part.transcript.timed),
      numbersConverted: best.some((part) => part.transcript.numbersConverted),
    },
    used: best.map((part) => part.name),
    duplicates,
  };
}

function rank(transcript: Transcript): number {
  const format = { deepgram: 3, captions: 2, text: 1 }[transcript.format];
  return (transcript.timed ? 10 : 0) + format;
}

function fourWordRuns(transcript: Transcript): Set<string> {
  // Number words and digits are one thing here, so a file transcribed with numerals matches one without.
  const words = transcript.lines.flatMap((line) => numberWords(line.text).split(" "));
  const runs = new Set<string>();
  for (let i = 0; i + 4 <= words.length; i++) runs.add(words.slice(i, i + 4).join(" "));
  return runs;
}

function sameSpeech(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size === 0) return false;
  let shared = 0;
  for (const run of small) if (large.has(run)) shared++;
  return shared / small.size >= SAME_SPEECH_SHARE;
}

/**
 * A transcript as one plain text file, a line each with its time
 * ("[00:12:34.5] castellane keeps it"). readTranscript reads it back to the
 * same lines, so it is the one file kept for a game. One that had no times
 * gets none, so it is never taken for a timed one.
 */
export function transcriptText(transcript: Transcript): string {
  if (!transcript.timed) return transcript.lines.map((line) => line.text).join("\n") + "\n";
  const stamp = (ms: number) => {
    const tenths = Math.round(ms / 100);
    const hours = Math.floor(tenths / 36_000);
    const minutes = Math.floor((tenths % 36_000) / 600);
    const seconds = (tenths % 600) / 10;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
  };
  return transcript.lines.map((line) => `[${stamp(line.startMs)}] ${line.text}`).join("\n") + "\n";
}

// -----------------------------------------------------------------------------
// Deepgram's JSON.
// -----------------------------------------------------------------------------

interface Word {
  word: string;
  start: number;
  end: number;
}

function deepgramLines(json: unknown): { lines: TranscriptLine[]; timed: boolean } | null {
  // A list of lines someone already cut: [{ start, text }] or ["text", ...].
  if (Array.isArray(json)) return listLines(json);
  if (!isRecord(json)) return null;
  const results = isRecord(json.results) ? json.results : json;

  // utterances=true: Deepgram's own cut, each with its words.
  if (Array.isArray(results.utterances) && results.utterances.length > 0) {
    const lines: TranscriptLine[] = [];
    for (const utterance of results.utterances) {
      if (!isRecord(utterance)) continue;
      const words = wordsOf(utterance.words);
      if (words.length > 0) lines.push(...cutWords(words));
      else if (typeof utterance.transcript === "string" && typeof utterance.start === "number") {
        lines.push(...splitLong(utterance.transcript, utterance.start * 1000, typeof utterance.end === "number" ? utterance.end * 1000 : null));
      }
    }
    if (lines.length > 0) return { lines, timed: true };
  }

  const channels = Array.isArray(results.channels) ? results.channels : [];
  const alternative = isRecord(channels[0]) && Array.isArray(channels[0].alternatives) && isRecord(channels[0].alternatives[0]) ? channels[0].alternatives[0] : null;
  if (alternative) {
    const words = wordsOf(alternative.words);
    if (words.length > 0) return { lines: cutWords(words), timed: true };
    if (typeof alternative.transcript === "string" && alternative.transcript.trim()) return paced(alternative.transcript.split(/\n+/));
  }
  return null;
}

function listLines(list: unknown[]): { lines: TranscriptLine[]; timed: boolean } | null {
  if (list.every((item) => typeof item === "string")) return paced(list as string[]);
  const lines: TranscriptLine[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const text = typeof item.text === "string" ? item.text : typeof item.transcript === "string" ? item.transcript : null;
    const start = typeof item.start === "number" ? item.start * 1000 : typeof item.startMs === "number" ? item.startMs : null;
    if (text === null || start === null) return null;
    lines.push({ startMs: start, text });
  }
  return lines.length > 0 ? { lines, timed: true } : null;
}

function wordsOf(value: unknown): Word[] {
  if (!Array.isArray(value)) return [];
  const words: Word[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.word !== "string" || typeof item.start !== "number") continue;
    words.push({ word: item.word, start: item.start, end: typeof item.end === "number" ? item.end : item.start });
  }
  return words;
}

/** Words into final-sized lines: a new line at a pause, or when one runs too long. Uses `word`, which is what the live socket writes. */
function cutWords(words: Word[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length > 0) lines.push({ startMs: current[0].start * 1000, text: current.map((word) => word.word).join(" ") });
    current = [];
  };
  for (const word of words) {
    const previous = current[current.length - 1];
    if (
      previous &&
      (word.start - previous.end >= LINE_GAP_S || word.end - current[0].start > MAX_LINE_S || current.length >= MAX_LINE_WORDS)
    ) {
      flush();
    }
    current.push(word);
  }
  flush();
  return lines;
}

// -----------------------------------------------------------------------------
// Captions.
// -----------------------------------------------------------------------------

const CAPTION_TIME = /^\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;

function captionLines(source: string): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  let start: number | null = null;
  let end: number | null = null;
  let text: string[] = [];
  const flush = () => {
    if (start !== null && text.length > 0) lines.push(...splitLong(text.join(" "), start, end));
    start = null;
    end = null;
    text = [];
  };
  for (const row of source.split(/\r?\n/)) {
    const time = CAPTION_TIME.exec(row);
    if (time) {
      flush();
      start = clockMs(time[1]);
      end = clockMs(time[2]);
      continue;
    }
    if (row.trim() === "") {
      flush();
      continue;
    }
    // The cue number, the WEBVTT header and NOTE blocks are not speech.
    if (start === null) continue;
    text.push(row.replace(/<[^>]+>/g, " "));
  }
  flush();
  return lines;
}

// -----------------------------------------------------------------------------
// Plain text.
// -----------------------------------------------------------------------------

/** A time at the start of a line, bracketed or not, possibly the start of a range. */
const LEADING_TIME = /^\s*[[(]?\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*(?:(?:-->|-|–|to)\s*(?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)?\s*[\])]?\s*[:\-–]?\s*/;
/** "Speaker 0:", "[Speaker 1]", "Speaker 2 -": diarization labels, not speech. */
const SPEAKER = /^\s*[[(]?\s*speaker\s*\d+\s*[\])]?\s*[:\-–]?\s*/i;

function textLines(source: string): { lines: TranscriptLine[]; timed: boolean } {
  const rows = source.split(/\r?\n/).map((row) => row.trim()).filter((row) => row.length > 0);
  const parsed = rows.map((row) => {
    let rest = row.replace(SPEAKER, "");
    const time = LEADING_TIME.exec(rest);
    let startMs: number | null = null;
    if (time) {
      startMs = clockMs(time[1]);
      rest = rest.slice(time[0].length);
    }
    return { startMs, text: rest.replace(SPEAKER, "") };
  });
  const timedRows = parsed.filter((row) => row.startMs !== null).length;
  // A few stray times in a text that is mostly untimed are words, not a clock.
  if (timedRows === 0 || timedRows < parsed.length / 2) return paced(rows.map((row) => row.replace(SPEAKER, "")));

  const lines: TranscriptLine[] = [];
  let clock = 0;
  parsed.forEach((row, index) => {
    const next = parsed.slice(index + 1).find((later) => later.startMs !== null)?.startMs ?? null;
    const start = row.startMs ?? clock;
    const pieces = splitLong(row.text, start, next);
    lines.push(...pieces);
    const lastPiece = pieces[pieces.length - 1];
    clock = lastPiece ? lastPiece.startMs + spokenMs(lastPiece.text) + PAUSE_S * 1000 : start;
  });
  return { lines, timed: true };
}

/** Untimed text, spaced at a talking pace. Paragraphs are cut at sentence ends first, then by length. */
function paced(rows: string[]): { lines: TranscriptLine[]; timed: boolean } {
  const lines: TranscriptLine[] = [];
  let clock = 0;
  for (const row of rows) {
    for (const piece of pieces(row)) {
      lines.push({ startMs: clock, text: piece });
      clock += spokenMs(piece) + PAUSE_S * 1000;
    }
  }
  return { lines, timed: false };
}

/** One long stretch of text as several lines, its time shared out by words up to `endMs` (or a talking pace). */
function splitLong(text: string, startMs: number, endMs: number | null): TranscriptLine[] {
  const parts = pieces(text);
  const total = parts.reduce((sum, part) => sum + wordCount(part), 0);
  const span = endMs !== null && endMs > startMs ? endMs - startMs : (total / WORDS_PER_SECOND) * 1000;
  const lines: TranscriptLine[] = [];
  let done = 0;
  for (const part of parts) {
    lines.push({ startMs: startMs + (total > 0 ? (span * done) / total : 0), text: part });
    done += wordCount(part);
  }
  return lines;
}

function pieces(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.split(/\s+/).filter((word) => word.length > 0);
    for (let at = 0; at < words.length; at += MAX_LINE_WORDS) out.push(words.slice(at, at + MAX_LINE_WORDS).join(" "));
  }
  // Short sentences are one final together, as Deepgram would hear them.
  const merged: string[] = [];
  for (const piece of out) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && wordCount(previous) + wordCount(piece) <= MAX_LINE_WORDS / 2) merged[merged.length - 1] = `${previous} ${piece}`;
    else merged.push(piece);
  }
  return merged;
}

function spokenMs(text: string): number {
  return (wordCount(text) / WORDS_PER_SECOND) * 1000;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/** "1:02:03.5", "12:34", "00:00:01,250" in milliseconds. */
export function clockMs(clock: string): number {
  const parts = clock.replace(",", ".").split(":").map(Number);
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return Math.round(seconds * 1000);
}

// -----------------------------------------------------------------------------
// What the live socket writes.
// -----------------------------------------------------------------------------

/**
 * A line as Deepgram writes it with smart_format and punctuate off and
 * numerals on: lowercase, no punctuation, "14-7" as "14 7", "2:30" as "2 30",
 * "#22" as "number 22". When the whole file has no digits, number words are
 * written as digits ("third and eight" is "3rd and 8"), because the jersey
 * cue, the down and distance and the yard line checks all read digits.
 */
export function normalizeLine(text: string, convertNumbers: boolean): string {
  let line = text
    .replace(/<[^>]+>/g, " ")
    .replace(/#\s*(\d{1,3})\b/g, " number $1 ")
    .replace(/[‘’]/g, "'")
    .toLowerCase();
  // Between digits, a dash or colon is a gap; a point is a decimal and stays.
  line = line.replace(/(\d)[-:–](?=\d)/g, "$1 ").replace(/(\d)-(?=[a-z])/g, "$1 ").replace(/([a-z])-(?=\d)/g, "$1 ");
  line = line.replace(/(?<!\d)\.|\.(?!\d)/g, " ");
  // Keep letters, digits, apostrophes inside words, hyphens inside words and decimal points.
  line = line.replace(/[^\p{L}\p{N}'.\- ]+/gu, " ").replace(/(^|\s)['-]+|['-]+(?=\s|$)/g, " ");
  line = line.replace(/\s+/g, " ").trim();
  return convertNumbers ? numberWords(line) : line;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS: Record<string, string> = { first: "1st", second: "2nd", third: "3rd", fourth: "4th" };
/** "no one", "that one": a pronoun, not a number. */
const ONE_AS_PRONOUN = new Set(["no", "that", "this", "which", "each", "every", "any", "some", "the", "big", "last", "little"]);

/** Number words as digits: "twenty three" and "twenty-three" are 23, "one hundred" is 100, "third" is 3rd. */
export function numberWords(line: string): string {
  const words = line.split(" ").flatMap((word) => {
    const [a, b] = word.split("-");
    return b !== undefined && TENS[a] !== undefined && UNITS[b] !== undefined && UNITS[b] < 10 ? [a, b] : [word];
  });
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (ORDINALS[word]) {
      out.push(ORDINALS[word]);
      continue;
    }
    if (word === "one" && ONE_AS_PRONOUN.has(words[i - 1] ?? "")) {
      out.push(word);
      continue;
    }
    let value: number | null = null;
    if (TENS[word] !== undefined) {
      value = TENS[word];
      const next = UNITS[words[i + 1] ?? ""];
      if (next !== undefined && next > 0 && next < 10) {
        value += next;
        i++;
      }
    } else if (UNITS[word] !== undefined) {
      value = UNITS[word];
      if (words[i + 1] === "hundred") {
        value *= 100;
        i++;
      }
    }
    out.push(value === null ? word : String(value));
  }
  return out.join(" ");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
