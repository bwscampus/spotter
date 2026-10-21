import type { KeyedPlayer } from "@/lib/cards/playerKey";
import type { FootballStatKey } from "@/lib/cards/statKeys";

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
export const YARDS_SOURCES = ["stated", "spots", "phrase", "downs", "drive", "ledger"] as const;
export type YardsSource = (typeof YARDS_SOURCES)[number];

/** The sources Claude may answer with. "downs", "drive" (older logs) and "ledger" (lib/livestats/ledger.ts, fix 6) are worked out by code only. */
export const READER_YARDS_SOURCES = ["stated", "spots", "phrase"] as const;

export type Side = "home" | "away";

/** Whose half of the field a yard line is in: a team's, the 50, or not said. */
export const TERRITORIES = ["home", "away", "midfield", "unknown"] as const;
export type Territory = (typeof TERRITORIES)[number];

/** A yard line as the announcer said it: "the 19" is 19, "their own 19" is 19 in that team's territory. */
export interface FieldSpot {
  yardLine: number;
  territory: Territory;
  /**
   * Set by code, never by the reader (fix 6, Part 2): the words gave the spot
   * approximately ("past the 30", "near the 40", "inside the 10"), so it says
   * where the ball was about, not where the play ended. The ledger
   * (lib/livestats/ledger.ts) scores it and never pins a gain with it.
   */
  approximate?: boolean;
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
  /** The yards the flag was marked off, when said (Oct 11, Part 4: the drive check adds them up). Null when not; absent on older logs. */
  penaltyYards?: number | null;
}
export const NO_PENALTY: Penalty = { on: "none", noPlay: false, beforeSnap: false, penaltyYards: null };

/**
 * How far a stat line the booth reads on air reaches (Oct 11, fix 6, Part 1):
 * tonight's running total, this half's, the season's, a career's, or something
 * else ("in his last three games"). Only "tonight" (and "this_half" while the
 * first half is still on) sets a total (rule R41, lib/livestats/statLines.ts).
 */
export const BOOTH_SCOPES = ["tonight", "this_half", "season", "career", "other"] as const;
export type BoothScope = (typeof BOOTH_SCOPES)[number];

/**
 * One stat the booth stated as a player's running total ("he's 14 of 17 for
 * 181" is four of these), as the reader returns it: the line it was said on,
 * the player, how far it reaches, Spotter's key for the stat, and the number.
 * No field is nullable: an empty list is the usual answer.
 */
export interface BoothStatLine {
  seq: number;
  playerId: string;
  scope: BoothScope;
  key: FootballStatKey;
  value: number;
}

/** One play already applied, as the next request lists it, so Claude can add to it rather than read it again. */
export interface RecentPlay {
  playId: string;
  summary: string;
  /** On a re-read (Part 7, Part 8): who was credited with what, one line, so the reader corrects rather than re-reads. */
  detail?: string;
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
  /**
   * Set by code, never by the reader (fix 6, Part 2): the yards were a number
   * said a line or two after the play (R23), written as stated. The ledger
   * weighs such a number below the downs and a pair of yard lines, and takes
   * it back when the drive's facts contradict it.
   */
  late?: boolean;
}

/** One play as Claude read it out of the transcript, after ./extract.ts has checked every field. */
export interface StatsPlay {
  /** The utterance range it was read from. */
  seqStart: number;
  /**
   * The last utterance that describes the play (since Oct 10; before, the
   * one on which its outcome became known). The anchor for
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
  /**
   * On a re-read only (Part 7, Part 8): a play already applied that was not a
   * play, to be taken out. Never read from a first look.
   */
  remove?: boolean;
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

/**
 * The words that name each team, as the live screen's team cues have them
 * (lib/game/teamCues.ts: school, mascot, what they wear), lowercased phrases.
 * Handed to live stats by components/livestats/LiveGame.tsx, the one place
 * both meet, so this folder never imports the snapshot.
 */
export interface TeamWords {
  home: { name: string; phrases: string[] };
  away: { name: string; phrases: string[] };
}

/**
 * What the code believes about the game when a call is made (Oct 11, Part 2):
 * told to the reader in the volatile part of every call, never the cached
 * one. Every field is optional, and an unknown value is left out, not
 * guessed. lib/livestats/gameStateBlock.ts builds and renders it.
 */
export interface ReaderGameState {
  teams?: { home: string; away: string };
  quarter?: number;
  score?: Score;
  possession?: Side;
  down?: number;
  distance?: number;
  /** Where the ball is, as a yard line in a half, when the code trusts it. */
  spot?: FieldSpot;
  /** The spot was said as a yard line (fix 6, Part 2), rather than worked out from the drive's facts. */
  spotSaid?: boolean;
  /** The quarterback on the field for each side, by playerId. */
  qbs?: Partial<Record<Side, string>>;
  /** The last kicker and punter each side used, by playerId. */
  kickers?: Partial<Record<Side, string>>;
  punters?: Partial<Record<Side, string>>;
  /** Players marked out tonight (Part 3), by playerId: they cannot be credited. */
  out?: string[];
  /**
   * The stat lines the booth has read on air so far and the code accepted
   * (fix 6, Part 1), as facts for a re-read: the running totals it sets.
   */
  booth?: Array<{ seq: number; playerId: string; key: FootballStatKey; value: number }>;
}

/** What POST /api/livestats/extract takes. */
export interface ExtractStatsRequest {
  utterances: StatsUtterance[];
  rosters: StatsRosterPlayer[];
  /** The last few applied plays, with ids, so Claude adds to them rather than reading them again. */
  recentPlays: RecentPlay[];
  /** The game state block (Part 2). Absent on a request from an older tab. */
  gameState?: ReaderGameState;
  /**
   * What kind of read this is (Oct 11): the usual window ("first", the
   * default), a second look at a quiet window's lines (Part 5), a drive's
   * re-read (Part 7) or the halftime check (Part 8). The volatile part of the
   * prompt says so; the cached prefix is the same for all.
   */
  look?: ReadLook;
  /**
   * On a booth re-read (fix 6, Part 1, rule R42): the stat line whose count
   * disagrees with the plays, and what the plays counted for it.
   */
  boothLine?: BoothRereadLine;
  /** On a gap re-read (fix 6, Part 3, rule R44): the snap the downs say is missing. */
  gap?: GapRereadFacts;
}

/** The booth line a re-read is about: the booth's total, and Spotter's at that line. */
export interface BoothRereadLine {
  seq: number;
  playerId: string;
  key: FootballStatKey;
  value: number;
  spotter: number;
}

/** What the ledger knows about a missing snap, for the gap re-read's one sentence. */
export interface GapRereadFacts {
  offense: Side;
  before: { down: number | null; distance: number | null; spot: FieldSpot | null };
  after: { down: number | null; distance: number | null; spot: FieldSpot | null };
  /** The yards the missing snap must have gained, when the facts pin them. */
  yards: number | null;
}

/** The looks that read lines already read once, for corrections: the reader may name any play it was sent and take one out. */
export const REREAD_LOOKS = ["drive", "halftime", "booth", "gap"] as const satisfies readonly ReadLook[];
export function isRereadLook(look: ReadLook | undefined): boolean {
  return look !== undefined && (REREAD_LOOKS as readonly string[]).includes(look);
}

export const READ_LOOKS = ["first", "second", "drive", "halftime", "booth", "gap"] as const;
export type ReadLook = (typeof READ_LOOKS)[number];

export function isReadLook(value: unknown): value is ReadLook {
  return typeof value === "string" && (READ_LOOKS as readonly string[]).includes(value);
}

export interface StatsUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  /** The thinking inside outputTokens (v7, Part 0), when the reply said; absent on an older reply. */
  reasoningTokens?: number;
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
  /** The stat lines the booth read on air (fix 6, Part 1). Absent from an older server. */
  statLines?: BoothStatLine[];
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
 * kickoff never adds a punt. R32 (Oct 10): an extra point or field goal with
 * no named kicker is that side's kicker (kickerFor), estimated. R33 (Oct 10,
 * after the college test): an id written with extra words ("H7-SMITH
 * Joe RB") or without its number is the roster id it plainly means
 * (./resolveIds.ts). R34 (Oct 10): an update the reader sends for a play by
 * id, whose offense or ball carrier is the other team's, is dropped whole and
 * the play stays as it was (./merge.ts, crossTeamUpdate). R35 (Oct 11, Part
 * 3): a credit to a player marked out tonight is dropped; he is not playing.
 * R36 (Oct 11, Part 4): the one blank play on a drive that has ended is filled
 * from the drive's net gain, or the mismatch is noted (./drives.ts). R37
 * (Oct 11, Part 4): a spot's half, or a missing spot, from the words beside
 * the yard line (./fieldWords.ts). R38 (Oct 11, Part 5): a play read on the
 * second look at a quiet window (./secondLook.ts), noted so the scorer can
 * count what the second look adds. R39 (Oct 11, Part 7): a play corrected,
 * added or removed by the re-read of a drive when it ended (./drives.ts,
 * controller.ts). R40 (Oct 11, Part 8): the same by the halftime check.
 * Fix 6 (Oct 11, after the Steelers at Browns audit): R41, a stat line the
 * booth read on air sets that player's total for that stat
 * (./statLines.ts, tallyWithBooth in lib/cards/tonight.ts); R42, a play
 * corrected, added or removed by the re-read a booth line's count mismatch
 * queued (controller.ts); R43, a gain the drive ledger filled in, blanked or
 * found a stated figure at odds with (./ledger.ts); R44, a play the gap
 * re-read found between two snaps the downs say are not consecutive; R45,
 * an incomplete pass inferred for a missing snap that moved nothing; R46, a
 * defensive holding, illegal contact or pass interference foul accepted on a
 * pass play makes it a no-play (./penalty.ts). v7 (Oct 20): R47, a gain the
 * yards solver worked out from the next down and distance or the yard lines
 * (./yards.ts); R48, a player the priors filled in (./priors.ts, the
 * quarterback for an unnamed pass, the dominant back for an unnamed run when
 * that is allowed); R49, a correction a v7 re-read of a segment made, or
 * refused (./v7.ts); R50 (fix 1, Part 6), a v7 read of talk after a play
 * that was the same play again, joined to it as an update (./v7.ts).
 */
export const RULES = [
  "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10", "R11",
  "R12", "R14", "R15", "R16", "R17", "R18", "R19", "R20", "R21",
  "R22", "R23", "R25", "R26", "R28", "R29", "R31", "R32", "R33", "R34",
  "R35", "R36", "R37", "R38", "R39", "R40", "R41", "R42", "R43", "R44", "R45", "R46",
  "R47", "R48", "R49", "R50",
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
