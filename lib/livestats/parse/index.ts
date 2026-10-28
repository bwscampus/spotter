import type { Side, StatsRosterPlayer, TeamWords } from "../types";
import { parseDownDistanceWords, type DownDistance } from "./downDistance";
import { buildNameIndex, nameHits, type NameHit, type PhoneticIndex } from "./names";
import { parseNumbers, type NumberToken } from "./numbers";
import { playCues, type PlayCues } from "./playWords";
import { parseSpotsWords, type SpotMention } from "./spots";
import { tokenize } from "./tokens";

// =============================================================================
// One transcript line, parsed (v7, Part 2): its words, the down and distance
// it calls, the yard lines it names, the play words in it, the players it
// names and every number. Pure and synchronous, on the hot path's budget
// (under 5 ms a line; test/parse/benchmark.test.ts holds it), because the
// loop parses every Deepgram final as it lands and the segmenter reads the
// result at once. Nothing here reaches the network, the log or the cards.
// =============================================================================

export interface ParsedLine {
  seq: number;
  text: string;
  words: string[];
  dd: DownDistance | null;
  spots: SpotMention[];
  cues: PlayCues;
  nameHits: NameHit[];
  numbers: NumberToken[];
}

export interface ParseContext {
  /** Both rosters' names, built once (buildNameIndex). */
  names: PhoneticIndex;
  teams?: TeamWords | null;
  /** Who has the ball, when the state knows, so "bulldogs 40" can be a half. */
  offense?: Side | null;
  /** Words that never count as a near miss of a surname: the team words (teamStopWords). */
  stop?: ReadonlySet<string>;
}

/** A context for a roster, with the index built. */
export function parseContextFor(roster: readonly StatsRosterPlayer[], teams: TeamWords | null = null, offense: Side | null = null): ParseContext {
  return { names: buildNameIndex(roster), teams, offense, stop: teamStopWords(teams) };
}

/** The words that name the teams: never a near miss of a player's surname. */
export function teamStopWords(teams: TeamWords | null | undefined): Set<string> {
  const stop = new Set<string>();
  if (!teams) return stop;
  for (const side of ["home", "away"] as const) for (const phrase of teams[side].phrases) for (const word of phrase.split(" ")) if (word) stop.add(word);
  return stop;
}

export function parseLine(text: string, context: ParseContext, seq = 0): ParsedLine {
  const words = tokenize(text);
  const numbers = parseNumbers(words);
  return {
    seq,
    text,
    words,
    dd: parseDownDistanceWords(words, 0, numbers),
    spots: parseSpotsWords(words, { teams: context.teams, offense: context.offense }, numbers),
    cues: playCues(text),
    nameHits: nameHits(words, context.names, context.stop),
    numbers,
  };
}

export type { DownDistance } from "./downDistance";
export type { NameHit, PhoneticIndex } from "./names";
export type { NumberToken } from "./numbers";
export type { PlayCues } from "./playWords";
export type { SpotMention } from "./spots";
