import type { PlayUtterance } from "@/lib/plays/types";
import { nameIndex, namedIn, wordList } from "./names";
import type { StatsRosterPlayer } from "./types";

// =============================================================================
// A second look at a quiet window (Oct 11, Part 5). Most of the reader's
// remaining misses were short runs the booth did describe, in windows that
// came back with no play. When a call returns nothing and its new lines (not
// the overlap) name a roster player within a few words of a football action
// word, the loop asks once more about just those lines, with a one-line note
// that they may describe a play. At most one second look per window, and
// SECOND_LOOKS_PER_GAME a game, so a talkative booth cannot double the cost.
// Whatever comes back goes through the same checks as any read, and each play
// it adds is noted with rule R38. Pure.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/**
 * How many words apart a roster surname and an action word may be and still
 * look like one clause about a play: "<name> off the left side slips a
 * tackle" is seven, and a booth rarely puts more description than that
 * between the runner and what he did.
 */
export const SECOND_LOOK_WORD_SPAN = 8;

/**
 * Most second looks in one game. A game makes 150 to 250 reader calls, so
 * this adds at most about a quarter to them, and the quiet windows worth a
 * second look come early in a drive, not every minute.
 */
export const SECOND_LOOKS_PER_GAME = 40;

/** A short, general list of the words a play is described with. Whole words. */
export const ACTION_WORDS = [
  "run",
  "runs",
  "ran",
  "running",
  "carry",
  "carries",
  "carried",
  "handoff",
  "keeps",
  "keeper",
  "scramble",
  "scrambles",
  "catch",
  "catches",
  "caught",
  "throws",
  "throw",
  "threw",
  "pass",
  "passes",
  "sacked",
  "sack",
  "tackled",
  "tackle",
  "intercepted",
  "interception",
  "punt",
  "punts",
  "kick",
  "kicks",
  "field",
  "touchdown",
  "fumble",
  "fumbles",
] as const;

// =============================================================================

const ACTION = new Set<string>(ACTION_WORDS);

/** Whether one line names a roster player within SECOND_LOOK_WORD_SPAN words of an action word. */
export function soundsLikeAPlay(text: string, roster: readonly StatsRosterPlayer[], aliases?: ReadonlyMap<string, readonly string[]>): boolean {
  const words = wordList(text);
  const actions = words.map((word, index) => (ACTION.has(word) ? index : -1)).filter((index) => index >= 0);
  if (actions.length === 0) return false;
  const index = nameIndex(roster);
  for (const player of roster) {
    if (!namedIn(player, text, index, aliases?.get(player.playerId) ?? player.aliases ?? [])) continue;
    // Where the name sits: the word the player's surname (or a close spelling) is, by the same test one word at a time.
    for (let at = 0; at < words.length; at++) {
      if (!namedIn(player, words[at], index, aliases?.get(player.playerId) ?? player.aliases ?? [])) continue;
      if (actions.some((action) => Math.abs(action - at) <= SECOND_LOOK_WORD_SPAN)) return true;
    }
  }
  return false;
}

/**
 * The lines to ask about again, or null: the window's new lines that sound
 * like a play, with one line each side inside the window so the clause is
 * not cut off. `newFrom` is the first seq the reader had not seen before this
 * window (the line after what was read through); the overlap before it was
 * read already.
 */
export function secondLookLines(
  window: readonly PlayUtterance[],
  newFrom: number,
  roster: readonly StatsRosterPlayer[],
  aliases?: ReadonlyMap<string, readonly string[]>,
): PlayUtterance[] | null {
  const hits = window.map((line, index) => (line.seq >= newFrom && soundsLikeAPlay(line.text, roster, aliases) ? index : -1)).filter((index) => index >= 0);
  if (hits.length === 0) return null;
  const from = Math.max(0, hits[0] - 1);
  const to = Math.min(window.length - 1, hits[hits.length - 1] + 1);
  return window.slice(from, to + 1);
}
