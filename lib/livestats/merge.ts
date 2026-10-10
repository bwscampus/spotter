import type { LoggedDrop } from "@/lib/log/statsLog";
import type { Action, StatsEvent, StatsPlay } from "./types";

// =============================================================================
// One play, one record (Oct 6, after the two Gemini games: the reader said 47
// times that a read updated an earlier play, and did it well; the code's own
// merges, by lines that touched and by play type, swallowed six real plays,
// and an update could only add, which kept an overturned touchdown and threw
// away the read that had the right receiver).
//
// Which play a read is, in this order and nothing else:
//   1. Its transcript lines are mostly an applied play's: the lines they share
//      are more than half of the shorter of the two. Then it is that play.
//   2. The reader says it updates a play, by id. Then it is that play.
//   3. Otherwise it is a new play. Sharing one line, or starting on the next
//      line, does not make it the same play.
//
// What an update does: a credit one player holds (the passer, the receiver,
// the runner or sacked quarterback, the kicker, the punter, the returner, the
// interceptor, the fumbler) goes to the update's player, or stays when the
// update names nobody; credits several players can hold are added, each
// player once; the update's yards replace the old, except that a worked-out
// figure never replaces a stated one; a touchdown or a kick's result can be
// added by any update and taken away only by one whose lines cover the read
// that set it; the play type follows the newest read, and a play is a run or a
// sack, never both. Totals are worked out from the play list, so an update can
// never count a play twice. Pure.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** How many recent plays the reader may name in `updates` (the ones it was sent). */
export const UPDATE_LOOKBACK = 5;

/**
 * A read is an applied play when the lines they share are more than this
 * share of the shorter of the two: half, so one line in common between two
 * plays of four lines each is two plays, and a recap of the same lines is one.
 */
export const SAME_LINES_SHARE = 0.5;

// =============================================================================

/** What the merge needs to know about a play already read. */
export interface ReadPlay {
  playId: string;
  play: StatsPlay;
  status: string;
}

/** The credits one player holds on a play, by slot: a later read naming someone else replaces the earlier one. */
const SLOT: Partial<Record<Action, string>> = {
  pass_complete: "passer",
  pass_incomplete: "passer",
  pass_intercepted: "passer",
  reception: "receiver",
  rush: "carrier",
  sacked: "carrier",
  field_goal: "kicker",
  extra_point: "kicker",
  punt: "punter",
  kick_return: "returner",
  punt_return: "returner",
  interception: "interceptor",
  fumble: "fumbler",
};

/** The slot a credit fills, when only one player can hold it on a play ("passer", "carrier"); undefined for a credit several can share. */
export function slotOf(action: Action): string | undefined {
  return SLOT[action];
}

/** Which slots and shared credits each play from scrimmage can have, for when a later read changes the play type. */
const FITS: Record<"run" | "pass" | "sack", ReadonlySet<string>> = {
  run: new Set(["carrier:rush", "fumbler", "tackle", "forced_fumble", "fumble_recovery"]),
  pass: new Set(["passer", "receiver", "interceptor", "fumbler", "tackle", "pass_breakup", "forced_fumble", "fumble_recovery"]),
  sack: new Set(["carrier:sacked", "fumbler", "sack", "forced_fumble", "fumble_recovery"]),
};

/** A play type that says what the play was. A flag or "other" read adds to a play without changing what it was. */
function saysWhatHappened(type: StatsPlay["playType"]): boolean {
  return type !== "penalty_only" && type !== "other";
}

function lineCount(play: Pick<StatsPlay, "seqStart" | "seqEnd">): number {
  return play.seqEnd - play.seqStart + 1;
}

/** Whether two reads are mostly the same lines (rule 1). */
export function sameLines(a: Pick<StatsPlay, "seqStart" | "seqEnd">, b: Pick<StatsPlay, "seqStart" | "seqEnd">): boolean {
  const shared = Math.min(a.seqEnd, b.seqEnd) - Math.max(a.seqStart, b.seqStart) + 1;
  if (shared <= 0) return false;
  return shared > SAME_LINES_SHARE * Math.min(lineCount(a), lineCount(b));
}

/**
 * The applied play this read is, or null when it is new: mostly the same
 * lines (the newest such play), else the play the reader names by id among
 * the last UPDATE_LOOKBACK. A discarded play is nobody's target.
 */
export function findUpdateTarget<P extends ReadPlay>(read: StatsPlay, plays: readonly P[]): P | null {
  const live = plays.filter((play) => play.status !== "discarded");
  for (let i = live.length - 1; i >= 0; i--) if (sameLines(read, live[i].play)) return live[i];
  if (read.updates) {
    const named = live.slice(-UPDATE_LOOKBACK).find((play) => play.playId === read.updates);
    if (named) return named;
  }
  return null;
}

export interface Merged {
  play: StatsPlay;
  /** What the update changed (rule R22). */
  notes: LoggedDrop[];
  /** False when the update changed nothing: the same play read the same way again. */
  changed: boolean;
}

/** Whether a read's lines run over every line of a range. */
function covers(read: Pick<StatsPlay, "seqStart" | "seqEnd">, range: readonly [number, number]): boolean {
  return read.seqStart <= range[0] && read.seqEnd >= range[1];
}

/** Both reads' words, once each, the earlier first. */
function joinEvidence(earlier: string, later: string): string {
  const a = earlier.trim();
  const b = later.trim();
  if (!b || a === b || a.includes(b)) return a;
  if (!a || b.includes(a)) return b;
  return `${a} … ${b}`;
}

/** The update's yards for an event already held: a figure replaces, except a worked-out one over a stated one; none keeps the old. */
function takeYards(held: StatsEvent, incoming: StatsEvent): Pick<StatsEvent, "yards" | "yardsSource"> {
  if (incoming.yards === null) return { yards: held.yards, yardsSource: held.yardsSource };
  if (held.yards !== null && held.yardsSource === "stated" && incoming.yardsSource !== "stated") return { yards: held.yards, yardsSource: held.yardsSource };
  return { yards: incoming.yards, yardsSource: incoming.yardsSource };
}

/** The lines of the read that set a touchdown or a kick's result; a play from before Oct 6 has its own. */
function setBy(range: readonly [number, number] | undefined, play: StatsPlay): readonly [number, number] {
  return range ?? [play.seqStart, play.seqEnd];
}

/**
 * The earlier play with the later read folded in, by the rules at the top of
 * this file. `update` has been through the check already (lib/livestats/check.ts)
 * with no fill-ins; the session fills the joined play in afterwards.
 */
export function mergeUpdate(earlier: StatsPlay, update: StatsPlay): Merged {
  const notes: LoggedDrop[] = [];
  const note = (event: Pick<StatsEvent, "playerId" | "action">, reason: string, to?: string) =>
    notes.push({ playerId: event.playerId, action: event.action, rule: "R22", reason, kind: "changed", ...(to ? { to } : {}) });

  const playType = saysWhatHappened(update.playType) ? update.playType : earlier.playType;
  let events: StatsEvent[] = earlier.events.map((event) => ({ ...event }));

  // The play type follows the newest read; a credit the new type cannot have goes.
  if (playType !== earlier.playType && playType in FITS && earlier.playType in FITS) {
    const fits = FITS[playType as keyof typeof FITS];
    events = events.filter((event) => {
      const slot = SLOT[event.action];
      const keep = slot ? fits.has(slot) || fits.has(`${slot}:${event.action}`) : fits.has(event.action);
      if (!keep) note(event, `a later read says the play was a ${playType}`);
      return keep;
    });
  }

  for (const incoming of update.events) {
    const slot = SLOT[incoming.action];
    if (slot) {
      const index = events.findIndex((event) => SLOT[event.action] === slot);
      if (index === -1) {
        events.push({ ...incoming });
        note(incoming, "added by a later read");
        continue;
      }
      const held = events[index];
      // Nobody named for it, or the same player again: the old player stays, with the update's yards if it has some.
      if (incoming.playerId === "" || (held.playerId === incoming.playerId && held.action === incoming.action)) {
        const yards = takeYards(held, incoming);
        if (yards.yards !== held.yards || yards.yardsSource !== held.yardsSource) {
          events[index] = { ...held, ...yards };
          note(held, "yards from a later read");
        }
        if (held.playerId === incoming.playerId && held.estimated && !incoming.estimated) {
          const settled = { ...events[index] };
          delete settled.estimated;
          events[index] = settled;
        }
        continue;
      }
      // A different player, or the same one doing something else (a completion
      // overturned to an incompletion, a run that was a sack).
      const sameAction = held.action === incoming.action;
      events[index] = { ...incoming, ...(sameAction ? takeYards(held, incoming) : {}), made: held.made };
      note(held, sameAction ? "a later read named a different player" : `a later read says ${incoming.action.replace(/_/g, " ")}`, incoming.playerId);
      continue;
    }
    // Credits several players can hold: added, each player once.
    const same = events.findIndex((event) => event.playerId === incoming.playerId && event.action === incoming.action);
    if (same === -1) {
      events.push({ ...incoming });
      note(incoming, "added by a later read");
    } else {
      const yards = takeYards(events[same], incoming);
      if (yards.yards !== events[same].yards || yards.yardsSource !== events[same].yardsSource) {
        events[same] = { ...events[same], ...yards };
        note(incoming, "yards from a later read");
      }
    }
  }

  // A touchdown: any update adds one; only an update whose lines cover the read that set it takes it away.
  let touchdown = earlier.touchdown;
  let touchdownFrom: readonly [number, number] | undefined = earlier.touchdownFrom;
  if (update.touchdown && !earlier.touchdown) {
    touchdown = true;
    touchdownFrom = [update.seqStart, update.seqEnd];
    notes.push({ playerId: "", action: "touchdown", rule: "R22", reason: "a later read says this play scored", kind: "changed" });
  } else if (!update.touchdown && earlier.touchdown && saysWhatHappened(update.playType) && covers(update, setBy(earlier.touchdownFrom, earlier))) {
    touchdown = false;
    touchdownFrom = undefined;
    notes.push({ playerId: "", action: "touchdown", rule: "R22", reason: "a later read that saw the call says no touchdown", kind: "changed" });
  }

  // A kick's result: the same rule, on the kick the play holds.
  let madeFrom: readonly [number, number] | undefined = earlier.madeFrom;
  const said = update.events.find((event) => (event.action === "field_goal" || event.action === "extra_point") && event.made !== null);
  const kick = events.findIndex((event) => event.action === "field_goal" || event.action === "extra_point");
  if (said && kick !== -1 && events[kick].made !== said.made) {
    const before = earlier.events.find((event) => event.action === events[kick].action)?.made ?? null;
    if (before === null || covers(update, setBy(earlier.madeFrom, earlier))) {
      events[kick] = { ...events[kick], made: said.made };
      madeFrom = [update.seqStart, update.seqEnd];
      note(events[kick], before === null ? "the kick's result from a later read" : "a later read that saw the kick says otherwise");
    }
  }

  const flagged = update.penalty !== undefined && (update.penalty.on !== "none" || update.penalty.noPlay || update.penalty.beforeSnap);
  const play: StatsPlay = {
    ...earlier,
    seqStart: Math.min(earlier.seqStart, update.seqStart),
    seqEnd: Math.max(earlier.seqEnd, update.seqEnd),
    quarter: earlier.quarter ?? update.quarter,
    clock: earlier.clock ?? update.clock,
    down: earlier.down ?? update.down,
    distance: earlier.distance ?? update.distance,
    offense: earlier.offense ?? update.offense,
    playType,
    nullified: earlier.nullified || update.nullified,
    touchdown,
    firstDown: earlier.firstDown || update.firstDown,
    confidence: Math.max(earlier.confidence, update.confidence),
    startSpot: earlier.startSpot ?? update.startSpot ?? null,
    endSpot: update.endSpot ?? earlier.endSpot ?? null,
    shortBy: update.shortBy ?? earlier.shortBy ?? null,
    score: update.score ?? earlier.score ?? null,
    penalty: flagged ? update.penalty : earlier.penalty,
    // The newest read says what the play was, so its line is the play's line.
    summary: saysWhatHappened(update.playType) && update.summary ? update.summary : earlier.summary,
    evidence: joinEvidence(earlier.evidence, update.evidence),
    events,
  };
  if (touchdownFrom) play.touchdownFrom = [touchdownFrom[0], touchdownFrom[1]];
  else delete play.touchdownFrom;
  if (madeFrom) play.madeFrom = [madeFrom[0], madeFrom[1]];
  if (update.nullified && !earlier.nullified) notes.push({ playerId: "", action: "flag", rule: "R22", reason: "a later read says a flag wiped this play out", kind: "changed" });
  return { play, notes, changed: JSON.stringify(play) !== JSON.stringify(earlier) };
}
