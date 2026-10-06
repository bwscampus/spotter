import { compileWatchlist, scanWords } from "@/lib/matching/matcher";
import type { DeepgramWord } from "@/lib/deepgram/config";
import { COMMON_PHRASES } from "./commonPhrases";
import { CLOSE_RATIO, type CommonWordHit, type CommonWordReport } from "./commonWordHits";

// =============================================================================
// Does this surname sound like something said during play?
//
// Each phrase goes through scanWords, the function that scores every live
// utterance, as if Deepgram had just returned it with full confidence. That is
// the real matcher and the real thresholds, joined words and all, so a hit here
// is a card that would have gone up: "long" fires Longhi, "are gonna" and
// "oregon" fire Aragon, and "be sick" comes close on Piesik.
//
// Unlike commonWordHits, a phrase that is the surname itself still counts. A
// player named Lane really does go up every time someone says "passing lane".
// =============================================================================

const MAX_LISTED = 5;

/** Each phrase as the words Deepgram would return. Built once. */
const PHRASE_WORDS: Array<{ phrase: string; words: DeepgramWord[] }> = COMMON_PHRASES.map((phrase) => ({
  phrase,
  words: phrase
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({ word, punctuated_word: word, start: index, end: index + 1, confidence: 1 })),
}));

const CACHE_LIMIT = 500;
const cache = new Map<string, CommonWordReport>();
const EMPTY: CommonWordReport = { verdict: null, hits: [] };

/** Scores a player's spoken forms against every common phrase. */
export function commonPhraseHits(forms: string[]): CommonWordReport {
  const usable = forms.filter((form) => form.length > 0);
  if (usable.length === 0) return EMPTY;

  const key = usable.join("|");
  const cached = cache.get(key);
  if (cached) return cached;

  const entries = compileWatchlist([{ name: usable[0], aliases: usable.slice(1) }]);
  const hits: CommonWordHit[] = [];

  for (const { phrase, words } of PHRASE_WORDS) {
    const { matches, nearMisses } = scanWords(words, entries);
    if (matches.length > 0) {
      hits.push({ word: phrase, score: Math.max(...matches.map((m) => m.score)), verdict: "would_fire" });
      continue;
    }
    const close = nearMisses.filter((miss) => miss.score >= miss.minScore * CLOSE_RATIO);
    if (close.length > 0) {
      hits.push({ word: phrase, score: Math.max(...close.map((m) => m.score)), verdict: "close" });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const fires = hits.filter((hit) => hit.verdict === "would_fire");
  const report: CommonWordReport = {
    verdict: fires.length > 0 ? "would_fire" : hits.length > 0 ? "close" : null,
    hits: (fires.length > 0 ? fires : hits).slice(0, MAX_LISTED),
  };

  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, report);
  return report;
}
