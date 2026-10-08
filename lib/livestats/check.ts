import { isNamedIn, saidToThrow } from "./names";
import { hasGroup } from "./positions";
import { wipedOut } from "./penalty";
import type { Action, RuleId, Side, StatsEvent, StatsPlay, StatsRosterPlayer } from "./types";

// =============================================================================
// Checking every credit before the stat rules see it.
//
// The reader decides what happened (Oct 6, after the two Gemini games: the
// checks that second-guessed it fired 18 times and were wrong 17). Code does
// three things to a play the reader returns, and nothing else:
//   - applies a rule of football that is always true;
//   - fills in something with only one possible answer (a catch with no
//     passer is the quarterback's on the field);
//   - drops something that cannot be true (a carry by a player on the team
//     without the ball, a credit for a player the words never name).
// Code never moves a credit from one player to another, with one exception
// kept from Oct 4: a pass with no usable passer goes to the quarterback on the
// field. Position is used for that and nothing else: in high school most
// starters play both ways, so a position is never a reason to drop a credit.
//
// Every fill and drop comes back with its rule, the way the stat rules' drops
// do, so the strip, the log and the export all say what happened. Pure,
// synchronous, no network, no lib/matching.
// =============================================================================

export type NoteKind = "dropped" | "moved" | "filled" | "changed";

/** What the check did to one event, with the rule. */
export interface CheckNote {
  /** The event as it came in. For a fill-in, the event that was added. */
  event: StatsEvent;
  rule: RuleId;
  kind: NoteKind;
  /** Plain words for the log. */
  reason: string;
  /** The player it went to, when filled in or given to the quarterback. */
  to?: string;
}

export interface CheckedPlay {
  play: StatsPlay;
  notes: CheckNote[];
}

/** Who is at quarterback for each side, by playerId. Null when the roster has no quarterback on that side. */
export type CurrentQbs = Record<Side, string | null>;

export interface CheckContext {
  qbs: CurrentQbs;
  /** "Heard as" forms by playerId: words Deepgram writes for that player, which name them as well as the surname does. */
  aliases?: ReadonlyMap<string, readonly string[]>;
  /**
   * Events already checked on an earlier read of this play, as "playerId|action"
   * (eventKey). A play rebuilt after an update checks only what is new.
   */
  trusted?: ReadonlySet<string>;
  /** The play before this one that still counts (not a penalty-only play), for R29: a return only follows a kickoff. */
  previous?: StatsPlay | null;
  /**
   * The words the read came from: its transcript lines, first to last, joined.
   * The name check looks here. Absent (a test, or a log with no utterances),
   * it looks at the summary and the evidence quote instead.
   */
  lines?: string;
}

/** The key `trusted` holds an event under. */
export function eventKey(event: Pick<StatsEvent, "playerId" | "action">): string {
  return `${event.playerId}|${event.action}`;
}

type Roster = ReadonlyMap<string, StatsRosterPlayer> | readonly StatsRosterPlayer[];

/** The events that say which side had the ball. */
const OFFENSIVE_ACTIONS: ReadonlySet<Action> = new Set([
  "pass_complete",
  "pass_incomplete",
  "pass_intercepted",
  "rush",
  "reception",
  "sacked",
  "fumble",
  "punt",
  "field_goal",
  "extra_point",
]);

const PASS_ACTIONS: ReadonlySet<Action> = new Set(["pass_complete", "pass_incomplete", "pass_intercepted"]);

/** The plays from scrimmage, the only ones whose sides are checked. On a kick the reader is not consistent about which side it calls the offense. */
const SCRIMMAGE: ReadonlySet<StatsPlay["playType"]> = new Set(["run", "pass", "sack"]);

/** Must belong to the team with the ball, on a play from scrimmage. */
const OFFENSE_ONLY: ReadonlySet<Action> = new Set(["rush", "reception"]);

/** Must belong to the other team, on a play from scrimmage with no turnover and no return. */
const DEFENSE_ONLY: ReadonlySet<Action> = new Set(["tackle", "sack", "pass_breakup", "forced_fumble"]);

/** A turnover or a return: after one, either side can make a tackle. */
const TURNOVER_OR_RETURN: ReadonlySet<Action> = new Set(["interception", "pass_intercepted", "fumble_recovery", "kick_return", "punt_return"]);

const FAIR_CATCH = /\bfair[\s-]*(?:catch|caught)\b|\bcalls? for (?:a |the )?fair\b/i;

// -----------------------------------------------------------------------------
// The offense and the quarterbacks.
// -----------------------------------------------------------------------------

/**
 * Which side had the ball: the side most of the play's offensive events belong
 * to, with the reader's own `offense` as one more vote and the tie-break. One
 * wrongly credited event cannot outvote what the reader said about the play.
 */
export function playOffense(play: StatsPlay, roster: Roster): Side | null {
  const players = index(roster);
  const votes: Record<Side, number> = { home: 0, away: 0 };
  for (const event of play.events) {
    if (!OFFENSIVE_ACTIONS.has(event.action)) continue;
    const side = players.get(event.playerId)?.side;
    if (side) votes[side] += 1;
  }
  if (play.offense) votes[play.offense] += 1;
  if (votes.home === votes.away) return play.offense;
  return votes.home > votes.away ? "home" : "away";
}

/** The quarterback a side starts the game with: the most season pass attempts, else the first one listed. */
export function defaultQb(roster: Roster, side: Side): string | null {
  let best: string | null = null;
  let bestAttempts = -1;
  for (const player of list(roster)) {
    if (player.side !== side || !hasGroup(player.position, "qb")) continue;
    const attempts = player.season?.pass_att ?? 0;
    if (best === null || attempts > bestAttempts) {
      best = player.playerId;
      bestAttempts = attempts;
    }
  }
  return best;
}

/**
 * Who is at quarterback now, per side: the roster's starter until a different
 * quarterback on that side is credited with a pass or a sack on a play that
 * passed these checks. `priorPlays` are the plays already read, as checked, in
 * order. Derived from them every time, never stored, so a reload gets it back.
 */
export function currentQbs(roster: Roster, priorPlays: readonly StatsPlay[]): CurrentQbs {
  const players = index(roster);
  const qbs: CurrentQbs = { home: defaultQb(roster, "home"), away: defaultQb(roster, "away") };
  for (const play of priorPlays) {
    for (const event of play.events) {
      if (!PASS_ACTIONS.has(event.action) && event.action !== "sacked") continue;
      const player = players.get(event.playerId);
      if (!player || !hasGroup(player.position, "qb")) continue;
      qbs[player.side] = player.playerId;
    }
  }
  return qbs;
}

// -----------------------------------------------------------------------------
// The check.
// -----------------------------------------------------------------------------

/**
 * One play, checked. The play comes back with its events as they should be
 * credited (dropped, filled in, or given to the quarterback), its offense
 * settled, and a note for everything that changed. `fill` false skips the
 * fill-ins, for a read that only adds to a play already here: the play as a
 * whole is filled in once the two are joined.
 */
export function checkPlay(read: StatsPlay, roster: Roster, context: CheckContext, fill = true): CheckedPlay {
  // A wiped-out play and a two-point try add nothing (R7, R11); nothing to check.
  if (wipedOut(read) || read.playType === "two_point") return { play: read, notes: [] };

  const misread = fixMisreads(read, context.previous ?? null);
  const play = misread.play;
  const players = index(roster);
  const offense = playOffense(play, roster);
  const text = context.lines !== undefined && context.lines.trim().length > 0 ? context.lines : `${play.summary} ${play.evidence}`;
  const aliasesOf = (playerId: string) => context.aliases?.get(playerId) ?? players.get(playerId)?.aliases ?? [];
  const named = (player: StatsRosterPlayer) => isNamedIn(player.last, text, aliasesOf(player.playerId));
  const scrimmage = SCRIMMAGE.has(play.playType) && offense !== null;
  const defense: Side | null = offense === null ? null : offense === "home" ? "away" : "home";
  const turnoverOrReturn = play.events.some((event) => TURNOVER_OR_RETURN.has(event.action));

  const notes: CheckNote[] = [...misread.notes];
  const kept: StatsEvent[] = [];
  const qbFor = (side: Side | null) => (side ? context.qbs[side] : null);
  const drop = (event: StatsEvent, rule: RuleId, reason: string) => notes.push({ event, rule, kind: "dropped", reason });

  for (const event of play.events) {
    if (context.trusted?.has(eventKey(event))) {
      kept.push(event);
      continue;
    }
    const player = event.playerId === "" ? undefined : players.get(event.playerId);

    // The passer rule (R14), the one credit code may give to someone else: a
    // pass (or a sack) with no usable passer is the quarterback's on the field.
    // Usable: on the roster, on the team with the ball, named in the words, and
    // a quarterback or said to have thrown it.
    if (PASS_ACTIONS.has(event.action) || event.action === "sacked") {
      const usable =
        player !== undefined &&
        (!scrimmage || player.side === offense) &&
        named(player) &&
        (hasGroup(player.position, "qb") || event.action === "sacked" || saidToThrow(player.last, text, aliasesOf(player.playerId)));
      if (usable) {
        kept.push(event);
        continue;
      }
      const qb = qbFor(offense);
      if (qb && qb !== event.playerId) {
        kept.push({ ...event, playerId: qb, estimated: true });
        notes.push({ event, rule: "R14", kind: "filled", reason: `${passerFault(player, offense, scrimmage, named)}; the quarterback on the field`, to: qb });
      } else if (qb) kept.push(event);
      else if (event.playerId === "" || !player) kept.push(event); // R9 drops it, and says so, when the rules run.
      else drop(event, "R18", "not named in the words it was read from");
      continue;
    }

    // Nobody could be read for this. A carry or a catch by nobody stays as it
    // is, so the strip can show it, and credits nobody (R9).
    if (event.playerId === "" || !player) {
      kept.push(event);
      continue;
    }

    // R12: on a play from scrimmage, a carry or a catch by the team without
    // the ball, or a tackle, sack, breakup or forced fumble by the team with
    // it (unless the ball changed hands or was returned), cannot be true.
    if (scrimmage && OFFENSE_ONLY.has(event.action) && player.side !== offense) {
      drop(event, "R12", `on the team without the ball for a ${words(event.action)}`);
      continue;
    }
    if (scrimmage && !turnoverOrReturn && DEFENSE_ONLY.has(event.action) && player.side !== defense) {
      drop(event, "R12", `on the team with the ball for a ${words(event.action)}`);
      continue;
    }

    // R18: the words the play was read from must name the player.
    if (!named(player)) {
      drop(event, "R18", "not named in the words it was read from");
      continue;
    }
    kept.push(event);
  }

  // Contradictions.
  const has = (action: Action) => kept.some((event) => event.action === action);
  if (has("pass_incomplete") && has("reception") && !has("pass_complete")) {
    for (const event of kept.filter((each) => each.action === "reception")) {
      notes.push({ event, rule: "R19", kind: "dropped", reason: "an incomplete pass is nobody's catch" });
    }
    remove(kept, (event) => event.action === "reception");
  }
  const breakups = kept.filter((event) => event.action === "pass_breakup");
  if (breakups.length > 1) {
    const inEvidence = breakups.find((event) => {
      const player = players.get(event.playerId);
      return player !== undefined && isNamedIn(player.last, play.evidence, aliasesOf(player.playerId));
    });
    const keep = inEvidence ?? breakups[0];
    for (const event of breakups) {
      if (event === keep) continue;
      notes.push({ event, rule: "R20", kind: "dropped", reason: "one breakup per pass" });
    }
    remove(kept, (event) => event.action === "pass_breakup" && event !== keep);
  }
  if (has("punt_return") && FAIR_CATCH.test(`${play.summary} ${play.evidence}`)) {
    for (const event of kept.filter((each) => each.action === "punt_return")) {
      notes.push({ event, rule: "R21", kind: "dropped", reason: "a fair catch is not a return" });
    }
    remove(kept, (event) => event.action === "punt_return");
  }

  if (fill) {
    fillIn(play, kept, notes, qbFor(offense));
    fillPunter(play, kept, notes, offense, list(roster));
  }
  return { play: { ...play, offense: offense ?? play.offense, events: kept }, notes };
}

/**
 * R15: a punt with no punter named is that side's punter, when exactly one
 * player on that side is listed as a punter. None or several, and it stays
 * blank. Estimated, like every fill.
 */
function fillPunter(play: StatsPlay, kept: StatsEvent[], notes: CheckNote[], offense: Side | null, roster: readonly StatsRosterPlayer[]) {
  if (play.playType !== "punt" || offense === null || kept.some((event) => event.action === "punt")) return;
  const punters = roster.filter((player) => player.side === offense && hasGroup(player.position, "p"));
  if (punters.length !== 1) return;
  const event: StatsEvent = { playerId: punters[0].playerId, action: "punt", yards: null, yardsSource: null, made: null, estimated: true };
  kept.push(event);
  notes.push({ event, rule: "R15", kind: "filled", reason: "a punt with no punter named: that side's only punter", to: punters[0].playerId });
}

/** Why a pass event's player could not keep it, in words for the log. */
function passerFault(
  player: StatsRosterPlayer | undefined,
  offense: Side | null,
  scrimmage: boolean,
  named: (player: StatsRosterPlayer) => boolean,
): string {
  if (!player) return "no passer could be read";
  if (scrimmage && player.side !== offense) return "on the team without the ball";
  if (!named(player)) return "not named in the words it was read from";
  return "not a quarterback and not said to have thrown it";
}

/**
 * The fill-ins, each with only one possible answer: a catch, a breakup, an
 * interception or a pass play with no passer is the quarterback's on the field
 * (R16), and a sack with no sacked quarterback is his too (R17).
 */
function fillIn(play: StatsPlay, kept: StatsEvent[], notes: CheckNote[], qb: string | null) {
  if (!qb) return;
  const has = (action: Action) => kept.some((event) => event.action === action);
  const passer = kept.some((event) => PASS_ACTIONS.has(event.action));
  if (!passer && !kept.some((event) => event.playerId === qb && event.action === "reception")) {
    const catchEvent = kept.find((event) => event.action === "reception");
    const add = (action: Action, yards: StatsEvent["yards"], yardsSource: StatsEvent["yardsSource"], reason: string) => {
      const event: StatsEvent = { playerId: qb, action, yards, yardsSource, made: null, estimated: true };
      kept.push(event);
      notes.push({ event, rule: "R16", kind: "filled", reason, to: qb });
    };
    if (catchEvent) add("pass_complete", catchEvent.yards, catchEvent.yardsSource, "a catch means a completion by the quarterback on the field");
    else if (has("interception")) add("pass_intercepted", null, null, "an interception means the quarterback on the field threw it");
    else if (has("pass_breakup")) add("pass_incomplete", null, null, "a breakup means an incomplete pass by the quarterback on the field");
    else if (play.playType === "pass" && !has("sacked") && !has("sack")) {
      add("pass_incomplete", null, null, "a pass play with no passer read: an attempt by the quarterback on the field");
    }
  }
  const sackEvent = kept.find((event) => event.action === "sack");
  if (sackEvent && !has("sacked")) {
    const event: StatsEvent = { playerId: qb, action: "sacked", yards: sackEvent.yards, yardsSource: sackEvent.yardsSource, made: null, estimated: true };
    kept.push(event);
    notes.push({ event, rule: "R17", kind: "filled", reason: "a sack means the quarterback on the field was sacked", to: qb });
  }
}

// -----------------------------------------------------------------------------
// Two misreads the words give away.
// -----------------------------------------------------------------------------

/** "pitch", "handoff", "toss": a run from scrimmage, whatever the reader called it. */
const RUN_WORDS = /\b(?:pitch(?:es|ed)?|hand(?:s|ed)?\s?(?:it\s)?off|handoff|toss(?:es|ed)?|draw|keeper|sweep|carr(?:y|ies|ied))\b/i;

/**
 * R29: a return that did not follow a kickoff is a run. A kickoff only follows
 * a score or starts a half; after a missed field goal or a punt, a pitch or a
 * handoff is a run from scrimmage.
 */
export function fixMisreads(play: StatsPlay, previous: StatsPlay | null): CheckedPlay {
  const notes: CheckNote[] = [];
  let events = play.events;
  let playType = play.playType;
  const text = `${play.summary} ${play.evidence}`;

  if (events.some((event) => event.action === "kick_return")) {
    const afterKick =
      previous !== null &&
      (previous.playType === "punt" ||
        (previous.playType === "field_goal" && previous.events.some((event) => event.action === "field_goal" && event.made === false)));
    if (playType !== "kickoff" || (afterKick && RUN_WORDS.test(text))) {
      events = events.map((event) => {
        if (event.action !== "kick_return") return event;
        notes.push({ event, rule: "R29", kind: "changed", reason: "no kickoff to return: a run from scrimmage", to: event.playerId });
        return { ...event, action: "rush" };
      });
      if (playType === "kickoff") playType = "run";
    }
  }

  if (notes.length === 0) return { play, notes };
  return { play: { ...play, events, playType }, notes };
}

function words(action: Action): string {
  return action.replace(/_/g, " ");
}

function remove(events: StatsEvent[], test: (event: StatsEvent) => boolean) {
  for (let i = events.length - 1; i >= 0; i--) if (test(events[i])) events.splice(i, 1);
}

function index(roster: Roster): ReadonlyMap<string, StatsRosterPlayer> {
  if (roster instanceof Map) return roster;
  return new Map((roster as readonly StatsRosterPlayer[]).map((player) => [player.playerId, player]));
}

function list(roster: Roster): readonly StatsRosterPlayer[] {
  return roster instanceof Map ? [...roster.values()] : (roster as readonly StatsRosterPlayer[]);
}
