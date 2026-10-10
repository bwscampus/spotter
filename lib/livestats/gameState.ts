import type { LoggedDrop } from "@/lib/log/statsLog";
import { isPlayBoundary } from "@/lib/plays/window";
import { wipedOut } from "./penalty";
import type { FieldSpot, Side, StatsEvent, StatsPlay, YardsSource } from "./types";

// =============================================================================
// Where the ball is, and the yards that follow from it (rule R23).
//
// Oct 6, after the two Gemini games: working yards out from the ball spot was
// right 45 times in 55 when the code knew where the ball was, and wrong, with
// confidence, after a missed play, a wiped-out play or a penalty, because it
// kept using the old spot. So the spot is trusted only when it is fresh, and a
// blank is better than a wrong number. The ball spot is fresh for a play only
// when:
//   - the announcer said where the ball is for this play (its own startSpot);
//   - or the previous play's end spot is known and nothing came between: no
//     penalty, no change of possession, no kick, no wiped-out play, and this
//     play's stated down and distance match what the previous play implies
//     (a mismatch means a play was missed);
//   - or the previous play was a kickoff, a punt, a return or a turnover with
//     no flag that ended at a stated spot whose half is known: that spot is
//     where the next play starts, whichever team has the ball then (Oct 10,
//     a rule of football: the next snap is where the ball was left). Not a
//     touchdown, a field goal or a try, and not a punt that was returned,
//     whose end spot is where the ball came down rather than where the return
//     ended. A half not said carries nothing, as before.
// An incomplete pass with no flag does not move the ball (Oct 10): the spot
// stays fresh, and for the down and distance it is a gain of 0.
// A penalty moves the spot only when the announcer says the new spot;
// otherwise it is unknown until one is said again. Every stated spot or down
// and distance resets the state.
//
// Yards, in this order, the first that applies: the number the announcer
// said; the end spot minus a fresh start spot (a touchdown's end is the goal
// line); the change from this play's down and distance to the next play's on
// the same series with no penalty between; a stated shortfall when the
// distance to go is known; otherwise blank. Anything not said outright is
// marked estimated with its source. A yardage said in the next few lines
// ("that went for 48") counts as said.
//
// Pure. The session (./session.ts) calls it when a play is read and again
// when the next play arrives, to back-fill the one before.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A worked-out figure past this that nobody said is left unknown. */
export const MAX_WORKED_OUT_YARDS = 40;

/** A punt travels further than a play from scrimmage, so its worked-out length may be up to this. */
export const MAX_PUNT_YARDS = 85;

/**
 * A field goal is kicked from seven yards behind the line of scrimmage into an
 * end zone ten deep: its length is the yards to the goal line plus this.
 */
export const FIELD_GOAL_EXTRA_YARDS = 17;

/** No field goal worth counting is shorter or longer than this. */
export const MIN_FIELD_GOAL_YARDS = 17;
export const MAX_FIELD_GOAL_YARDS = 75;

/**
 * A spot said without whose half it is in is placed in the same half as the
 * spot beside it, but only when that one is clearly in one half: a reference
 * at or past this yard line is too close to the 50 to assume.
 */
export const NEAR_MIDFIELD = 40;

/** How many utterances after a play's last line a late yardage ("that went for 48") is looked for. */
export const LATE_YARDS_UTTERANCES = 3;

// =============================================================================

export interface GameState {
  possession: Side | null;
  /** The down and distance the previous play implies for the next one, when known: the cross-check for a missed play. */
  down: number | null;
  distance: number | null;
  /** The ball, in yards from the offense's own goal line (0 to 100), only while it is fresh. */
  spot: number | null;
  /**
   * Where a kick, a return or a turnover left the ball, as said (its half
   * known): the next play starts here, whichever team has it. Absent when
   * nothing was said, or the play had a flag.
   */
  ballLeftAt?: FieldSpot;
}

export const START_STATE: GameState = { possession: null, down: null, distance: null, spot: null };

/** A spot as yards from the offense's own goal line, when whose half it is in is known. */
export function absoluteSpot(spot: FieldSpot, offense: Side): number | null {
  if (spot.territory === "midfield" || spot.yardLine === 50) return 50;
  if (spot.territory === "unknown") return null;
  return spot.territory === offense ? spot.yardLine : 100 - spot.yardLine;
}

/** A spot with no territory, placed in the half of a known spot beside it (NEAR_MIDFIELD). */
function placeBeside(spot: FieldSpot, reference: number): number | null {
  if (spot.yardLine === 50) return 50;
  const referenceLine = reference <= 50 ? reference : 100 - reference;
  if (referenceLine >= NEAR_MIDFIELD) return null;
  return reference < 50 ? spot.yardLine : 100 - spot.yardLine;
}

/**
 * Whether this play's stated down and distance disagree with what the play
 * before implied: a play was missed, and the carried-over spot is stale.
 */
export function missedPlayBefore(play: Pick<StatsPlay, "down" | "distance">, state: GameState): boolean {
  if (play.down !== null && state.down !== null && play.down !== state.down) return true;
  return play.distance !== null && state.distance !== null && play.distance !== state.distance;
}

/** A spot said for this play, as yards from the offense's goal line, placed beside a known spot when it has no half. */
function resolve(spot: FieldSpot | null | undefined, offense: Side, beside: number | null): number | null {
  if (!spot) return null;
  const known = absoluteSpot(spot, offense);
  if (known !== null) return known;
  return spot.territory === "unknown" && beside !== null ? placeBeside(spot, beside) : null;
}

/**
 * Where the ball was when this play began, when it can be trusted: the
 * play's own start spot, else where the last play ended, if the state still
 * holds it (nothing came between) and no play was missed. Null otherwise.
 */
export function freshStart(play: StatsPlay, state: GameState, offense: Side): number | null {
  const kept = state.possession === offense && !missedPlayBefore(play, state) ? state.spot : null;
  const carried = kept ?? (state.ballLeftAt ? absoluteSpot(state.ballLeftAt, offense) : null);
  if (play.startSpot) return resolve(play.startSpot, offense, carried ?? resolve(play.endSpot, offense, null));
  return carried;
}

const TOUCHBACK = /\btouchback\b/i;

/**
 * A punt's length (line of scrimmage to where it came down, or the goal line
 * on a touchback) and a field goal's (yards to the goal line plus the end
 * zone and the snap), from the spots (Oct 4: kick distances were left blank
 * because the booth rarely says them).
 */
function kickYards(play: StatsPlay, state: GameState, offense: Side): WorkedOut | null {
  const startAbs = freshStart(play, state, offense);
  if (startAbs === null) return null;
  if (play.playType === "field_goal") {
    const yards = Math.round(100 - startAbs + FIELD_GOAL_EXTRA_YARDS);
    return yards >= MIN_FIELD_GOAL_YARDS && yards <= MAX_FIELD_GOAL_YARDS ? { yards, source: "spots" } : null;
  }
  if (play.playType !== "punt") return null;
  const touchback = TOUCHBACK.test(`${play.summary} ${play.evidence}`);
  const end = resolve(play.endSpot, offense, startAbs);
  const yards = touchback && !play.endSpot ? 100 - startAbs : end === null ? null : end - startAbs;
  return yards !== null && yards > 0 && yards <= MAX_PUNT_YARDS ? { yards, source: "spots" } : null;
}

export interface WorkedOut {
  yards: number;
  source: YardsSource;
}

/**
 * The yards for a play nobody said a number for, in rule R23's order: the end
 * spot (or the goal line, on a touchdown) minus a fresh start spot; then the
 * change to the next play's down and distance; then the stated shortfall.
 * `next` is the play right after this one, handed in only when it is on the
 * same possession with nothing between (no penalty, no kick, no wiped-out
 * play): its start spot is where this play ended. Null when none of them
 * gives a figure worth trusting.
 */
export function workOutYards(play: StatsPlay, state: GameState, next: StatsPlay | null): WorkedOut | null {
  const offense = play.offense ?? state.possession;
  if (!offense) return null;
  const kick = kickYards(play, state, offense);
  if (kick) return kick;
  if (play.playType === "punt" || play.playType === "field_goal") return null;
  const start = freshStart(play, state, offense);
  if (start !== null) {
    const endSpot = play.endSpot ?? next?.startSpot ?? null;
    const end = play.touchdown ? 100 : resolve(endSpot, offense, start);
    if (end !== null && Math.abs(end - start) <= MAX_WORKED_OUT_YARDS) return { yards: end - start, source: "spots" };
  }
  if (
    next !== null &&
    next.offense === offense &&
    !play.firstDown &&
    play.down !== null &&
    play.distance !== null &&
    next.down !== null &&
    next.distance !== null &&
    next.down === play.down + 1
  ) {
    const yards = play.distance - next.distance;
    if (Math.abs(yards) <= MAX_WORKED_OUT_YARDS) return { yards, source: "downs" };
  }
  if (play.distance !== null && typeof play.shortBy === "number") {
    const yards = play.distance - play.shortBy;
    if (Math.abs(yards) <= MAX_WORKED_OUT_YARDS) return { yards, source: "phrase" };
  }
  return null;
}

/** The events that carry a play's gain: the run, the catch and its throw, the sack and the sacked quarterback, or the punt. */
export function gainEvents(play: StatsPlay): StatsEvent[] {
  const of = (...actions: StatsEvent["action"][]) => play.events.filter((event) => actions.includes(event.action));
  const rush = of("rush");
  if (rush.length > 0) return rush;
  const pass = of("reception", "pass_complete");
  if (pass.length > 0) return pass;
  const sack = of("sacked", "sack");
  if (sack.length > 0) return sack;
  const punt = of("punt");
  if (punt.length > 0) return punt;
  return of("field_goal");
}

/** Whether the play's gain is still unknown, or only worked out, so a better figure may replace it. */
export function gainIs(play: StatsPlay): "unknown" | "estimated" | "stated" | "none" {
  const events = gainEvents(play);
  if (events.length === 0) return "none";
  if (events.every((event) => event.yards === null)) return "unknown";
  if (events.some((event) => event.yardsSource === "stated" && event.yards !== null)) return "stated";
  return "estimated";
}

/**
 * Writes a figure onto the play's gain events. On a sack the figure is a
 * loss, kept as the positive number both sack events carry; a figure that is
 * not a loss is no sack figure. Returns the play unchanged when nothing
 * needed it.
 */
export function withGain(play: StatsPlay, worked: WorkedOut, rule: "R23", reason: string): { play: StatsPlay; notes: LoggedDrop[] } {
  const targets = gainEvents(play);
  if (targets.length === 0) return { play, notes: [] };
  const isSack = targets.some((event) => event.action === "sacked" || event.action === "sack");
  if (isSack && worked.yards >= 0) return { play, notes: [] };
  const value = isSack ? Math.abs(worked.yards) : worked.yards;
  const notes: LoggedDrop[] = [];
  const events = play.events.map((event) => {
    if (!targets.includes(event)) return event;
    if (event.yards === value && event.yardsSource === worked.source) return event;
    notes.push({ playerId: event.playerId, action: event.action, rule, reason, kind: "changed" });
    return { ...event, yards: value, yardsSource: worked.source };
  });
  return notes.length > 0 ? { play: { ...play, events }, notes } : { play, notes: [] };
}

// -----------------------------------------------------------------------------
// A yardage said a few lines late.
// -----------------------------------------------------------------------------

const LATE_GAIN = [
  /\bwent for (\d{1,2})\b/,
  /\bgain of (\d{1,2})\b/,
  /\bpick ?up of (\d{1,2})\b/,
  /\b(\d{1,2})[ -]yard(?:er| (?:run|gain|catch|pass|pickup|completion|reception|scramble|carry|rush))\b/,
  /\b(?:catch|run|reception|carry|rush|gain|pickup|completion) of (\d{1,2})\b/,
  /\bpicks? up (\d{1,2})\b/,
];
const LATE_LOSS = [/\bloss of (\d{1,2})\b/, /\bloses (\d{1,2})\b/];
/** Wording that is plainly about the play just over, so its number may replace one already said. */
const LOOKING_BACK = /\bwent for\b|\ba moment ago\b|\bprevious play\b|\bthat (?:run|catch|pass|play|carry)\b|\bofficially\b|\bthat was\b|\bthe last play\b/i;

export interface LateYards {
  yards: number;
  seq: number;
  /** The wording looks back at the play, so this number may replace a stated one. */
  lookingBack: boolean;
}

/**
 * A yardage said within LATE_YARDS_UTTERANCES after a play's last line, and
 * before the next down-and-distance call or the next play begins. The first
 * one found.
 */
export function lateStatedYards(
  utterances: readonly { seq: number; text: string }[],
  afterSeq: number,
  beforeSeq: number = Number.POSITIVE_INFINITY,
): LateYards | null {
  const last = Math.min(afterSeq + LATE_YARDS_UTTERANCES, beforeSeq - 1);
  for (const utterance of utterances) {
    if (utterance.seq <= afterSeq) continue;
    if (utterance.seq > last) break;
    const text = utterance.text.toLowerCase();
    if (isPlayBoundary(text)) return null;
    for (const pattern of LATE_LOSS) {
      const match = pattern.exec(text);
      if (match) return { yards: -Number(match[1]), seq: utterance.seq, lookingBack: LOOKING_BACK.test(text) };
    }
    for (const pattern of LATE_GAIN) {
      const match = pattern.exec(text);
      if (match) return { yards: Number(match[1]), seq: utterance.seq, lookingBack: LOOKING_BACK.test(text) };
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Folding plays into the state.
// -----------------------------------------------------------------------------

/**
 * The state after these plays, in the order given. A kick or a change of
 * possession loses the spot unless it ended at a spot said with its half, or
 * the next play says its own.
 */
export function stateAfter(plays: readonly StatsPlay[]): GameState {
  let state: GameState = START_STATE;
  for (const play of plays) state = advance(state, play);
  return state;
}

/** Any flag on the play: its end spot is not where the next play starts. */
export function flagged(play: Pick<StatsPlay, "penalty">): boolean {
  const penalty = play.penalty;
  return penalty !== undefined && (penalty.on !== "none" || penalty.noPlay || penalty.beforeSnap);
}

const KICK_PLAYS: ReadonlySet<StatsPlay["playType"]> = new Set(["kickoff", "punt", "field_goal", "extra_point", "two_point"]);
const TURNOVER: ReadonlySet<StatsEvent["action"]> = new Set(["interception", "pass_intercepted", "fumble_recovery"]);
const RETURNS: ReadonlySet<StatsEvent["action"]> = new Set(["kick_return", "punt_return"]);
/** Anything but an incomplete pass on a play that has one: then it was not just an incompletion. */
const NOT_INCOMPLETE: ReadonlySet<StatsEvent["action"]> = new Set([
  "pass_complete",
  "reception",
  "pass_intercepted",
  "interception",
  "sacked",
  "sack",
  "rush",
  "fumble",
  "fumble_recovery",
]);

/**
 * Where a kickoff, a punt, a return or a turnover left the ball, when it was
 * said with its half and nothing muddies it: no flag, not wiped out, no
 * touchdown, not a field goal or a try, and not a punt that was returned (a
 * punt's end spot is where the ball came down, not where the return ended).
 * Null otherwise.
 */
function leftAt(play: StatsPlay): FieldSpot | null {
  if (wipedOut(play) || flagged(play) || play.touchdown) return null;
  if (play.playType === "field_goal" || play.playType === "extra_point" || play.playType === "two_point") return null;
  const end = play.endSpot;
  if (!end || (end.territory === "unknown" && end.yardLine !== 50)) return null;
  const returned = play.events.some((event) => RETURNS.has(event.action));
  const turnover = play.events.some((event) => TURNOVER.has(event.action));
  if (play.playType === "punt") return returned ? null : end;
  return play.playType === "kickoff" || returned || turnover ? end : null;
}

/** An incomplete pass and nothing else: the ball goes back to where it was. */
function incompletion(play: StatsPlay): boolean {
  return play.events.some((event) => event.action === "pass_incomplete") && !play.events.some((event) => NOT_INCOMPLETE.has(event.action));
}

export function advance(state: GameState, play: StatsPlay): GameState {
  const offense = play.offense ?? state.possession;
  // A flag on its own: the spot is unknown unless the announcer says the new one.
  if (play.playType === "penalty_only") {
    const said = offense ? resolve(play.endSpot ?? play.startSpot, offense, null) : null;
    return { possession: offense, down: play.down, distance: play.distance, spot: said };
  }
  // A wiped-out play, a kick, or the ball changing hands: nothing carries over
  // for this offense, except a spot said where the ball was left.
  if (wipedOut(play) || KICK_PLAYS.has(play.playType) || !offense || play.events.some((event) => TURNOVER.has(event.action) || RETURNS.has(event.action))) {
    const left = leftAt(play);
    return { possession: offense, down: null, distance: null, spot: null, ...(left ? { ballLeftAt: left } : {}) };
  }
  const start = freshStart(play, state, offense);
  let end = resolve(play.endSpot, offense, start);
  const gain = gainEvents(play).find((event) => event.yards !== null);
  let signed = gain && gain.yards !== null ? (gain.action === "sacked" || gain.action === "sack" ? -Math.abs(gain.yards) : gain.yards) : null;
  // An incomplete pass with no flag: the ball stays where it was, a gain of 0.
  if (incompletion(play) && !flagged(play)) {
    signed = 0;
    end = start;
  }
  if (end === null && start !== null && signed !== null) end = clamp(start + signed, 0, 100);
  if (signed === null && start !== null && end !== null) signed = end - start;

  // What this play implies for the next one's down and distance.
  let down: number | null = null;
  let distance: number | null = null;
  if (play.down !== null) {
    const made = play.firstDown || (signed !== null && play.distance !== null && signed >= play.distance);
    if (made) down = 1;
    else if (play.down < 4) {
      down = play.down + 1;
      distance = play.distance !== null && signed !== null ? play.distance - signed : null;
    }
  }
  const spot = play.touchdown || flagged(play) ? null : end;
  return { possession: offense, down, distance, spot };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
