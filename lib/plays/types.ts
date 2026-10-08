// =============================================================================
// What a proposed play is, on the wire and in this browser.
//
// Mirrors PLAY_SCHEMA in ./prompt.ts. Change one and change the other: the
// schema is what Claude is held to, this is what the rest of the app reads.
// =============================================================================

export const PLAY_TYPES = ["run", "pass", "kick", "penalty", "other"] as const;
export type PlayType = (typeof PLAY_TYPES)[number];

export const PLAYER_ROLES = [
  "rusher",
  "passer",
  "receiver",
  "tackler",
  "kicker",
  "returner",
  "intercepted_by",
  "sacked_by",
] as const;
export type PlayerRole = (typeof PLAYER_ROLES)[number];

export const PLAY_FLAGS = [
  "touchdown",
  "firstDown",
  "incomplete",
  "turnover",
  "sack",
  "penalty",
  "noGain",
  "outOfBounds",
] as const;
export type PlayFlag = (typeof PLAY_FLAGS)[number];

export type PlayFlags = Record<PlayFlag, boolean>;

export const NO_FLAGS: PlayFlags = {
  touchdown: false,
  firstDown: false,
  incomplete: false,
  turnover: false,
  sack: false,
  penalty: false,
  noGain: false,
  outOfBounds: false,
};

export interface PlayPlayer {
  /**
   * A roster slot key, the same `Surname#index` the match log uses. Positional
   * because a player in a game has no database id: see buildJerseyIndex.
   */
  playerId: string;
  role: PlayerRole;
}

/** One play as Claude read it out of the transcript. */
export interface ProposedPlay {
  /** The utterance range it was read from. */
  seqStart: number;
  /**
   * The utterance on which the outcome became known. The anchor for
   * deduplication, and never optional: without it a play cannot be told apart
   * from the same play seen again through an overlapping window.
   */
  seqEnd: number;
  quarter: number | null;
  clockText: string | null;
  down: number | null;
  distance: number | null;
  offense: "home" | "away" | null;
  playType: PlayType;
  players: PlayPlayer[];
  /** Null unless a number was actually said. Never worked out from the down and distance. */
  yards: number | null;
  flags: PlayFlags;
  confidence: number;
  /** One line for the grading row: "LANGAN 8 yd run, tackled by OSSUETTA". */
  summary: string;
}

/** One player as the prompt sees them. Part of the cached prefix, so its shape is fixed. */
export interface PlayRosterPlayer {
  playerId: string;
  jersey: string | null;
  first: string | null;
  last: string;
  position: string | null;
  side: "home" | "away";
}

/** One thing the announcer said, trimmed to what the prompt needs. */
export interface PlayUtterance {
  seq: number;
  text: string;
  offsetMs: number;
}

/** Where the game stood, as far as anyone has said out loud. */
export interface PlayContext {
  /** Summaries of the last few accepted plays. Summaries only: no ids, no structure. */
  recentPlays: string[];
  quarter: number | null;
  clockText: string | null;
  down: number | null;
  distance: number | null;
  homeScore: number | null;
  awayScore: number | null;
}

export const NO_CONTEXT: PlayContext = {
  recentPlays: [],
  quarter: null,
  clockText: null,
  down: null,
  distance: null,
  homeScore: null,
  awayScore: null,
};

export interface ExtractPlaysRequest {
  gameId: string;
  utterances: PlayUtterance[];
  rosters: PlayRosterPlayer[];
  context: PlayContext;
}

/** What one call cost, so a game can show a real number rather than an estimate. */
export interface PlayUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

export const NO_USAGE: PlayUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
};

export interface ExtractPlaysResponse {
  plays: ProposedPlay[];
  usage: PlayUsage;
}

export function isPlayType(value: unknown): value is PlayType {
  return typeof value === "string" && (PLAY_TYPES as readonly string[]).includes(value);
}

export function isPlayerRole(value: unknown): value is PlayerRole {
  return typeof value === "string" && (PLAYER_ROLES as readonly string[]).includes(value);
}
