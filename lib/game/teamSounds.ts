import type { DeepgramWord } from "@/lib/deepgram/config";
import { compileWatchlist, scanWords } from "@/lib/matching/matcher";
import { CLOSE_RATIO, type CommonWordHit, type HitVerdict } from "@/lib/rosters/commonWordHits";
import type { WatchlistEntry } from "@/lib/watchlist";

// =============================================================================
// Does a player's name sound like either team?
//
// On Sept 25 "Estancia" kept putting up Ossuetta: an announcer says each
// school's name and mascot all game long, so a surname that sounds like one of
// them goes up every time. This can only be checked at game setup, because
// that is the first time both schools are known.
//
// Scored the way commonPhraseHits scores play-by-play: each school and mascot
// phrase goes through scanWords, the function that scores every live utterance,
// as if Deepgram had just returned it with full confidence. Real matcher, real
// thresholds, joined words and all, so a hit here is a card that would go up.
// Warning only: nothing on the live path reads this (docs/V3_DEFINITION.md 7.3).
// =============================================================================

/** Words that name no team on their own: "Brentwood High School" is also said "Brentwood". */
const IGNORED_WORDS = new Set([
  "high",
  "school",
  "academy",
  "prep",
  "preparatory",
  "hs",
  "college",
  "the",
  "a",
  "an",
  "and",
  "of",
  "st",
  "saint",
  "team",
  "boys",
  "girls",
  "varsity",
]);

/** Words shorter than this are not said as a team name. Matches teamCues. */
const MIN_WORD_LETTERS = 3;

/** Phrases listed per player. Enough to see the problem. */
const MAX_LISTED = 3;

export interface TeamSource {
  school: string;
  mascot: string | null;
}

export interface TeamSoundWarning {
  /** The watchlist entry, as the setup screen names it. */
  name: string;
  verdict: HitVerdict;
  /** The school or mascot phrases it sounds like, worst first. */
  hits: CommonWordHit[];
}

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0);
}

/**
 * Everything an announcer says to name a team: the whole school name, the whole
 * mascot, each meaningful word of either, and a plural mascot's singular.
 */
export function teamPhrases(teams: TeamSource[]): string[] {
  const phrases: string[] = [];
  const add = (parts: string[]) => {
    const phrase = parts.join(" ");
    if (phrase.length > 0 && !phrases.includes(phrase)) phrases.push(phrase);
  };

  for (const team of teams) {
    for (const [source, isMascot] of [
      [team.school, false],
      [team.mascot ?? "", true],
    ] as const) {
      const all = words(source);
      const meaningful = all.filter((word) => !IGNORED_WORDS.has(word) && word.length >= MIN_WORD_LETTERS);
      if (meaningful.length === 0) continue;
      if (all.length > 1) add(all);
      if (meaningful.length > 1) add(meaningful);
      for (const word of meaningful) {
        add([word]);
        // "Eagles" is said as often as "Eagle". Only a mascot: "Francis" is not a plural.
        if (isMascot && word.endsWith("s") && word.length > MIN_WORD_LETTERS) add([word.slice(0, -1)]);
      }
    }
  }
  return phrases;
}

/**
 * The team words worth boosting as Deepgram keyterms (Oct 4: "Rutgers" came
 * back as Wortman ten times): each school and mascot as typed, and each
 * meaningful word of either on its own. No singular stems; those are for the
 * matcher's warning, not for Deepgram.
 */
export function teamKeyterms(teams: TeamSource[]): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const trimmed = term.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) return;
    seen.add(key);
    terms.push(trimmed);
  };
  for (const team of teams) {
    for (const source of [team.school, team.mascot ?? ""]) {
      const tokens = source.split(/[^\p{L}'’]+/u).filter((token) => token.length > 0);
      const meaningful = tokens.filter((token) => {
        const word = words(token)[0] ?? "";
        return word.length >= MIN_WORD_LETTERS && !IGNORED_WORDS.has(word);
      });
      if (meaningful.length === 0) continue;
      if (tokens.length > 1) add(source);
      for (const token of meaningful) add(token);
    }
  }
  return terms;
}

/** A phrase as the words Deepgram would return, at full confidence. */
function asResult(phrase: string): DeepgramWord[] {
  return phrase
    .split(" ")
    .map((word, index) => ({ word, punctuated_word: word, start: index, end: index + 1, confidence: 1 }));
}

/**
 * Every player whose name would fire, or come close to firing, on either
 * school's name or mascot. Takes the game's watchlist, so players set to "off"
 * (who can never put a card up) are already out of it.
 */
export function teamSoundWarnings(teams: TeamSource[], entries: WatchlistEntry[]): TeamSoundWarning[] {
  const phrases = teamPhrases(teams).map((phrase) => ({ phrase, words: asResult(phrase) }));
  if (phrases.length === 0) return [];

  const warnings: TeamSoundWarning[] = [];
  for (const entry of entries) {
    // One entry at a time, compiled the way a game would compile it, so each
    // phrase is scored against this player and nobody else.
    const compiled = compileWatchlist([entry]);
    const hits: CommonWordHit[] = [];

    for (const { phrase, words: said } of phrases) {
      const { matches, nearMisses } = scanWords(said, compiled);
      if (matches.length > 0) {
        hits.push({ word: phrase, score: Math.max(...matches.map((m) => m.score)), verdict: "would_fire" });
        continue;
      }
      const close = nearMisses.filter((miss) => miss.score >= miss.minScore * CLOSE_RATIO);
      if (close.length > 0) {
        hits.push({ word: phrase, score: Math.max(...close.map((m) => m.score)), verdict: "close" });
      }
    }

    if (hits.length === 0) continue;
    hits.sort((a, b) => b.score - a.score);
    const fires = hits.filter((hit) => hit.verdict === "would_fire");
    warnings.push({
      name: entry.label || entry.name,
      verdict: fires.length > 0 ? "would_fire" : "close",
      hits: (fires.length > 0 ? fires : hits).slice(0, MAX_LISTED),
    });
  }

  // Would-fire first: those are cards that will go up, not cards that might.
  return warnings.sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === "would_fire" ? -1 : 1));
}
