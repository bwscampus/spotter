import type { StatItem, StatLine } from "./lines";
import type { SeasonNumbers } from "./sportStats";

// =============================================================================
// Scoring keywords (Nov 15). An announcer's paper board has a player's season
// numbers and his prepped facts, and he wants the call to pick which one his
// card leads with: a scoring word beside a name ("goal Smith", "Smith shoots,
// scores", "assisted by Jones") leads with that player's scoring numbers, so
// he can say "that's her 12th of the year"; a name with no scoring word leads
// with the facts.
//
// This file is the one place to edit: the words per sport, the phrases that
// hold one of them but must never count, and which of a player's numbers are
// the scoring ones. A sport with no list (basketball, where a basket is said
// every few seconds, and every sport not named) has the feature off, and its
// cards are exactly what they were.
//
// Words are matched whole, against Deepgram's words, which arrive lowercase
// and unpunctuated. A phrase is its words in a row. Pure: lib/game/scoringCue.ts
// does the listening, the card only reads `scoringItems`' row.
// =============================================================================

// =============================================================================
// TUNING: the lists. Keep each phrase lowercase, words separated by one space.
// =============================================================================

/** The goal sports' words. */
const GOAL_WORDS = ["goal", "goals", "score", "scores", "scored", "assist", "assisted", "assisted by"] as const;

/** Phrases with a scoring word in them that are not a score. Checked in every sport that has a list. */
const NEVER_WORDS = [
  "no goal",
  "goal kick",
  "goalie",
  "goalkeeper",
  "goal line",
  "the score",
  "score is",
  "scoreless",
  "own goal",
] as const;

/** Each sport's scoring words, by the sport codes of lib/rosters/types.ts. A sport not here, or with an empty list, is off. */
export const SCORING_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  soccer: GOAL_WORDS,
  ice_hockey: GOAL_WORDS,
  lacrosse: GOAL_WORDS,
  water_polo: GOAL_WORDS,
  football: ["touchdown", "touchdown by", "scores"],
  // Too many baskets: it would fire on every other call.
  basketball: [],
  volleyball: ["ace", "kill"],
};

/** Each sport's phrases that never count, even though they hold a scoring word. */
export const NEVER_SCORING: Readonly<Record<string, readonly string[]>> = {
  soccer: NEVER_WORDS,
  ice_hockey: NEVER_WORDS,
  lacrosse: NEVER_WORDS,
  water_polo: NEVER_WORDS,
  football: NEVER_WORDS,
  volleyball: NEVER_WORDS,
};

/** How many words before a name (or a cued number) a scoring word may be. */
export const WORDS_BEFORE = 3;

/** How long after a name a scoring word may come, in seconds of audio, in the same result or a later one. */
export const SECONDS_AFTER = 3;

// =============================================================================

/** Whether keyword switching is on for this sport. */
export function scoringOn(sport: string | null | undefined): boolean {
  return (SCORING_KEYWORDS[sport ?? ""] ?? []).length > 0;
}

/** One scoring word or phrase found in a run of words: the phrase as listed, and the words it covers. */
export interface KeywordHit {
  phrase: string;
  first: number;
  last: number;
}

const phraseWords = (phrase: string) => phrase.split(" ");

/** A word as matched: lowercase letters and digits only, so "scores!" and "Scores" are "scores". */
export function matchWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** Every place `phrase` starts in `words` (already matchWord'd). */
function occurrences(words: readonly string[], phrase: string): Array<{ first: number; last: number }> {
  const parts = phraseWords(phrase);
  const found: Array<{ first: number; last: number }> = [];
  for (let start = 0; start + parts.length <= words.length; start++) {
    if (parts.every((part, offset) => words[start + offset] === part)) found.push({ first: start, last: start + parts.length - 1 });
  }
  return found;
}

/**
 * The scoring words in a run of words, for this sport. A word inside a phrase
 * that never counts ("no goal", "goal kick") is not one. Where two listed
 * phrases start on the same word ("assisted" and "assisted by"), the longer
 * is kept. In word order.
 */
export function keywordHits(words: readonly string[], sport: string | null | undefined): KeywordHit[] {
  const listed = SCORING_KEYWORDS[sport ?? ""] ?? [];
  if (listed.length === 0) return [];
  const clean = words.map(matchWord);
  const vetoed = new Set<number>();
  for (const phrase of NEVER_SCORING[sport ?? ""] ?? []) {
    for (const span of occurrences(clean, phrase)) for (let index = span.first; index <= span.last; index++) vetoed.add(index);
  }
  const byStart = new Map<number, KeywordHit>();
  for (const phrase of listed) {
    for (const span of occurrences(clean, phrase)) {
      let covered = false;
      for (let index = span.first; index <= span.last; index++) if (vetoed.has(index)) covered = true;
      if (covered) continue;
      const before = byStart.get(span.first);
      if (!before || before.last < span.last) byStart.set(span.first, { phrase, ...span });
    }
  }
  return [...byStart.values()].sort((a, b) => a.first - b.first);
}

// =============================================================================
// The scoring row: which numbers are a player's scoring ones, per sport.
// Hockey and soccer: goals, assists, points. Football: touchdowns scored, and a
// passer's touchdown passes (Jed, Nov 15: touchdowns only, never worked-out
// points, because two-point tries and safeties are not saved). Volleyball:
// kills and aces. Lacrosse and water polo save written lines, so their goals,
// assists and points are read out of those lines.
// =============================================================================

/** The touchdowns a football player scored himself: every kind but the ones he threw. */
const SCORED_TD_KEYS = ["rush_td", "rec_td", "int_td", "fr_td", "kr_td", "pr_td"] as const;

function positive(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function count(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : (Math.round(value * 10) / 10).toLocaleString("en-US");
}

function item(value: number, label: string): StatItem {
  return { value: count(value), label, estimated: false, group: 0 };
}

/** Goals, assists and points as a broadcast graphic says them, any of them missing left out. */
function goalsLine(goals: number | null, assists: number | null, points: number | null): StatLine {
  return [
    ...(goals ? [item(goals, "G")] : []),
    ...(assists ? [item(assists, "A")] : []),
    ...(points ? [item(points, "PTS")] : []),
  ];
}

/**
 * "12 goals", "Goals: 12", "12 G": the number for a stat, from written lines,
 * the first one found. Words match in any case; a one-letter label only in
 * capitals and only after its number ("12 G"), so "2 a game" is not assists.
 */
function writtenNumber(lines: readonly string[], words: string, letter: string): number | null {
  const patterns = [
    new RegExp(`(\\d+)\\s*(?:${words})\\b`, "i"),
    new RegExp(`\\b(?:${words})\\s*[:=]\\s*(\\d+)`, "i"),
    new RegExp(`(\\d+)\\s*${letter}\\b`),
  ];
  for (const line of lines) {
    // "1,204" as written: commas inside a number go first.
    const text = line.replace(/(\d),(\d{3})\b/g, "$1$2");
    for (const pattern of patterns) {
      const found = pattern.exec(text);
      const value = found ? Number(found[1]) : NaN;
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

/**
 * The scoring view's row for a player: their scoring numbers, in the order
 * they are said, or empty when they have none (the scoring view is then the
 * normal card, never an empty row). `sheet` is the player's numbers for a
 * number sport; `written` their saved lines for any other.
 */
export function scoringItems(sport: string | null | undefined, sheet: SeasonNumbers | null, written: readonly string[]): StatLine {
  if (!scoringOn(sport)) return [];
  if (sport === "ice_hockey") {
    if (!sheet) return [];
    const goals = positive(sheet.h_goals);
    const assists = positive(sheet.h_assists);
    return goalsLine(goals, assists, positive(sheet.h_points) ?? (goals || assists ? (goals ?? 0) + (assists ?? 0) : null));
  }
  if (sport === "soccer") {
    if (!sheet) return writtenGoals(written);
    const goals = positive(sheet.s_goals);
    const assists = positive(sheet.s_assists);
    const line = goalsLine(goals, assists, positive(sheet.s_points) ?? (goals || assists ? 2 * (goals ?? 0) + (assists ?? 0) : null));
    // A soccer team saved before Nov 7 still has written lines.
    return line.length > 0 ? line : writtenGoals(written);
  }
  if (sport === "lacrosse" || sport === "water_polo") return writtenGoals(written);
  if (sport === "volleyball") {
    if (!sheet) return [];
    const kills = positive(sheet.kills);
    const aces = positive(sheet.aces);
    return [...(kills ? [item(kills, "kills")] : []), ...(aces ? [item(aces, "aces")] : [])];
  }
  if (sport === "football") {
    if (!sheet) return [];
    const scored = SCORED_TD_KEYS.reduce((total, key) => total + (positive(sheet[key]) ?? 0), 0);
    const thrown = positive(sheet.pass_td);
    return [...(scored > 0 ? [item(scored, "TD")] : []), ...(thrown ? [item(thrown, "pass TD")] : [])];
  }
  return [];
}

function writtenGoals(written: readonly string[]): StatLine {
  return goalsLine(
    writtenNumber(written, "goals|goal", "G"),
    writtenNumber(written, "assists|assist|ast", "A"),
    writtenNumber(written, "points|pts", "P"),
  );
}
