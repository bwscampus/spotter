import { compileWatchlist, scoreAgainst } from "@/lib/matching/matcher";
import { COMMON_WORD_FORMS } from "./commonWords";

// =============================================================================
// Does this surname sound like an everyday word?
//
// Scored with the real matcher against the real thresholds, so what this
// reports is exactly what would happen in a live game. "Reilly" comes back
// close to "really"; "Ward" fires on "word" and "award".
// =============================================================================

/** A score this fraction of the threshold is close enough to warn about. */
export const CLOSE_RATIO = 0.9;

/** Words listed per verdict. Enough to make the problem obvious, short enough to read. */
const MAX_LISTED = 5;

export type HitVerdict = "would_fire" | "close";

export interface CommonWordHit {
  word: string;
  score: number;
  verdict: HitVerdict;
}

export interface CommonWordReport {
  /** The worst verdict found, or null when the name is clear. */
  verdict: HitVerdict | null;
  hits: CommonWordHit[];
}

// The review screen recomputes on every keystroke, and each call scores a few
// thousand words. Same surname, same answer, so keep the last few hundred.
const CACHE_LIMIT = 500;
const cache = new Map<string, CommonWordReport>();

const EMPTY: CommonWordReport = { verdict: null, hits: [] };

/**
 * Scores a player's spoken forms against every common word.
 *
 * Takes the forms rather than the player so it can be tested without building
 * a roster row.
 */
export function commonWordHits(forms: string[]): CommonWordReport {
  const usable = forms.filter((form) => form.length > 0);
  if (usable.length === 0) return EMPTY;

  const key = usable.join("|");
  const cached = cache.get(key);
  if (cached) return cached;

  // One watchlist entry for this player alone, compiled the way a game would.
  const [entry] = compileWatchlist([{ name: usable[0], aliases: usable.slice(1) }]);
  const hits: CommonWordHit[] = [];

  for (const word of COMMON_WORD_FORMS) {
    // A word that is one of the forms is the name itself, not a collision.
    if (usable.includes(word.text)) continue;
    const { score, minScore } = scoreAgainst(word.text, word.keys, entry);
    if (score >= minScore) {
      hits.push({ word: word.word, score, verdict: "would_fire" });
    } else if (score >= minScore * CLOSE_RATIO) {
      hits.push({ word: word.word, score, verdict: "close" });
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
