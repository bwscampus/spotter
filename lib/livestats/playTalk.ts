import { isPlayBoundary } from "@/lib/plays/window";
import type { StatsRosterPlayer } from "./types";

// =============================================================================
// Whether anything said is worth asking Claude about (Jed, Oct 4: live stats
// cost about $2 a game, nearly all of it calls that read nothing).
//
// Every call costs about the same whether a play is in it or not, because
// both rosters ride along each time. So the loop asks only once something
// since the last call sounds like football: a down and distance, a name off
// either roster, a jersey cue, or a word plays are described with. Halftime,
// commercials and a crowd with nobody talking then cost nothing.
//
// Skipping a call loses nothing: the next one sends everything since the last
// play read (lib/plays/window.ts), so a play said in a skipped stretch is still
// in the window when the talk turns back to football. Pure, so the replay
// (scripts/replay-livestats.ts) asks exactly when a live game would.
// =============================================================================

// =============================================================================
// TUNING: what counts as football.
// =============================================================================

/**
 * Words a play is described with. Whole words, any case. Deliberately broad:
 * a call that reads nothing costs a third of a cent, a play never read costs
 * a stat. Numbers are left out, because `numerals=true` puts digits in every
 * score, clock and price in an advert.
 */
const PLAY_WORDS = [
  "tackl\\w*",
  "carr(?:y|ies|ied)",
  "rush\\w*",
  "runs?",
  "ran",
  "running",
  "pass(?:es|ed|ing)?",
  "throws?",
  "threw",
  "complet\\w*",
  "incomplet\\w*",
  "caught",
  "catch(?:es)?",
  "sack(?:s|ed)?",
  "intercept\\w*",
  "picked",
  "pick(?:s)?",
  "fumbl\\w*",
  "recover\\w*",
  "touchdowns?",
  "field goal",
  "extra point",
  "punt(?:s|ed|er)?",
  "kick(?:s|ed|er|off)?",
  "returns?",
  "returned",
  "yards?",
  "yard line",
  "gain(?:s|ed)?",
  "loss",
  "first down",
  "flags?",
  "penalty",
  "holding",
  "offsides?",
  "false start",
  "scrambl\\w*",
  "keeper",
  "hand ?off",
  "snap",
  "stopped",
  "brought down",
  "dragged down",
  "broken up",
  "broke up",
  "deflect\\w*",
  "safety",
  "two point",
  "end zone",
  "goal line",
  "touchback",
  "fair catch",
  "quarterback",
  "receiver",
  "defense",
  "offense",
];

/** Roster names shorter than this are left to the words above: "Li" is in too much else. */
const MIN_NAME_LETTERS = 3;

// =============================================================================

const PLAY_TALK = new RegExp(`\\b(?:${PLAY_WORDS.join("|")})\\b`, "i");

/** "number 22", or "#22" as it might be typed. Deepgram writes the number as digits. */
const JERSEY_CUE = /\b(?:number|numero|jersey)\s+\d{1,3}\b|#\d{1,3}\b/i;

/** Every surname on both rosters, and each part of a hyphenated or two-word one, lowercased. */
export function rosterNames(roster: readonly Pick<StatsRosterPlayer, "last">[]): Set<string> {
  const names = new Set<string>();
  for (const player of roster) {
    for (const part of player.last.toLowerCase().split(/[\s-]+/)) {
      const letters = part.replace(/[^\p{L}']/gu, "");
      if (letters.length >= MIN_NAME_LETTERS) names.add(letters);
    }
  }
  return names;
}

/** Whether a final sounds like football: worth a call to Claude once the gap allows one. */
export function isPlayTalk(text: string, names: ReadonlySet<string>): boolean {
  if (isPlayBoundary(text) || PLAY_TALK.test(text) || JERSEY_CUE.test(text)) return true;
  for (const word of text.toLowerCase().split(/[^\p{L}']+/u)) if (word && names.has(word)) return true;
  return false;
}
