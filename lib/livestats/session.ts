import { cardLines, type CardLines } from "@/lib/cards/lines";
import { FOOTBALL_STAT_KEYS, type FootballStatKey } from "@/lib/cards/statKeys";
import { isYardKey, tallyChanges, type StatChange, type TonightTally } from "@/lib/cards/tonight";
import { foldStats, type FoldedPlay, type LoggedDrop, type PlayStatus } from "@/lib/log/statsLog";
import { applyPlay, type AppliedPlay, type DroppedEvent, type Roster } from "./apply";
import { checkPlay, currentQbs, eventKey, type CheckNote } from "./check";
import { flagged, gainEvents, gainIs, lateStatedYards, stateAfter, withGain, workOutYards, type GameState, type WorkedOut } from "./gameState";
import { findUpdateTarget, mergeUpdate, sameLines, slotOf } from "./merge";
import { namedIn, nameIndex } from "./names";
import { wipedOut } from "./penalty";
import { scoreDecisions } from "./scoreboard";
import { NO_PENALTY, type Penalty, type RecentPlay, type StatsEvent, type StatsPlay, type StatsRosterPlayer, type UnnamedCredit } from "./types";

// =============================================================================
// One game's live stats as the announcer works them (docs/V3_DEFINITION.md
// 8.6, as Jed set it on Oct 2): every play Spotter reads waits in line with
// exactly what it would change for each player, and counts only once he OKs
// it. Enter OKs the play at the front of the line, Backspace discards it, U
// takes back the last OK, and any name, stat or amount can be corrected first.
// A play nobody answers waits; nothing is ever skipped or counted on its own.
//
// Pure: plays and decisions in, a new session out. The live screen runs the
// loop and the keys (components/livestats/); this decides what they mean.
// Tonight's numbers are never kept as a running count: they are worked out
// from the OK'd plays every time, so undo and a correction are both exact.
// =============================================================================

export interface SessionPlay {
  playId: string;
  play: StatsPlay;
  /** As they stand now, corrections included. Each one is one item in the strip. */
  changes: StatChange[];
  /** As the rules first worked them out, for the log. */
  original: StatChange[];
  dropped: LoggedDrop[];
  status: PlayStatus;
  edited: boolean;
  /** Times a later read or the code added to it (lib/livestats/merge.ts, gameState.ts). */
  updated: number;
  readAt: number;
  /** When it was last OK'd, discarded or taken back. Orders undo. */
  decidedAt: number | null;
}

export interface StatsSession {
  /** Every play read, in the order it was read. */
  plays: SessionPlay[];
}

export const EMPTY_SESSION: StatsSession = { plays: [] };

/** A correction to one play, from a click on one word of one item. */
export type Correction =
  | { type: "player"; index: number; playerId: string }
  | { type: "stat"; index: number; key: FootballStatKey }
  | { type: "amount"; index: number; amount: number | null }
  | { type: "remove"; index: number }
  | { type: "add"; change: StatChange };

/** A session after one step, and the play the step was about, for the log. Null play: nothing happened. */
export interface Step {
  session: StatsSession;
  play: SessionPlay | null;
}

// -----------------------------------------------------------------------------
// Reading plays in.
// -----------------------------------------------------------------------------

// =============================================================================
// TUNING
// =============================================================================

/**
 * A play Claude rates below this is one it was unsure of, and every stat it
 * adds carries a ~ (testrun, Oct 3), on tonight's line and on the season total
 * it went into, for as long as the play counts. Claude's own scale: below 0.4
 * is "guessing at the shape of it", above 0.8 is "the transcript said it
 * plainly" (lib/livestats/prompt.ts).
 */
export const UNSURE_BELOW = 0.6;

/**
 * How many lines after a play's last line the name check reads (Oct 10): the
 * booth often names the player a line or two after the play ("reading the
 * field beautifully there"), and a sentence or two of that comes before the
 * next snap. Never past the next play's first line, and only the name check
 * reads them; yards, the play type and everything else read the play's own.
 */
export const LATE_NAME_LINES = 5;

// =============================================================================

/**
 * A play's numbers as strip items: each player in the order they appear, each
 * stat in sheet order. `estimated` is the ~: yards worked out rather than said
 * (rule R8), or anything at all from a play Claude was unsure of.
 */
export function changesOf(applied: AppliedPlay): StatChange[] {
  const unsure = applied.play.confidence < UNSURE_BELOW;
  const changes: StatChange[] = [];
  for (const delta of applied.deltas) {
    for (const key of FOOTBALL_STAT_KEYS) {
      const amount = delta.stats[key];
      if (amount !== undefined) {
        changes.push({ playerId: delta.playerId, key, amount, estimated: unsure || delta.estimated.includes(key) });
      } else if (delta.unknownYards.includes(key)) {
        // The stat happened and its yards were not said: a "?" to fill in.
        changes.push({ playerId: delta.playerId, key, amount: null, estimated: false });
      }
    }
  }
  return changes;
}

/** What reading plays needs besides the plays themselves. */
export interface ReadContext {
  /** "Heard as" forms by playerId, for the check's repairs (lib/livestats/check.ts). */
  aliases?: ReadonlyMap<string, readonly string[]>;
  /**
   * Everything said so far, by seq: the merge safety net looks for a
   * down-and-distance call between two reads, and a yardage said a few lines
   * late is read from it (lib/livestats/gameState.ts).
   */
  utterances?: readonly { seq: number; text: string; offsetMs?: number }[];
  /**
   * The last line the reader has seen (the window's last seq). The name check
   * reads no further, because a play started in lines the reader has not seen
   * yet would not be known. Absent, the last of `utterances`.
   */
  readThrough?: number;
}

export interface Read {
  session: StatsSession;
  /** New plays, at the back of the line. */
  added: SessionPlay[];
  /** Plays already read that a later read or the code added to, as they now stand. */
  updated: SessionPlay[];
}

/**
 * Plays as Claude read them, into the session. `plays` are already deduped
 * against the watermark (newPlays in lib/plays/window.ts), updates excepted.
 *
 * For each one: if it is a later read of a play already here (the reader
 * says so, or the safety net in lib/livestats/merge.ts does), it is folded
 * into that play, which is checked and applied again in place and keeps its
 * id and status. Otherwise it goes through the check (lib/livestats/check.ts:
 * the right side, the right position, named in the words, the passer filled
 * in), its yards are worked out from where the ball is when nobody said them
 * (lib/livestats/gameState.ts), the stat rules run, and it joins the back of
 * the line waiting. Then the play before it on the same possession gets its
 * yards back-filled from this play's down and distance or start spot, and
 * from any yardage said late. What waits in line is the play as checked; the
 * play as Claude sent it stays in the log's stats_reply record. The check's
 * notes, the merge's and the rules' drops are one list, each with its rule.
 */
export function readPlays(
  session: StatsSession,
  plays: readonly StatsPlay[],
  roster: Roster,
  at: number,
  context: ReadContext = {},
): Read {
  const utterances = context.utterances ?? [];
  const linesOf = (play: StatsPlay) => readLines(utterances, play.seqStart, play.seqEnd);
  const readThrough = context.readThrough ?? utterances.reduce((last, utterance) => Math.max(last, utterance.seq), Number.NEGATIVE_INFINITY);
  let current: SessionPlay[] = [...session.plays];
  const taken = new Set(current.map((play) => play.playId));
  const added: SessionPlay[] = [];
  const updated = new Map<string, SessionPlay>();

  /** The plays before `playId` (or every play) that still count, as checked: who is at quarterback and where the ball is follow from them. */
  const checkedBefore = (playId: string | null): StatsPlay[] => {
    const before: StatsPlay[] = [];
    for (const play of current) {
      if (play.playId === playId) break;
      if (play.status !== "discarded") before.push(play.play);
    }
    return before;
  };
  const replaceIn = (next: SessionPlay) => {
    current = current.map((play) => (play.playId === next.playId ? next : play));
    updated.set(next.playId, next);
  };

  /**
   * The last line the name check reads for a play: up to LATE_NAME_LINES after
   * its last line, before the next play's first line (any play read, here or
   * in this reply), and no further than the reader has seen.
   */
  const namesEnd = (play: StatsPlay, self: string | StatsPlay): number => {
    let next = Number.POSITIVE_INFINITY;
    for (const other of current) {
      if (other.status === "discarded" || other.playId === self || other.play.seqStart <= play.seqEnd) continue;
      next = Math.min(next, other.play.seqStart);
    }
    for (const other of plays) if (other !== self && other.seqStart > play.seqEnd) next = Math.min(next, other.seqStart);
    return Math.max(play.seqEnd, Math.min(play.seqEnd + LATE_NAME_LINES, next - 1, readThrough));
  };
  const laterLinesOf = (play: StatsPlay, end: number) => readLines(utterances, play.seqEnd + 1, end);
  const players: ReadonlyMap<string, StatsRosterPlayer> =
    roster instanceof Map ? roster : new Map((roster as readonly StatsRosterPlayer[]).map((player) => [player.playerId, player]));

  /**
   * The play with one unnamed credit given back, when the words now name the
   * player: the fill it was given to comes off, and the credit goes through
   * the check again (side, passer, named in the longer lines) on its own.
   * Null when it still fails, or when a later read has put someone else in its
   * place.
   */
  const restoreCredit = (play: StatsPlay, credit: UnnamedCredit, text: string, entry: SessionPlay): StatsPlay | null => {
    const original = credit.event;
    let events = play.events;
    if (credit.to) {
      const fill = events.findIndex((event) => event.playerId === credit.to && event.action === original.action && event.estimated);
      if (fill === -1) return null;
      events = events.filter((_, index) => index !== fill);
    }
    const slot = slotOf(original.action);
    const taken = slot
      ? events.some((event) => slotOf(event.action) === slot)
      : events.some((event) => event.playerId === original.playerId && event.action === original.action);
    if (taken) return null;
    const candidate: StatsPlay = { ...play, events: [...events, original] };
    const before = checkedBefore(entry.playId);
    const checked = checkPlay(candidate, roster, {
      qbs: currentQbs(roster, before),
      aliases: context.aliases,
      previous: lastPlay(current.slice(0, current.findIndex((each) => each.playId === entry.playId)))?.play ?? null,
      trusted: new Set(events.map(eventKey)),
      lines: linesOf(play),
      laterLines: text,
    });
    const stands = checked.unnamed.length === 0 && checked.play.events.some((event) => event.playerId === original.playerId && event.action === original.action);
    return stands ? candidate : null;
  };

  /** "named 2 lines after the play", from the first line past the play's own that names the player. */
  const namedAfter = (playerId: string, play: StatsPlay): string => {
    const player = players.get(playerId);
    if (player) {
      const names = nameIndex(roster);
      for (const utterance of utterances) {
        if (utterance.seq <= play.seqEnd) continue;
        if (namedIn(player, utterance.text, names, context.aliases?.get(playerId) ?? player.aliases ?? [])) {
          const lines = utterance.seq - play.seqEnd;
          return `named ${lines} line${lines === 1 ? "" : "s"} after the play`;
        }
      }
    }
    return "named in the lines after the play";
  };

  /**
   * A play already here, rebuilt around a changed play: every credit on it has
   * been checked already, so only the fill-ins run again, then the rules.
   */
  const rebuilt = (target: SessionPlay, play: StatsPlay, notes: readonly LoggedDrop[]): SessionPlay => {
    const prior = checkedBefore(target.playId);
    const trusted = new Set(play.events.map(eventKey));
    const checked = checkPlay(play, roster, { qbs: currentQbs(roster, prior), aliases: context.aliases, trusted, lines: linesOf(play) });
    const applied = applyPlay(checked.play, roster);
    return {
      ...target,
      play: checked.play,
      // A correction the announcer typed outlives a later read.
      changes: target.edited ? target.changes : changesOf(applied),
      dropped: mergeNotes(target.dropped, notes, checked.notes.map(noteToLogged), applied.dropped.map(dropToLogged)),
      updated: target.updated + 1,
    };
  };

  for (const play of plays) {
    const target = findUpdateTarget(play, current);
    if (target) {
      // The later read is checked on its own lines first, with no fill-ins:
      // the joined play is filled in once, when it is rebuilt.
      const end = namesEnd(play, play);
      const own = checkPlay(
        play,
        roster,
        { qbs: currentQbs(roster, checkedBefore(target.playId)), aliases: context.aliases, lines: linesOf(play), laterLines: laterLinesOf(play, end) },
        false,
      );
      const merged = mergeUpdate(target.play, own.play);
      if (!merged.changed) continue;
      const notes = [...own.notes.map(noteToLogged), ...merged.notes];
      const before = stateAfter(checkedBefore(target.playId));
      const settled = withNameCheck(fillYards(merged.play, before, null, utterances, notes), own.unnamed, end);
      replaceIn(rebuilt(target, settled, notes));
      continue;
    }

    const prior = checkedBefore(null);
    const previous = lastPlay(current);
    const end = namesEnd(play, play);
    const checked = checkPlay(play, roster, {
      qbs: currentQbs(roster, prior),
      aliases: context.aliases,
      previous: previous?.play ?? null,
      lines: linesOf(play),
      laterLines: laterLinesOf(play, end),
    });
    const notes: LoggedDrop[] = checked.notes.map(noteToLogged);
    let settled = withNameCheck(withSetters(fillYards(checked.play, stateAfter(prior), null, utterances, notes)), checked.unnamed, end);
    // R28: a run with a hold behind the ball still counts, with its yards unknown.
    if (duringPlayFoul(settled.penalty) && !wipedOut(settled) && settled.playType === "run") settled = withoutGain(settled, notes);
    const applied = applyPlay(settled, roster);
    const changes = changesOf(applied);
    let playId = `${play.seqStart}-${play.seqEnd}`;
    for (let n = 2; taken.has(playId); n++) playId = `${play.seqStart}-${play.seqEnd}-${n}`;
    taken.add(playId);
    const entry: SessionPlay = {
      playId,
      play: settled,
      changes,
      original: changes,
      dropped: [...notes, ...applied.dropped.map(dropToLogged)],
      status: "pending",
      edited: false,
      updated: 0,
      readAt: at,
      decidedAt: null,
    };
    current.push(entry);
    added.push(entry);

    // The play before this one on the same possession: its yards from this
    // play's down and distance or start spot, or from a yardage said late.
    const earlier = previousOnPossession(current, entry);
    if (earlier) {
      const earlierNotes: LoggedDrop[] = [];
      const before = stateAfter(checkedBefore(earlier.playId));
      const refilled = fillYards(earlier.play, before, entry.play, utterances, earlierNotes, entry.play.seqStart);
      if (refilled !== earlier.play) replaceIn(rebuilt(earlier, refilled, earlierNotes));
    }
  }

  // Credits taken away only because the player was not named yet: checked
  // again now that more lines are in, until their few lines have all arrived
  // or the next play has started. A play the announcer corrected is his.
  for (const entry of [...current]) {
    const pending = entry.play.nameCheck;
    if (!pending || pending.credits.length === 0 || entry.status === "discarded" || entry.edited || wipedOut(entry.play)) continue;
    const end = namesEnd(entry.play, entry.playId);
    if (end <= pending.through) continue;
    const text = laterLinesOf(entry.play, end);
    let play = entry.play;
    const restoredNotes: LoggedDrop[] = [];
    const left: UnnamedCredit[] = [];
    for (const credit of pending.credits) {
      const back = text === undefined ? null : restoreCredit(play, credit, text, entry);
      if (back) {
        play = back;
        restoredNotes.push({
          playerId: credit.event.playerId,
          action: credit.event.action,
          rule: credit.rule,
          reason: `${namedAfter(credit.event.playerId, entry.play)}: the reader's credit stands`,
          kind: "restored",
          ...(credit.to ? { to: credit.event.playerId } : {}),
        });
      } else left.push(credit);
    }
    const base = { ...play };
    delete base.nameCheck;
    play = withNameCheck(base, left, end);
    if (restoredNotes.length > 0) replaceIn(rebuilt(entry, play, restoredNotes));
    // Nothing came back: only how far it has read moves, which needs no log record.
    else current = current.map((each) => (each.playId === entry.playId ? { ...each, play } : each));
  }

  // The scoreboard: extra points nobody called or nobody gave a result for,
  // and field goals whose result was never said (R25, R26). It never takes a
  // touchdown away.
  const rosterList = roster instanceof Map ? [...roster.values()] : [...roster];
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (const decision of scoreDecisions(current, rosterList)) {
      if (decision.kind === "xp_result") {
        const target = current.find((play) => play.playId === decision.playId);
        if (!target) continue;
        const kick = target.play.events.find((event) => event.action === "extra_point" && event.made === null);
        if (!kick) continue;
        const events = target.play.events.map((event) => (event === kick ? { ...event, made: true, estimated: true } : event));
        const note: LoggedDrop = {
          playerId: kick.playerId,
          action: "extra_point",
          rule: "R25",
          reason: "the score went up 7: the extra point was good",
          kind: "changed",
        };
        replaceIn(rebuilt(target, { ...target.play, events }, [note]));
        changed = true;
      } else if (decision.kind === "fg_result") {
        const target = current.find((play) => play.playId === decision.playId);
        if (!target) continue;
        const kick = target.play.events.find((event) => event.action === "field_goal" && event.made === null);
        if (!kick) continue;
        const events = target.play.events.map((event) => (event === kick ? { ...event, made: decision.made, estimated: true } : event));
        const note: LoggedDrop = {
          playerId: kick.playerId,
          action: "field_goal",
          rule: "R26",
          reason: decision.made ? "the score went up 3: the kick was good" : "the score did not move: the kick missed",
          kind: "changed",
        };
        replaceIn(rebuilt(target, { ...target.play, events }, [note]));
        changed = true;
      } else if (decision.kind === "credit_xp") {
        const playId = `xp-${decision.afterPlayId}`;
        if (taken.has(playId)) continue;
        taken.add(playId);
        const kick: StatsEvent = { playerId: decision.kicker, action: "extra_point", yards: null, yardsSource: null, made: true, estimated: true };
        const play: StatsPlay = {
          seqStart: decision.seq,
          seqEnd: decision.seq,
          quarter: decision.quarter,
          clock: null,
          down: null,
          distance: null,
          offense: decision.side,
          playType: "extra_point",
          nullified: false,
          touchdown: false,
          firstDown: false,
          confidence: 1,
          summary: "Extra point good, from the score",
          evidence: "",
          events: [kick],
          updates: "",
          startSpot: null,
          endSpot: null,
          shortBy: null,
          score: null,
          penalty: NO_PENALTY,
        };
        const applied = applyPlay(play, roster);
        const changes = changesOf(applied);
        const entry: SessionPlay = {
          playId,
          play,
          changes,
          original: changes,
          dropped: [
            { playerId: decision.kicker, action: "extra_point", rule: "R25", reason: "the score went up 7 and no extra point was read", kind: "filled", to: decision.kicker },
            ...applied.dropped.map(dropToLogged),
          ],
          status: "pending",
          edited: false,
          updated: 0,
          readAt: at,
          decidedAt: null,
        };
        current.push(entry);
        added.push(entry);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { session: { plays: current }, added, updated: [...updated.values()] };
}

/**
 * The play with these unnamed credits added to what it already waits on, and
 * how far the name check has read. The play itself when there is nothing.
 */
function withNameCheck(play: StatsPlay, credits: readonly UnnamedCredit[], through: number): StatsPlay {
  const held = play.nameCheck?.credits ?? [];
  if (held.length === 0 && credits.length === 0) return play;
  return { ...play, nameCheck: { through: Math.max(through, play.nameCheck?.through ?? through), credits: [...held, ...credits] } };
}

/** A new play remembers the lines that set its touchdown and its kick's result, which only an update covering them may undo. */
function withSetters(play: StatsPlay): StatsPlay {
  const lines: [number, number] = [play.seqStart, play.seqEnd];
  const kicked = play.events.some((event) => (event.action === "field_goal" || event.action === "extra_point") && event.made !== null);
  if (!play.touchdown && !kicked) return play;
  return { ...play, ...(play.touchdown ? { touchdownFrom: lines } : {}), ...(kicked ? { madeFrom: lines } : {}) };
}

/** The last play that still counts and is not a penalty-only play. */
function lastPlay(plays: readonly SessionPlay[]): SessionPlay | null {
  for (let i = plays.length - 1; i >= 0; i--) {
    const play = plays[i];
    if (play.status === "discarded" || play.play.playType === "penalty_only") continue;
    return play;
  }
  return null;
}

/** An offensive foul during the play (a hold behind the ball): the play stands, its yards do not. */
function duringPlayFoul(penalty: Penalty | undefined): boolean {
  return penalty !== undefined && penalty.on === "offense" && !penalty.beforeSnap && !penalty.noPlay;
}

function withoutGain(play: StatsPlay, notes: LoggedDrop[]): StatsPlay {
  const targets = gainEvents(play);
  if (targets.length === 0 || targets.every((event) => event.yards === null)) return play;
  const events = play.events.map((event) => {
    if (!targets.includes(event) || event.yards === null) return event;
    notes.push({ playerId: event.playerId, action: event.action, rule: "R28", reason: "yards unknown: a flag on the offense during the play", kind: "changed" });
    return { ...event, yards: null, yardsSource: null };
  });
  return { ...play, events };
}

/**
 * The words a play was read from: its transcript lines, first to last, joined.
 * Undefined when none of them is to hand (a test, or a log read without its
 * utterances), and the check falls back to the summary and the evidence.
 */
function readLines(utterances: readonly { seq: number; text: string }[], from: number, to: number): string | undefined {
  const lines = utterances.filter((utterance) => utterance.seq >= from && utterance.seq <= to).map((utterance) => utterance.text);
  return lines.length > 0 ? lines.join(" ") : undefined;
}

/**
 * The play's gain when nobody said a number (rule R23): a yardage said a few
 * lines late counts as stated and may replace a figure that was only worked
 * out, or a stated one when the words plainly look back at the play; failing
 * that, the spots, the next play's down and distance, or the phrasing.
 */
function fillYards(
  play: StatsPlay,
  state: GameState,
  next: StatsPlay | null,
  utterances: readonly { seq: number; text: string }[],
  notes: LoggedDrop[],
  beforeSeq?: number,
): StatsPlay {
  let result = play;
  if (gainIs(result) === "none") return result;
  const late = lateStatedYards(utterances, result.seqEnd, beforeSeq);
  if (late && (gainIs(result) !== "stated" || late.lookingBack)) {
    const current = gainEvents(result)[0];
    if (!(current.yardsSource === "stated" && current.yards === late.yards)) {
      const lines = late.seq - result.seqEnd;
      const filled = withGain(result, { yards: late.yards, source: "stated" }, "R23", `yards said ${lines} line${lines === 1 ? "" : "s"} after the play`);
      notes.push(...filled.notes);
      result = filled.play;
    }
  }
  if (gainIs(result) === "unknown") {
    const worked = workOutYards(result, state, next);
    if (worked) {
      const filled = withGain(result, worked, "R23", reasonFor(worked));
      notes.push(...filled.notes);
      result = filled.play;
    }
  }
  return result;
}

function reasonFor(worked: WorkedOut): string {
  switch (worked.source) {
    case "spots":
      return "yards worked out from the yard lines";
    case "downs":
      return "yards worked out from the next down and distance";
    default:
      return "yards worked out from the yards short of the first down";
  }
}

/**
 * The play right before `entry` that still counts, when its yards may be
 * worked out from `entry`: the same possession, and nothing between them, so
 * not a flag read on its own, a wiped-out play, a kick, or a play with a flag
 * on it (Oct 6: the ball spot is only trusted when nothing came between).
 */
function previousOnPossession(plays: readonly SessionPlay[], entry: SessionPlay): SessionPlay | null {
  const at = plays.indexOf(entry);
  for (let i = at - 1; i >= 0; i--) {
    const candidate = plays[i];
    if (candidate.status === "discarded") continue;
    const play = candidate.play;
    if (play.playType === "penalty_only" || wipedOut(play) || flagged(play)) return null;
    if (play.offense === null || play.offense !== entry.play.offense) return null;
    return candidate;
  }
  return null;
}

function noteToLogged(note: CheckNote): LoggedDrop {
  return {
    playerId: note.event.playerId,
    action: note.event.action,
    rule: note.rule,
    reason: note.reason,
    kind: note.kind,
    ...(note.to ? { to: note.to } : {}),
  };
}

function dropToLogged(drop: DroppedEvent): LoggedDrop {
  return { playerId: drop.event.playerId, action: drop.event.action, rule: drop.rule, reason: drop.reason, kind: "dropped" };
}

/** Everything noted about a play across its reads, each note once. */
function mergeNotes(...lists: ReadonlyArray<readonly LoggedDrop[]>): LoggedDrop[] {
  const seen = new Set<string>();
  const merged: LoggedDrop[] = [];
  for (const list of lists) {
    for (const note of list) {
      const key = `${note.rule}|${note.playerId}|${note.action}|${note.to ?? ""}|${note.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(note);
    }
  }
  return merged;
}

/**
 * The plays in a reply worth reading in: anything past the watermark, and
 * anything before it that is a later read of a play already here, either by
 * the reader's own id (among `recentIds`, the plays it was sent) or because
 * its lines are mostly that play's (lib/livestats/merge.ts). Everything else
 * before the watermark was read already.
 */
export function freshReads(plays: readonly StatsPlay[], session: StatsSession, watermark: number, recentIds: ReadonlySet<string>): StatsPlay[] {
  const live = session.plays.filter((play) => play.status !== "discarded");
  return plays.filter(
    (play) => play.seqEnd > watermark || (play.updates !== undefined && recentIds.has(play.updates)) || live.some((each) => sameLines(play, each.play)),
  );
}

/** The session the log describes, after a reload. */
export function restoreSession(folded: readonly FoldedPlay[]): StatsSession {
  return {
    plays: folded.map((play) => ({
      ...play,
      // Validated when it was read and written by this app; the log keeps it whole.
      play: play.play as StatsPlay,
    })),
  };
}

// -----------------------------------------------------------------------------
// The line, and the announcer's decisions.
// -----------------------------------------------------------------------------

/** Waiting for the announcer, front of the line first. */
export function waiting(session: StatsSession): SessionPlay[] {
  return session.plays.filter((play) => play.status === "pending");
}

/**
 * OK'd, the most recently OK'd first. Plays OK'd in the same millisecond (a
 * reply of three plays counted at once, or a reload's OKs) go newest read
 * first, by their place in the line, so U takes back the last of them, and
 * the latest stat and the Take back button point at the same play.
 */
export function counted(session: StatsSession): SessionPlay[] {
  return session.plays
    .map((play, index) => ({ play, index }))
    .filter(({ play }) => play.status === "applied")
    .sort((a, b) => (b.play.decidedAt ?? 0) - (a.play.decidedAt ?? 0) || b.index - a.index)
    .map(({ play }) => play);
}

/** OK a play: the front of the line, or the one clicked. */
export function okPlay(session: StatsSession, at: number, playId?: string): Step {
  return decide(session, "applied", at, playId);
}

/** Throw a play away: the front of the line, or the one clicked. */
export function discardPlay(session: StatsSession, at: number, playId?: string): Step {
  return decide(session, "discarded", at, playId);
}

function decide(session: StatsSession, status: "applied" | "discarded", at: number, playId?: string): Step {
  const target = playId
    ? session.plays.find((play) => play.playId === playId && play.status === "pending")
    : waiting(session)[0];
  if (!target) return { session, play: null };
  return replace(session, { ...target, status, decidedAt: at });
}

/**
 * Takes back the last OK: that play stops counting and goes back in line, so
 * it can be corrected and OK'd again, or discarded. Pressing U again takes
 * back the one before.
 */
export function undoLast(session: StatsSession, at: number): Step {
  const last = counted(session)[0];
  if (!last) return { session, play: null };
  return replace(session, { ...last, status: "pending", decidedAt: at });
}

/**
 * A correction from the strip. A new player on an item moves every item of
 * the old player on that play, because a misheard name is misheard for the
 * whole play. A typed amount is the announcer's own number, so it is no longer
 * worked out.
 */
export function correctPlay(session: StatsSession, playId: string, correction: Correction): Step {
  const target = session.plays.find((play) => play.playId === playId);
  if (!target || target.status === "discarded") return { session, play: null };
  const changes = [...target.changes];

  if (correction.type === "add") {
    changes.push(correction.change);
  } else {
    const item = changes[correction.index];
    if (!item) return { session, play: null };
    if (correction.type === "remove") {
      changes.splice(correction.index, 1);
    } else if (correction.type === "player") {
      for (let i = 0; i < changes.length; i++) {
        if (changes[i].playerId === item.playerId) changes[i] = { ...changes[i], playerId: correction.playerId };
      }
    } else if (correction.type === "stat") {
      changes[correction.index] = {
        ...item,
        key: correction.key,
        estimated: item.estimated && isYardKey(correction.key),
      };
    } else {
      const amount = correction.amount;
      changes[correction.index] = {
        ...item,
        amount: amount === null || !Number.isFinite(amount) ? null : amount,
        estimated: false,
      };
    }
  }
  return replace(session, { ...target, changes, edited: true });
}

function replace(session: StatsSession, play: SessionPlay): Step {
  return { session: { plays: session.plays.map((each) => (each.playId === play.playId ? play : each)) }, play };
}

// -----------------------------------------------------------------------------
// What it all adds up to.
// -----------------------------------------------------------------------------

/** Tonight for every player, from the OK'd plays only. */
export function talliesOf(session: StatsSession): Map<string, TonightTally> {
  return tallyChanges(session.plays.filter((play) => play.status === "applied").flatMap((play) => play.changes));
}

/**
 * Each player's card lines with tonight in them, by playerId: SEASON as
 * season plus tonight, and the TONIGHT line. Only players with something
 * tonight are here; everyone else's card says what it said at setup.
 */
export function linesOf(session: StatsSession, roster: readonly StatsRosterPlayer[]): Map<string, CardLines> {
  const season = new Map(roster.map((player) => [player.playerId, player.season ?? null]));
  const lines = new Map<string, CardLines>();
  for (const [playerId, tally] of talliesOf(session)) lines.set(playerId, cardLines(season.get(playerId) ?? null, tally));
  return lines;
}

/** Where reading has got: the highest seqEnd of any play read, kept or not. */
export function watermarkOf(session: StatsSession, fallback: number): number {
  return session.plays.reduce((highest, play) => Math.max(highest, play.play.seqEnd), fallback);
}

/** The plays Claude should not read again: the last few it already read and nobody threw away. */
export function recentSummaries(session: StatsSession, count: number): string[] {
  return recentPlays(session, count).map((play) => play.summary);
}

/** The same plays with their ids, so a later read can say which one it adds to. */
export function recentPlays(session: StatsSession, count: number): RecentPlay[] {
  return session.plays
    .filter((play) => play.status !== "discarded")
    .slice(-count)
    .map((play) => ({ playId: play.playId, summary: play.play.summary }));
}

// -----------------------------------------------------------------------------
// After a reload: everything the loop knew, rebuilt from the browser log.
// -----------------------------------------------------------------------------

export interface RestoredStats {
  session: StatsSession;
  /** What was said, in the order it was said. Its index in this list is its seq. */
  utterances: Array<{ text: string; at: number }>;
  /** Where the stats switch was left. On unless the log says it was turned off. */
  on: boolean;
  offMidGame: boolean;
  playsApplied: number;
  playsUndone: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
}

/** The loop's state as the log leaves it. The log is the only place tonight's stats are kept. */
export function restoreFromLog(records: readonly { kind: string }[]): RestoredStats {
  const restored: RestoredStats = {
    session: restoreSession(foldStats(records)),
    utterances: [],
    on: true,
    offMidGame: false,
    playsApplied: 0,
    playsUndone: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
  };
  for (const record of records) {
    const any = record as Record<string, unknown> & { kind: string };
    if (any.kind === "utterance" && typeof any.text === "string" && typeof any.at === "number") {
      if (any.text.trim().length > 0) restored.utterances.push({ text: any.text, at: any.at });
    } else if (any.kind === "stats_switch" && typeof any.on === "boolean") {
      restored.on = any.on;
      if (!any.on) restored.offMidGame = true;
    } else if (any.kind === "stats_decision") {
      if (any.decision === "ok") restored.playsApplied += 1;
      if (any.decision === "undo") restored.playsUndone += 1;
    } else if (any.kind === "stats_reply" && any.ok === true) {
      restored.tokensIn += count(any.tokensIn);
      restored.tokensOut += count(any.tokensOut);
      restored.tokensCached += count(any.tokensCached);
    }
  }
  return restored;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

// -----------------------------------------------------------------------------
// A refresh that fixes a name or a number (Jed, Oct 5: "refresh rosters
// shouldn't change the tonight stats").
//
// A player's id is made of their side, number and surname ("H22-LANGAN"), and
// tonight is kept by id. Refresh rosters is where a misspelled surname or a
// wrong number gets fixed, and that changes the id, which would leave every
// stat the player has already earned tonight on an id nobody has any more.
// The stats are moved to the new id instead.
// -----------------------------------------------------------------------------

/**
 * Where an id that is no longer on the roster went: the one player on the new
 * roster with the same side and number, or failing that the same side and
 * surname. Null when it is nobody, or ambiguous: two players who could be
 * them is a guess, and a guess would put one player's stats on another.
 */
function movedTo(old: StatsRosterPlayer, now: readonly StatsRosterPlayer[], taken: ReadonlySet<string>): string | null {
  const free = now.filter((player) => !taken.has(player.playerId) && player.side === old.side);
  const bare = (jersey: string | null) => (jersey ?? "").trim().replace(/^#/, "");
  const sameNumber = bare(old.jersey) === "" ? [] : free.filter((player) => bare(player.jersey) === bare(old.jersey));
  if (sameNumber.length === 1) return sameNumber[0].playerId;
  const sameName = free.filter((player) => player.last.trim().toLowerCase() === old.last.trim().toLowerCase());
  return sameName.length === 1 ? sameName[0].playerId : null;
}

/**
 * The session with every id that is not on `current` moved to the player it
 * became, found through `past` (the rosters the game has had before: the one
 * a refresh replaced, or every roster the log's game records carry). The same
 * session, untouched, when nothing moved, which is nearly always.
 */
export function remapSession(
  session: StatsSession,
  current: readonly StatsRosterPlayer[],
  past: readonly (readonly StatsRosterPlayer[])[],
): StatsSession {
  const known = new Set(current.map((player) => player.playerId));
  const used = new Set<string>();
  for (const play of session.plays) {
    for (const change of [...play.changes, ...play.original]) used.add(change.playerId);
    for (const event of play.play.events) used.add(event.playerId);
    for (const drop of play.dropped) used.add(drop.playerId);
  }
  // Ids that earned something, and that nobody on the roster has any more.
  const gone = [...used].filter((id) => !known.has(id));
  if (gone.length === 0) return session;

  const moves = new Map<string, string>();
  for (const id of gone) {
    const old = past.flatMap((roster) => roster).find((player) => player.playerId === id);
    if (!old) continue;
    const to = movedTo(old, current, new Set([...used].filter((other) => known.has(other) && other !== id)));
    if (to !== null) moves.set(id, to);
  }
  if (moves.size === 0) return session;

  const move = (id: string) => moves.get(id) ?? id;
  return {
    ...session,
    plays: session.plays.map((play) => ({
      ...play,
      play: { ...play.play, events: play.play.events.map((event) => ({ ...event, playerId: move(event.playerId) })) },
      changes: play.changes.map((change) => ({ ...change, playerId: move(change.playerId) })),
      original: play.original.map((change) => ({ ...change, playerId: move(change.playerId) })),
      dropped: play.dropped.map((drop) => ({ ...drop, playerId: move(drop.playerId) })),
    })),
  };
}
