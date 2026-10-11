import type { LoggedDrop } from "@/lib/log/statsLog";
import { absoluteSpot, flagged, freshStart, gainEvents, gainIs, MAX_WORKED_OUT_YARDS, stateAfter, withGain, type GameState } from "./gameState";
import { wipedOut } from "./penalty";
import type { Side, StatsPlay } from "./types";

// =============================================================================
// Drives (Oct 11, Parts 4 and 7). A drive is one team's possession from its
// first snap to the play that gives the ball up: a punt, a field goal try, a
// touchdown (with its try), a turnover, a turnover on downs, the other team's
// next snap, or the end of a half.
//
// The drive check (R36, Part 4): when a drive has ended and both its start and
// end spots are known, the yards credited on its plays plus the penalty yards
// should add up to its net gain. Exactly one play with blank yards is filled
// with the difference, marked estimated with source "drive"; when the drive
// does not add up and nothing is blank, the mismatch is logged and nothing is
// changed. A blank is still better than a wrong number: a figure past
// MAX_WORKED_OUT_YARDS, or a drive with a penalty whose yards were not said,
// fills nothing.
//
// The drive re-read (Part 7) uses the same partition to know what to send.
// Pure.
// =============================================================================

/** What the partition needs to know about a play already read. */
export interface DrivePlay {
  playId: string;
  play: StatsPlay;
  status: string;
}

export type DriveEnd = "punt" | "field_goal" | "touchdown" | "turnover" | "possession" | "half";

export interface Drive<P extends DrivePlay = DrivePlay> {
  offense: Side;
  /** The plays, in read order: the snaps from scrimmage and the kick or try that ended it. */
  plays: P[];
  /** How it ended, or null while it is still going. */
  endedBy: DriveEnd | null;
}

const SCRIMMAGE: ReadonlySet<StatsPlay["playType"]> = new Set(["run", "pass", "sack", "kneel", "spike", "penalty_only", "other"]);
const TRIES: ReadonlySet<StatsPlay["playType"]> = new Set(["extra_point", "two_point"]);
const TURNOVER: ReadonlySet<string> = new Set(["interception", "pass_intercepted", "fumble_recovery"]);

/** The side that recovered a fumble or intercepted, when the play says one. */
function turnoverOn(play: StatsPlay, sideOf: ReadonlyMap<string, Side>): boolean {
  if (play.offense === null) return play.events.some((event) => event.action === "interception" || event.action === "pass_intercepted");
  return play.events.some((event) => {
    if (!TURNOVER.has(event.action)) return false;
    if (event.action === "pass_intercepted") return true;
    const side = sideOf.get(event.playerId);
    return side !== undefined && side !== play.offense;
  });
}

/**
 * The plays that still count, cut into drives. A kickoff belongs to no
 * drive; a try belongs to the touchdown before it; a drive with no scrimmage
 * play is left out.
 */
export function drivesOf<P extends DrivePlay>(plays: readonly P[], sideOf: ReadonlyMap<string, Side>, halfEnds: ReadonlySet<string> = new Set()): Drive<P>[] {
  const drives: Drive<P>[] = [];
  let current: Drive<P> | null = null;
  const close = (endedBy: DriveEnd) => {
    if (current) current.endedBy = endedBy;
    current = null;
  };
  for (const entry of plays) {
    if (entry.status === "discarded") continue;
    const play = entry.play;
    if (play.playType === "kickoff") {
      close("possession");
      continue;
    }
    if (TRIES.has(play.playType)) {
      // The try after a touchdown: the drive ended at the touchdown; the try rides along.
      const last = drives[drives.length - 1];
      if (last && last.endedBy === "touchdown" && last.plays[last.plays.length - 1]?.play.touchdown) last.plays.push(entry);
      continue;
    }
    const offense = play.offense;
    if (offense === null) {
      if (current && !wipedOut(play)) current.plays.push(entry);
      continue;
    }
    if (current && current.offense !== offense) close("possession");
    if (!current) {
      current = { offense, plays: [], endedBy: null };
      drives.push(current);
    }
    current.plays.push(entry);
    if (play.playType === "punt") close("punt");
    else if (play.playType === "field_goal") close("field_goal");
    else if (play.touchdown && !wipedOut(play)) close("touchdown");
    else if (!wipedOut(play) && turnoverOn(play, sideOf)) close("turnover");
    else if (halfEnds.has(entry.playId)) close("half");
  }
  return drives.filter((drive) => drive.plays.some((entry) => SCRIMMAGE.has(entry.play.playType) || entry.play.playType === "punt" || entry.play.playType === "field_goal"));
}

/** The ids of the plays that end a finished drive in `after` and did not in `before`. */
export function newlyEnded<P extends DrivePlay>(before: readonly Drive<P>[], after: readonly Drive<P>[]): Drive<P>[] {
  const ended = new Set(before.filter((drive) => drive.endedBy !== null).map((drive) => drive.plays[drive.plays.length - 1].playId));
  return after.filter((drive) => drive.endedBy !== null && !ended.has(drive.plays[drive.plays.length - 1].playId));
}

export interface DriveCheck {
  /** The play whose yards were filled, with the figure, or null. */
  filled: { playId: string; play: StatsPlay; notes: LoggedDrop[] } | null;
  /** A note for the drive's last play when the yards do not add up and nothing is blank. */
  mismatch: { playId: string; note: LoggedDrop } | null;
}

const NOTHING: DriveCheck = { filled: null, mismatch: null };

/** The signed yards a play from scrimmage moved the ball, when known: a sack is a loss, an unflagged incompletion is 0. */
function playYards(play: StatsPlay): number | null {
  if (play.playType === "penalty_only") return 0;
  const events = gainEvents(play);
  if (events.length === 0) {
    // An incomplete pass moves nothing; a play with no gain event and no pass is unknown.
    return play.events.some((event) => event.action === "pass_incomplete") ? 0 : null;
  }
  const known = events.find((event) => event.yards !== null);
  if (!known || known.yards === null) return null;
  return known.action === "sacked" || known.action === "sack" ? -Math.abs(known.yards) : known.yards;
}

/** The penalty's yards, signed for the offense, or null when a flag's yards were not said. */
function penaltyYards(play: StatsPlay): number | null {
  const penalty = play.penalty;
  if (!penalty || !flagged(play)) return 0;
  const yards = penalty.penaltyYards;
  if (typeof yards !== "number") return null;
  if (penalty.on === "offense") return -yards;
  if (penalty.on === "defense") return yards;
  return null;
}

/**
 * The drive's net gain, from where its first play began (a fresh spot) to
 * where it gave the ball up: the kick's line of scrimmage, the goal line on a
 * touchdown, or the last play's stated end spot. Null when either end is unknown.
 */
export function driveNet(drive: Drive, before: GameState): number | null {
  const scrimmage = drive.plays.filter((entry) => entry.play.playType !== "extra_point" && entry.play.playType !== "two_point");
  const first = scrimmage[0]?.play;
  const last = scrimmage[scrimmage.length - 1]?.play;
  if (!first || !last) return null;
  const start = freshStart(first, before, drive.offense);
  if (start === null) return null;
  let end: number | null = null;
  if (last.playType === "punt" || last.playType === "field_goal") {
    // The kick is snapped where the drive ended; its own start spot says so, else the spot carried to it.
    const state = stateAfter(scrimmage.slice(0, -1).map((entry) => entry.play));
    end = freshStart(last, { ...state, possession: drive.offense, spot: state.possession === drive.offense ? state.spot : null }, drive.offense);
  } else if (last.touchdown) end = 100;
  else if (last.endSpot) end = absoluteSpot(last.endSpot, drive.offense);
  if (end === null) return null;
  return end - start;
}

/**
 * The drive check (R36): fill the one blank play from the net gain, or log
 * the mismatch. `before` is the state before the drive's first play.
 */
export function driveCheck(drive: Drive, before: GameState): DriveCheck {
  if (drive.endedBy === null) return NOTHING;
  const scrimmage = drive.plays.filter((entry) => entry.play.playType !== "extra_point" && entry.play.playType !== "two_point");
  const kicks = scrimmage.filter((entry) => entry.play.playType === "punt" || entry.play.playType === "field_goal");
  const fromScrimmage = scrimmage.filter((entry) => !kicks.includes(entry) && !wipedOut(entry.play));
  if (fromScrimmage.length === 0) return NOTHING;
  const net = driveNet(drive, before);
  if (net === null) return NOTHING;

  let sum = 0;
  const blanks: DrivePlay[] = [];
  for (const entry of scrimmage) {
    const flag = penaltyYards(entry.play);
    if (flag === null) return NOTHING; // a flag whose yards were not said: nothing adds up
    sum += flag;
    if (kicks.includes(entry) || wipedOut(entry.play)) continue;
    const yards = playYards(entry.play);
    if (yards === null) {
      if (gainIs(entry.play) === "unknown") blanks.push(entry);
      else return NOTHING;
    } else sum += yards;
  }

  const last = scrimmage[scrimmage.length - 1];
  if (blanks.length === 1) {
    const yards = net - sum;
    if (Math.abs(yards) > MAX_WORKED_OUT_YARDS) return NOTHING;
    const target = blanks[0];
    const filled = withGain(target.play, { yards, source: "drive" }, "R36", `yards from the drive: ${net} net from where it began to where it ended, ${sum} on the other plays`);
    if (filled.notes.length === 0) return NOTHING;
    return { filled: { playId: target.playId, play: filled.play, notes: filled.notes }, mismatch: null };
  }
  if (blanks.length === 0 && sum !== net) {
    return {
      filled: null,
      mismatch: {
        playId: last.playId,
        note: { playerId: "", action: "drive", rule: "R36", reason: `the drive's yards do not add up: ${net} net from its spots, ${sum} on its plays and flags; nothing changed`, kind: "noted" },
      },
    };
  }
  return NOTHING;
}
