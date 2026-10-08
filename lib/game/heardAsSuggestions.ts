import type { StoredRecord } from "@/lib/log/records";
import { compileWatchlist, normalizeWord, phoneticKeys, scoreAgainst } from "@/lib/matching/matcher";
import { COMMON_PHRASES } from "@/lib/rosters/commonPhrases";
import { COMMON_WORDS } from "@/lib/rosters/commonWords";
import { cardsFor, type WatchlistEntry } from "@/lib/watchlist";

// =============================================================================
// Learning from the last game (Oct 4): the words Deepgram wrote three or more
// times that are on neither roster, are not everyday words, and sound close to
// one roster name. "fafitaga, 30 times: add to FIFITA?" Everything here reads
// the browser log and nothing leaves the browser but the forms accepted.
//
// Scored with the real matcher so "close" means what a live game means by it,
// at a lower bar than a card needs (SUGGEST_RATIO), because these are exactly
// the words that did not reach it.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Written fewer times than this is a one-off, not a habit. */
export const MIN_TIMES = 3;

/** Shorter words are filler the matcher would not fire on anyway. */
export const MIN_LETTERS = 3;

/** A word is close to a name when it scores this fraction of the name's threshold. */
export const SUGGEST_RATIO = 0.6;

/** The nearest name must lead the next by this much, or the word is nobody's. */
export const SUGGEST_CLEAR_MARGIN = 0.1;

/** Enough to show the habits, short enough to act on. */
export const MAX_SUGGESTIONS = 12;

// =============================================================================

export interface SuggestedPlayer {
  side: "H" | "A";
  jersey: string | null;
  first_name: string | null;
  last_name: string;
}

export interface HeardAsSuggestion {
  /** The word as Deepgram wrote it, normalized. */
  word: string;
  times: number;
  /** The watchlist entry (surname) it sounds like, and its label ("Marlowe #11 · #24"). */
  entry: string;
  label: string;
  /** Every player of that entry: the form is written onto each of them. */
  players: SuggestedPlayer[];
  score: number;
}

/**
 * The suggestions for one game's log. Needs the log's newest game record for
 * the rosters; a log without one, or without utterances, gives none.
 */
export function suggestHeardAs(records: readonly StoredRecord[]): HeardAsSuggestion[] {
  const game = [...records].reverse().find((record) => record.kind === "game");
  if (!game || game.kind !== "game") return [];
  const entries = game.snapshot.watchlist;
  if (entries.length === 0) return [];

  const known = knownWords(entries, [game.snapshot.home.name, game.snapshot.away.name], game.snapshot.teamCues.flatMap((cue) => cue.words), game.snapshot.keyterms);
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.kind !== "utterance") continue;
    for (const raw of record.text.split(/\s+/)) {
      const word = normalizeWord(raw);
      if (word.length < MIN_LETTERS || known.has(word) || COMMON.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  const compiled = compileWatchlist(entries);
  const suggestions: HeardAsSuggestion[] = [];
  for (const [word, times] of counts) {
    if (times < MIN_TIMES) continue;
    const keys = phoneticKeys(word);
    const scored = compiled
      .map((entry, index) => {
        const { score, minScore } = scoreAgainst(word, keys, entry);
        return { index, score, minScore };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score < best.minScore * SUGGEST_RATIO) continue;
    const next = scored[1];
    if (next && best.score - next.score < SUGGEST_CLEAR_MARGIN) continue;
    const entry = entries[best.index];
    suggestions.push({
      word,
      times,
      entry: entry.name,
      label: entry.label ?? entry.name,
      players: cardsFor(entry).map((player) => ({
        side: player.side,
        jersey: player.jersey,
        first_name: player.first_name,
        last_name: player.last_name,
      })),
      score: best.score,
    });
  }

  return suggestions.sort((a, b) => b.times - a.times || b.score - a.score || (a.word < b.word ? -1 : 1)).slice(0, MAX_SUGGESTIONS);
}

const COMMON = new Set([...COMMON_WORDS, ...COMMON_PHRASES].flatMap((word) => word.split(/\s+/).map(normalizeWord)).filter(Boolean));

/** Every word that is already a name on either roster, or a team's word: never a suggestion. */
function knownWords(entries: readonly WatchlistEntry[], teamNames: string[], cueWords: string[], keyterms: string[]): Set<string> {
  const words = new Set<string>();
  const add = (text: string | null | undefined) => {
    for (const raw of (text ?? "").split(/[\s-]+/)) {
      const word = normalizeWord(raw);
      if (word) words.add(word);
    }
    const joined = normalizeWord((text ?? "").replace(/[\s-]+/g, ""));
    if (joined) words.add(joined);
  };
  for (const entry of entries) {
    add(entry.name);
    for (const alias of entry.aliases) add(alias);
    for (const player of entry.players ?? []) {
      add(player.first_name);
      add(player.last_name);
      add(player.pronunciation);
    }
  }
  for (const text of [...teamNames, ...cueWords, ...keyterms]) add(text);
  return words;
}
