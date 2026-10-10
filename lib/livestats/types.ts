import type { KeyedPlayer } from "@/lib/cards/playerKey";

// =============================================================================
// What a play is, as live stats reads it. docs/V3_DEFINITION.md 8.2.
//
// Mirrors STATS_SCHEMA in ./prompt.ts. Change one and change the other: the
// schema is what Claude is held to, this is what the rest of the app reads.
//
// Claude only says who did what. Turning that into numbers is ./apply.ts, by
// the rules in spec 8.3, so the numbers can be tested and cannot drift with
// the prompt.
// =============================================================================

export const PLAY_TYPES = [
  "run",
  "pass",
  "sack",
  "kickoff",
  "punt",
  "field_goal",
  "extra_point",
  "two_point",
  "kneel",
  "spike",
  "penalty_only",
  "other",
] as const;
export type PlayType = (typeof PLAY_TYPES)[number];

/** Who did what on a play. The table in spec 8.2. */
export const ACTIONS = [
  "rush",
  "pass_complete",
  "pass_incomplete",
  "pass_intercepted",
  "reception",
  "sacked",
  "sack",
  "tackle",
  "pass_breakup",
  "interception",
  "fumble",
  "forced_fumble",
  "fumble_recovery",
  "kick_return",
  "punt_return",
  "field_goal",
  "extra_point",
  "punt",
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Where an event's yards came from (spec rule R8): said outright, worked out
 * from two yard lines, worked out from wording like "a couple yards", or
 * worked out from the change in down and distance. Anything but "stated"
 * shows on the card with a ~.
 */
export const YARDS_SOURCES = ["stated", "spots", "phrase", "downs"] as const;
export type YardsSource = (typeof YARDS_SOURCES)[number];

/** The sources Claude may answer with. "downs" is worked out by code only (lib/livestats/gameState.ts). */
export const READER_YARDS_SOURCES = ["stated", "spots", "phrase"] as const;

export type Side = "home" | "away";

/** Whose half of the field a yard line is in: a team's, the 50, or not said. */
export const TERRITORIES = ["home", "away", "midfield", "unknown"] as const;
export type Territory = (typeof TERRITORIES)[number];

/** A yard line as the announcer said it: "the 19" is 19, "their own 19" is 19 in that team's territory. */
export interface FieldSpot {
  yardLine: number;
  territory: Territory;
}

/** The score as the booth stated it. */
export interface Score {
  home: number;
  away: number;
}

/** Whose foul a flag was, and what it did to the play. */
export const PENALTY_ON = ["offense", "defense", "none", "unknown"] as const;
export type PenaltyOn = (typeof PENALTY_ON)[number];
export interface Penalty {
  on: PenaltyOn;
  /** The booth said no play, the down is replayed, or the play comes back. */
  noPlay: boolean;
  /** A foul before or at the snap: false start, illegal formation, delay of game, offside. */
  beforeSnap: boolean;
}
export const NO_PENALTY: Penalty = { on: "none", noPlay: false, beforeSnap: false };

/** One play already applied, as the next request lists it, so Claude can add to it rather than read it again. */
export interface RecentPlay {
  playId: string;
  summary: string;
}

export interface StatsEvent {
  /** A playerId from the roster Claude was given: "H22-LANGAN" (lib/cards/playerKey.ts). */
  playerId: string;
  action: Action;
  /** Null when no yards are known. Always null when yardsSource is. */
  yards: number | null;
  yardsSource: YardsSource | null;
  /** Field goals and extra points only: whether it was good. Null everywhere else, or when not said. */
  made: boolean | null;
  /**
   * Set by code, never by the reader: an event the check filled in
   * (lib/livestats/check.ts), so every number it adds shows with a ~.
   */
  estimated?: boolean;
}

/** One play as Claude read it out of the transcript, after ./extract.ts has checked every field. */
export interface StatsPlay {
  /** The utterance range it was read from. */
  seqStart: number;
  /**
   * The utterance on which the outcome became known. The anchor for
   * deduplication (newPlays in lib/plays/window.ts), and never optional.
   */
  seqEnd: number;
  quarter: number | null;
  clock: string | null;
  down: number | null;
  distance: number | null;
  offense: Side | null;
  playType: PlayType;
  /** Wiped out by a penalty. Adds nothing (rule R7). */
  nullified: boolean;
  touchdown: boolean;
  firstDown: boolean;
  confidence: number;
  /** One line: "LANGAN 8 yd run, brought down by OSSUETTA". */
  summary: string;
  /** The words it was read from, at most 20, for the browser log. */
  evidence: string;
  events: StatsEvent[];
  /**
   * The id of one of the plays already applied that this read adds to, or ""
   * for a new play (Oct 4). Absent on a play logged before it existed.
   */
  updates?: string;
  /** Where the play began and ended, whenever a yard line was said. Null when not. */
  startSpot?: FieldSpot | null;
  endSpot?: FieldSpot | null;
  /** Yards short of the line to gain, when the gain was said that way ("2 yards short"). */
  shortBy?: number | null;
  /** The score, when this play's lines state it. */
  score?: Score | null;
  /** The flag on this play, if any. */
  penalty?: Penalty;
  /**
   * Set by code, never by the reader: the lines of the read that set the
   * touchdown, and of the one that set a kick's result. Only an update whose
   * lines cover them may take them away (lib/livestats/merge.ts).
   */
  touchdownFrom?: [number, number];
  madeFrom?: [number, number];
  /**
   * Set by code, never by the reader: credits the name check took away only
   * because the words did not name the player yet, and the last line it read
   * for them. lib/livestats/session.ts checks them again as lines arrive.
   */
  nameCheck?: NameCheck;
}

/** A credit dropped (R18) or given to someone else (R14) only because its player was not named. */
export interface UnnamedCredit {
  /** The event as the reader credited it. */
  event: StatsEvent;
  rule: RuleId;
  /** The player it went to instead, when it was filled in. */
  to?: string;
}

export interface NameCheck {
  /** The last utterance the name check has read for this play. */
  through: number;
  credits: UnnamedCredit[];
}

/**
 * One player as the prompt sees them. Both full rosters, spotting off included
 * (rule R9). The shape lives in lib/cards/playerKey.ts, because game setup
 * builds it into the game and the card path may not import this folder.
 */
export type StatsRosterPlayer = KeyedPlayer;

/** One thing the announcer said, numbered in the order it was said. */
export interface StatsUtterance {
  seq: number;
  text: string;
  /** How far into the game, for the prompt's own sense of time. */
  offsetMs: number;
}

/** What POST /api/livestats/extract takes. */
export interface ExtractStatsRequest {
  utterances: StatsUtterance[];
  rosters: StatsRosterPlayer[];
  /** The last few applied plays, with ids, so Claude adds to them rather than reading them again. */
  recentPlays: RecentPlay[];
}

export interface StatsUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export const NO_USAGE: StatsUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
};

/** What POST /api/livestats/extract returns. */
export interface ExtractStatsResponse {
  plays: StatsPlay[];
  usage: StatsUsage;
}

/**
 * The stat rules in spec 8.3 (R1 to R11; R11, two-point tries, was added after
 * the Q&A), and the checks that run before them (R12 onwards, Oct 4, after
 * the two college games were audited; lib/livestats/check.ts says what each
 * one does). Oct 6 took out the four that guessed against the reader, and
 * their numbers are not used again, so an old log still means what it said:
 * R13 (moved a credit to another player), R24 (took a touchdown away because
 * the score did not move), R27 (a flag read afterwards wiped the play before
 * it) and R30 (a sack nobody called a sack was a run). R31 (Oct 6): a
 * kickoff never adds a punt.
 */
export const RULES = [
  "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11",
  "R12", "R14", "R15", "R16", "R17", "R18", "R19", "R20", "R21",
  "R22", "R23", "R25", "R26", "R28", "R29", "R31",
] as const;
export type RuleId = (typeof RULES)[number];

export function isPlayType(value: unknown): value is PlayType {
  return typeof value === "string" && (PLAY_TYPES as readonly string[]).includes(value);
}

export function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

export function isYardsSource(value: unknown): value is YardsSource {
  return typeof value === "string" && (YARDS_SOURCES as readonly string[]).includes(value);
}

export function isPenaltyOn(value: unknown): value is PenaltyOn {
  return typeof value === "string" && (PENALTY_ON as readonly string[]).includes(value);
}

export function isTerritory(value: unknown): value is Territory {
  return typeof value === "string" && (TERRITORIES as readonly string[]).includes(value);
}
