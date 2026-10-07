import { doubleMetaphone } from "double-metaphone";
import { distance } from "fastest-levenshtein";
import type { DeepgramWord } from "@/lib/deepgram/config";
import type { WatchlistEntry } from "@/lib/watchlist";

// =============================================================================
// TUNING: every knob that decides whether a spoken word fires a name.
// Scores run 0 to 1. Before changing a threshold, export the CSV and look at the
// near_miss rows (what almost fired) next to the match rows (what did).
// =============================================================================

/** Deepgram's per-word confidence floor. Words below it are ignored entirely. */
export const MIN_CONFIDENCE = 0.5;

/** Score a word needs to fire a name of 4 or more letters. */
export const MIN_MATCH_SCORE = 0.85;

/** Names with fewer letters than this are short ("Lin"). */
export const SHORT_NAME_LETTERS = 4;

/**
 * Short names sound like common words ("line" and "lean" score 0.9 against
 * "Lin"), so they need a much higher score and confidence, and must be one
 * whole Deepgram word: never joined fragments, never part of a longer word.
 * For a short word, 0.95 means the exact spelling of the name or an alias.
 */
export const SHORT_NAME_MIN_MATCH_SCORE = 0.95;
export const SHORT_NAME_MIN_CONFIDENCE = 0.7;

/**
 * A name or alias whose Double Metaphone key has this many sounds or fewer
 * (Chien and chin are "XN", kuji is "KJ") shares its sound with everyday words
 * ("chain", "shin", "koji"). Matching against it also needs
 * SHORT_NAME_MIN_MATCH_SCORE, even when the name itself is long.
 */
export const SHORT_KEY_SOUNDS = 2;

/** Phonetic similarity (Double Metaphone) weighs more than spelling (Levenshtein). Sum to 1. */
export const PHONETIC_WEIGHT = 0.6;
export const SPELLING_WEIGHT = 0.4;

/** Log a near miss when a word scores at least this fraction of its threshold without firing. */
export const NEAR_MISS_RATIO = 0.6;

/** The same name again within this window refreshes its timestamp but does not re-trigger the display. */
export const REPEAT_SUPPRESSION_MS = 4000;

/**
 * A long name can come back split ("fuku ji", "foo koo gee"). Up to this many
 * adjacent words are joined and scored as one, but only when every one of them
 * is a short fragment of at most MAX_FRAGMENT_LETTERS letters.
 */
export const MAX_JOINED_WORDS = 3;
export const MAX_FRAGMENT_LETTERS = 5;

// =============================================================================

type PhoneticKeys = [string, string];

interface CompiledForm {
  text: string;
  keys: PhoneticKeys;
  minScore: number;
}

export interface CompiledEntry {
  name: string;
  isShort: boolean;
  minConfidence: number;
  /** The name and every alias, normalized, with precomputed keys and thresholds. */
  forms: CompiledForm[];
}

export interface Candidate {
  name: string;
  /** The transcript word(s) that scored, as Deepgram spelled them. */
  word: string;
  score: number;
  /** Threshold of the name or alias this candidate was scored against. */
  minScore: number;
  /** Lowest Deepgram confidence among the scored words. */
  confidence: number;
  /** Audio time in seconds, relative to the start of the Deepgram connection. */
  start: number;
  firstIndex: number;
  lastIndex: number;
}

export interface Scan {
  matches: Candidate[];
  nearMisses: Candidate[];
}

export interface FormScore {
  score: number;
  minScore: number;
}

/** Lowercase letters only: accents folded, possessive "'s" dropped. */
export function normalizeWord(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]s$/, "")
    .replace(/[^a-z]/g, "");
}

export function phoneticKeys(text: string): PhoneticKeys {
  return doubleMetaphone(text);
}

export function compileWatchlist(watchlist: WatchlistEntry[]): CompiledEntry[] {
  return watchlist.map((entry) => {
    const isShort = normalizeWord(entry.name).length < SHORT_NAME_LETTERS;
    const texts = new Set(
      [entry.name, ...entry.aliases]
        .map((alias) => alias.split(/\s+/).map(normalizeWord).join(""))
        .filter(Boolean),
    );
    return {
      name: entry.name,
      isShort,
      minConfidence: isShort ? SHORT_NAME_MIN_CONFIDENCE : MIN_CONFIDENCE,
      forms: [...texts].map((text) => {
        const keys = phoneticKeys(text);
        const shortKey = Math.max(keys[0].length, keys[1].length) <= SHORT_KEY_SOUNDS;
        return { text, keys, minScore: isShort || shortKey ? SHORT_NAME_MIN_MATCH_SCORE : MIN_MATCH_SCORE };
      }),
    };
  });
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 0 : 1 - distance(a, b) / longest;
}

function phoneticSimilarity(a: PhoneticKeys, b: PhoneticKeys): number {
  let best = 0;
  for (const x of a) {
    for (const y of b) {
      if (!x || !y) continue;
      if (x === y) return 1;
      best = Math.max(best, similarity(x, y));
    }
  }
  return best;
}

/** Scores a normalized candidate against each of an entry's forms; keeps the one clearing its threshold by most. */
export function scoreAgainst(text: string, keys: PhoneticKeys, entry: CompiledEntry): FormScore {
  let bestScore = 0;
  let bestMinScore = MIN_MATCH_SCORE;
  let bestMargin = -Infinity;
  for (const form of entry.forms) {
    const score =
      PHONETIC_WEIGHT * phoneticSimilarity(keys, form.keys) + SPELLING_WEIGHT * similarity(text, form.text);
    if (score - form.minScore > bestMargin) {
      bestMargin = score - form.minScore;
      bestScore = score;
      bestMinScore = form.minScore;
    }
  }
  return { score: bestScore, minScore: bestMinScore };
}

function overlaps(a: Candidate, b: Candidate): boolean {
  return a.firstIndex <= b.lastIndex && b.firstIndex <= a.lastIndex;
}

const byMarginDesc = (a: Candidate, b: Candidate) => b.score - b.minScore - (a.score - a.minScore);
const byStart = (a: Candidate, b: Candidate) => a.start - b.start;

/**
 * Scores every word of a transcript fragment (and short runs of adjacent
 * fragments) against the watchlist. Candidates are always whole Deepgram words,
 * never a substring of one. Synchronous: runs on every result in the hot path.
 */
export function scanWords(words: DeepgramWord[], entries: CompiledEntry[]): Scan {
  const above: Candidate[] = [];
  const below: Candidate[] = [];
  let confidenceFloor = 1;
  for (const entry of entries) confidenceFloor = Math.min(confidenceFloor, entry.minConfidence);

  for (let first = 0; first < words.length; first++) {
    let joined = "";
    let confidence = 1;
    let allFragments = true;

    for (let last = first; last < words.length && last - first < MAX_JOINED_WORDS; last++) {
      const part = normalizeWord(words[last].word);
      const wordCount = last - first + 1;
      confidence = Math.min(confidence, words[last].confidence);
      allFragments &&= part.length <= MAX_FRAGMENT_LETTERS;
      joined += part;

      if (confidence < confidenceFloor || (wordCount > 1 && !allFragments)) break;
      if (!joined) continue;

      const keys = phoneticKeys(joined);
      for (const entry of entries) {
        if (wordCount > 1 && entry.isShort) continue;
        if (confidence < entry.minConfidence) continue;
        const { score, minScore } = scoreAgainst(joined, keys, entry);
        if (score < minScore * NEAR_MISS_RATIO) continue;
        const candidate: Candidate = {
          name: entry.name,
          word: words
            .slice(first, last + 1)
            .map((w) => w.word)
            .join(" "),
          score,
          minScore,
          confidence,
          start: words[first].start,
          firstIndex: first,
          lastIndex: last,
        };
        (score >= minScore ? above : below).push(candidate);
      }
    }
  }

  // The clearest match wins when candidates share words.
  const matches: Candidate[] = [];
  for (const candidate of above.sort(byMarginDesc)) {
    if (!matches.some((m) => overlaps(m, candidate))) matches.push(candidate);
  }

  const nearMisses: Candidate[] = [];
  for (const candidate of below.sort(byMarginDesc)) {
    if (matches.some((m) => overlaps(m, candidate))) continue;
    if (nearMisses.some((n) => n.name === candidate.name && overlaps(n, candidate))) continue;
    nearMisses.push(candidate);
  }

  return { matches: matches.sort(byStart), nearMisses: nearMisses.sort(byStart) };
}
