import { cardLines, type CardLines } from "@/lib/cards/lines";
import { movedTo } from "@/lib/cards/playerKey";
import { FOOTBALL_STAT_KEYS, type FootballStatKey } from "@/lib/cards/statKeys";
import { isYardKey, tallyWithBooth, type StatChange, type TonightTally } from "@/lib/cards/tonight";
import { foldBooth, foldStats, type FoldedBoothLine, type FoldedPlay, type LoggedDrop, type PlayStatus, type TypedEdit } from "@/lib/log/statsLog";
import { applyPlay, type AppliedPlay, type DroppedEvent, type Roster } from "./apply";
import { checkPlay, confirmedQbs, currentQbs, defaultQb, eventKey, leadingRushers, passResultFromDowns, type CheckNote } from "./check";
import { drivesOf } from "./drives";
import { resolveSpots } from "./fieldWords";
import { gainEvents, gainIs, lateStatedYards, stateAfter, withGain, withoutGainFigure, workOutYards, type GameState, type WorkedOut } from "./gameState";
import { READER_SOURCES, readerWorked, SOLVER_SOURCES, solveDrive, type DriveSolution, type LedgerGap, type LedgerNext, type PlayHints } from "./ledger";
import { matchUpdate, mergeUpdate, sameLines, slotOf } from "./merge";
import { namedIn, nameIndex } from "./names";
import { wipedOut, withDefensiveNoPlay } from "./penalty";
import { resolveIds } from "./resolveIds";
import { kickerFor, scoreDecisions } from "./scoreboard";
import { checkBoothLines, type BoothLine, type RefusedBoothLine } from "./statLines";
import { NO_PENALTY, type BoothStatLine, type Penalty, type RecentPlay, type RuleId, type Side, type StatsEvent, type StatsPlay, type StatsRosterPlayer, type TeamWords, type UnnamedCredit } from "./types";

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
  /**
   * What the announcer typed, in order (Oct 10). A later read rebuilds the
   * play's changes and these are laid on top, so only what was typed is
   * locked. Absent on a play corrected before Oct 10, whose changes stay as
   * they were typed.
   */
  edits?: TypedEdit[];
  /** Times a later read or the code added to it (lib/livestats/merge.ts, gameState.ts). */
  updated: number;
  readAt: number;
  /** When it was last OK'd, discarded or taken back. Orders undo. */
  decidedAt: number | null;
}

export interface StatsSession {
  /** Every play read, in the order it was read. */
  plays: SessionPlay[];
  /**
   * The stat lines the booth read on air and the code accepted (fix 6, Part
   * 1, R41), in the order they were read. Each sets that player's total for
   * that stat from its line on (tallyWithBooth). Absent on a session built
   * before them, which is the same as none.
   */
  boothLines?: BoothLine[];
}

export const EMPTY_SESSION: StatsSession = { plays: [], boothLines: [] };

/** The booth lines a session holds, none for one built before them. */
export function boothLinesOf(session: StatsSession): readonly BoothLine[] {
  return session.boothLines ?? [];
}

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

/**
 * How many lines before a play's first line the name check reads too (Oct
 * 22, the v6 push): the ball carrier or the target is often named before the
 * snap, in the formation or the setup ("[name] the single setback"), and the
 * play then only says "hands it to the back". Never back past the last line
 * of the play before; only the name check reads them.
 */
export const EARLY_NAME_LINES = 2;

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
  /** R51 (Oct 22): a run nobody was named for goes to tonight's leading rusher. Off unless set (LIVE_STATS_GUESS_RB, replays only). */
  guessBack?: boolean;
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
  /** Players marked out tonight (Part 3), by playerId: a credit to one is dropped (R35, lib/livestats/check.ts). */
  out?: ReadonlySet<string>;
  /** The team names and cue words (Part 4): "Tigers 30" is the Tigers' 30 (lib/livestats/fieldWords.ts). */
  teams?: TeamWords | null;
  /**
   * What kind of read these plays came from, when not the usual window: every
   * play it adds or changes gets this note, so the log and the scorer can say
   * what a second look (R38), a drive re-read (R39) or the halftime check
   * (R40) did.
   */
  source?: { rule: Extract<RuleId, "R38" | "R39" | "R40" | "R42" | "R44" | "R50">; reason: string };
  /**
   * A re-read (Part 7, Part 8): the reader was sent these plays by id and may
   * correct any of them, add a play the drive or half missed, or take one out
   * with `remove`. Nothing the announcer typed is ever changed: a corrected
   * play keeps its edits laid on top, and a removal of one is refused.
   */
  reread?: { ids: ReadonlySet<string> };
  /**
   * v7 (Part 5): the play's named credits came from a candidate list the
   * parser already verified against the lines, so the name check (R18) and
   * the passer rule's name test are not run on them again. The side check
   * (R12) and the fill-ins still run, and a credit to nobody (playerId "")
   * still goes to the quarterback on the field or to nobody.
   */
  trustNamed?: boolean;
  /**
   * v7, fix 1 Part 3: the play's offense came from its own words (a
   * possession phrase or the offensive players its lines name). The check
   * takes it as the offense, and a passer or sacked quarterback on the other
   * side goes to the quarterback on the field (R14) as a carrier or receiver
   * there is dropped (R12). Only with trustNamed.
   */
  v7OffenseSaid?: boolean;
}

export interface Read {
  session: StatsSession;
  /** New plays, at the back of the line. */
  added: SessionPlay[];
  /** Plays already read that a later read or the code added to, as they now stand. */
  updated: SessionPlay[];
  /** Plays a re-read took out (Part 7): discarded, with the rule on them, for the log's decision record. */
  removed?: SessionPlay[];
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
  const removed: SessionPlay[] = [];

  /** The plays before `playId` (or every play) that still count, as checked: who is at quarterback and where the ball is follow from them. */
  const checkedBefore = (playId: string | null): StatsPlay[] => {
    const before: StatsPlay[] = [];
    for (const play of current) {
      if (play.playId === playId) break;
      if (play.status !== "discarded") before.push(play.play);
    }
    return before;
  };
  const rosterList: readonly StatsRosterPlayer[] = roster instanceof Map ? [...roster.values()] : (roster as readonly StatsRosterPlayer[]);
  const sideOf = new Map(rosterList.map((player) => [player.playerId, player.side]));
  /** Each side's kicker as the plays before `playId` (or every play) leave it, for R32. */
  const kickersBefore = (playId: string | null): Record<"home" | "away", string | null> => {
    const before: SessionPlay[] = [];
    for (const play of current) {
      if (play.playId === playId) break;
      if (play.status !== "discarded") before.push(play);
    }
    return { home: kickerFor("home", before, rosterList, sideOf), away: kickerFor("away", before, rosterList, sideOf) };
  };
  const replaceIn = (next: SessionPlay) => {
    current = current.map((play) => (play.playId === next.playId ? next : play));
    updated.set(next.playId, next);
  };
  /** Each side's last returner, and whether a quarterback is confirmed, as the plays before `playId` (or every play) leave them. */
  const namesBefore = (playId: string | null) => {
    const before: SessionPlay[] = [];
    for (const play of current) {
      if (play.playId === playId) break;
      if (play.status !== "discarded") before.push(play);
    }
    return { returners: returnersOf(before, sideOf), confirmed: confirmedQbs(roster, before.map((play) => play.play), context.out) };
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
  /**
   * The lines the name check reads before a play: up to EARLY_NAME_LINES
   * before its first line, never back to the last line of a play read before
   * it (any play still counting, here or in this reply).
   */
  const earlierLinesOf = (play: StatsPlay, self: string | StatsPlay): string | undefined => {
    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const other of current) {
      if (other.status === "discarded" || other.playId === self || other.play.seqEnd >= play.seqStart) continue;
      previousEnd = Math.max(previousEnd, other.play.seqEnd);
    }
    for (const other of plays) if (other !== self && other.seqEnd < play.seqStart) previousEnd = Math.max(previousEnd, other.seqEnd);
    const start = Math.max(play.seqStart - EARLY_NAME_LINES, previousEnd + 1);
    return start <= play.seqStart - 1 ? readLines(utterances, start, play.seqStart - 1) : undefined;
  };
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
      qbs: currentQbs(roster, before, context.out),
      kickers: kickersBefore(entry.playId),
      ...namesBefore(entry.playId),
      aliases: context.aliases,
      out: context.out,
      previous: lastPlay(current.slice(0, current.findIndex((each) => each.playId === entry.playId)))?.play ?? null,
      trusted: new Set(events.map(eventKey)),
      lines: linesOf(play),
      earlierLines: earlierLinesOf(play, entry.playId),
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

  const rebuilt = (target: SessionPlay, play: StatsPlay, notes: readonly LoggedDrop[]): SessionPlay => rebuildPlay(current, target, play, notes, roster, context);

  for (const read of plays) {
    // R33: an id written with extra words, or without its number, is the
    // roster id it plainly means. Once, here, before anything else reads it.
    const resolved = resolveIds(read, players);
    // R37: a spot's half, or a spot the reader left out, from the words beside the yard line.
    const spotted = resolveSpots(resolved.play, linesOf(resolved.play), context.teams ?? null);
    const play = spotted.play;
    const sourceNote: LoggedDrop[] = context.source ? [{ playerId: "", action: "read", rule: context.source.rule, reason: context.source.reason, kind: "noted" }] : [];
    // R53 (Oct 26): how two readers' readings became this play.
    if (read.readers) sourceNote.push({ playerId: "", action: "read", rule: "R53", reason: `two readers: ${read.readers.replace(/_/g, " ")}`, kind: "noted" });
    const matched = [...sourceNote, ...resolved.notes.map(noteToLogged), ...spotted.notes];
    const match = matchUpdate(play, current, players, context.reread?.ids);
    // A re-read taking a play out (Part 7): only a play it was sent, never one the announcer corrected.
    if (play.remove && context.reread) {
      const target = match?.target ?? match?.refused;
      if (!target || !context.reread.ids.has(target.playId)) continue;
      const rule = context.source?.rule ?? "R39";
      if (target.edited) {
        replaceIn({ ...target, dropped: mergeNotes(target.dropped, [{ playerId: "", action: "remove", rule, reason: "the re-read says this was not a play; refused, the announcer corrected it", kind: "noted" }]) });
        continue;
      }
      const gone: SessionPlay = {
        ...target,
        status: "discarded",
        decidedAt: at,
        dropped: mergeNotes(target.dropped, [{ playerId: "", action: "remove", rule, reason: `${context.source?.reason ?? "a re-read"}: this was not a play, taken out`, kind: "dropped" }]),
      };
      current = current.map((each) => (each.playId === gone.playId ? gone : each));
      updated.delete(gone.playId);
      removed.push(gone);
      continue;
    }
    if (match?.refused) {
      // R34: an update the reader sent for a play on the other team. Dropped
      // whole, logged on the play it named, which stays as it was.
      const refused = match.refused;
      const lost: LoggedDrop[] = (play.events.length > 0 ? play.events : [{ playerId: "", action: "update" as const }]).map((event) => ({
        playerId: event.playerId,
        action: event.action,
        rule: "R34",
        reason: `${match.reason}: the update was dropped, the play stands as it was`,
        kind: "dropped",
      }));
      replaceIn({ ...refused, dropped: mergeNotes(refused.dropped, matched, lost) });
      continue;
    }
    const target = match?.target;
    if (target) {
      // The later read is checked on its own lines first, with no fill-ins:
      // the joined play is filled in once, when it is rebuilt.
      const end = namesEnd(play, read);
      const own = checkPlay(
        play,
        roster,
        {
          qbs: currentQbs(roster, checkedBefore(target.playId), context.out),
          kickers: kickersBefore(target.playId),
          ...namesBefore(target.playId),
          aliases: context.aliases,
          out: context.out,
          lines: linesOf(play),
          earlierLines: earlierLinesOf(play, read),
          laterLines: laterLinesOf(play, end),
        },
        false,
      );
      const merged = mergeUpdate(target.play, own.play);
      if (!merged.changed) continue;
      const notes = [...matched, ...own.notes.map(noteToLogged), ...merged.notes];
      const before = stateAfter(checkedBefore(target.playId));
      // R46: a defensive holding, illegal contact or pass interference foul accepted on a pass makes it a no-play.
      const flagged46 = withDefensiveNoPlay(merged.play, linesOf(merged.play));
      notes.push(...flagged46.notes);
      const settled = withNameCheck(fillYards(flagged46.play, before, notes), own.unnamed, end);
      replaceIn(rebuilt(target, settled, notes));
      continue;
    }

    const previous = lastPlay(current);
    const prior = checkedBefore(null);
    const end = namesEnd(play, read);
    const checked = checkPlay(play, roster, {
      qbs: currentQbs(roster, prior, context.out),
      kickers: kickersBefore(null),
      ...namesBefore(null),
      aliases: context.aliases,
      out: context.out,
      previous: previous?.play ?? null,
      lines: linesOf(play),
      earlierLines: earlierLinesOf(play, read),
      laterLines: laterLinesOf(play, end),
      ...(context.guessBack ? { guessBack: leadingRushers(roster, prior, context.out) } : {}),
      // v7: the named credits are the candidate list's, already verified; the sides are still checked.
      ...(context.trustNamed ? { trusted: new Set(play.events.filter((event) => event.playerId !== "").map(eventKey)), recheckSides: { typed: new Set<string>() }, ...(context.v7OffenseSaid ? { v7Offense: true } : {}) } : {}),
    });
    const notes: LoggedDrop[] = [...matched, ...checked.notes.map(noteToLogged)];
    // R46: a defensive holding, illegal contact or pass interference foul accepted on a pass makes it a no-play.
    const flagged46 = withDefensiveNoPlay(checked.play, linesOf(checked.play));
    notes.push(...flagged46.notes);
    let settled = withNameCheck(withSetters(fillYards(flagged46.play, stateAfter(prior), notes)), checked.unnamed, end);
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

  // The first quarterback named on a side (fix 6, Part 4c): the earlier
  // passes on that side that were filled with the roster's default go to him.
  for (const side of ["home", "away"] as const) {
    const live = () => current.filter((play) => play.status !== "discarded").map((play) => play.play);
    const before = confirmedQbs(roster, session.plays.filter((play) => play.status !== "discarded").map((play) => play.play), context.out)[side];
    if (before || !confirmedQbs(roster, live(), context.out)[side]) continue;
    const qb = currentQbs(roster, live(), context.out)[side];
    const fallback = defaultQb(roster, side, context.out);
    if (!qb || !fallback || qb === fallback) continue;
    for (const entry of [...current]) {
      if (entry.status === "discarded" || entry.edited || wipedOut(entry.play)) continue;
      const filled = entry.play.events.filter((event) => event.estimated && event.playerId === fallback && (PASS_OR_SACKED.has(event.action)));
      if (filled.length === 0) continue;
      const events = entry.play.events.map((event) => (filled.includes(event) ? { ...event, playerId: qb } : event));
      const notes: LoggedDrop[] = filled.map((event) => ({ playerId: event.playerId, action: event.action, rule: "R14", reason: "the first quarterback named on this side: the pass filled with the roster's default is his", kind: "changed", to: qb }));
      replaceIn(rebuildPlay(current, entry, { ...entry.play, events }, notes, roster, context));
    }
  }

  // The drive ledger (fix 6, Part 2, R43): every drive's gains from every
  // fact at once, after everything above has placed this read's plays.
  if (plays.length > 0) {
    // R52 first: a pass the next snap says was caught is then a gain for the ledger to work out.
    for (const next of settlePassResults(current, roster, context)) replaceIn(next);
    for (const next of settlePlays(current, roster, context)) replaceIn(next);
  }
  // A play added in this read and changed again by what came after it in the
  // same read is one new play, as it now stands.
  const fresh = added.map((entry) => current.find((play) => play.playId === entry.playId) ?? entry);
  for (const entry of fresh) updated.delete(entry.playId);

  return { session: { ...session, plays: current }, added: fresh, updated: [...updated.values()], ...(removed.length > 0 ? { removed } : {}) };
}

/**
 * A play already here, rebuilt around a changed play: every credit on it has
 * been checked already, so only the side check (R12, Oct 10: an update can
 * bring in credits from another read, checked only against that read's own
 * sides), the fill-ins and the rules run again. Credits for a player the
 * announcer typed are his, and are never dropped.
 */
function rebuildPlay(current: readonly SessionPlay[], target: SessionPlay, play: StatsPlay, notes: readonly LoggedDrop[], roster: Roster, context: ReadContext): SessionPlay {
  const utterances = context.utterances ?? [];
  const rosterList: readonly StatsRosterPlayer[] = roster instanceof Map ? [...roster.values()] : (roster as readonly StatsRosterPlayer[]);
  const sideOf = new Map(rosterList.map((player) => [player.playerId, player.side]));
  const before: SessionPlay[] = [];
  for (const each of current) {
    if (each.playId === target.playId) break;
    if (each.status !== "discarded") before.push(each);
  }
  const trusted = new Set(play.events.map(eventKey));
  const checked = checkPlay(play, roster, {
    qbs: currentQbs(roster, before.map((each) => each.play), context.out),
    kickers: { home: kickerFor("home", before, rosterList, sideOf), away: kickerFor("away", before, rosterList, sideOf) },
    returners: returnersOf(before, sideOf),
    confirmed: confirmedQbs(roster, before.map((each) => each.play), context.out),
    aliases: context.aliases,
    out: context.out,
    trusted,
    recheckSides: { typed: typedPlayers(target.edits) },
    lines: readLines(utterances, play.seqStart, play.seqEnd),
  });
  const applied = applyPlay(checked.play, roster);
  return {
    ...target,
    play: checked.play,
    // What the announcer typed is laid on top of what the rules now make of
    // the play; a correction from before Oct 10 (no edits) is kept whole.
    changes: target.edited && !target.edits ? target.changes : layOn(changesOf(applied), target.edits ?? []),
    dropped: mergeNotes(target.dropped, notes, checked.notes.map(noteToLogged), applied.dropped.map(dropToLogged)),
    updated: target.updated + 1,
  };
}

// -----------------------------------------------------------------------------
// The drive ledger (fix 6, Part 2, R43), applied.
// -----------------------------------------------------------------------------

/** "big run", "first down", "moves the chains": the words say the play gained. */
const SAYS_GAIN = /\b(?:first down|1st down|big (?:run|gain|play|catch|pickup)|moves? the chains|picks? up|pickup|gain of|good for|converts?)\b/i;

/** The plays the ledger places: every play of every drive, with what the words around each say. */
function ledgerDrives(current: readonly SessionPlay[], roster: Roster, context: ReadContext) {
  const utterances = context.utterances ?? [];
  const rosterList: readonly StatsRosterPlayer[] = roster instanceof Map ? [...roster.values()] : (roster as readonly StatsRosterPlayer[]);
  const sideOf = new Map(rosterList.map((player) => [player.playerId, player.side]));
  // In the order the plays happened, not the order they were read: a play a
  // re-read adds later belongs where its lines are.
  const live = current.filter((play) => play.status !== "discarded").sort((a, b) => a.play.seqStart - b.play.seqStart || a.play.seqEnd - b.play.seqEnd);
  const hintsFor = (entry: SessionPlay): PlayHints => {
    const play = entry.play;
    const lines = readLines(utterances, play.seqStart, play.seqEnd);
    const hints: PlayHints = { saysLoss: saysLoss(play, lines), saysGain: SAYS_GAIN.test(lines ?? play.summary) };
    // A number said a line or two after the play, before the next play begins.
    if (gainIs(play) !== "none" && (gainIs(play) !== "stated" || gainEvents(play).some((event) => event.late))) {
      const after = live.filter((each) => each.playId !== entry.playId && each.play.seqStart > play.seqEnd).reduce((first, each) => Math.min(first, each.play.seqStart), Number.POSITIVE_INFINITY);
      const late = lateStatedYards(utterances, play.seqEnd, after, context.teams ?? null);
      hints.lateYards = late ? late.yards : null;
    }
    return hints;
  };
  return drivesOf(
    live.map((entry) => ({ playId: entry.playId, play: entry.play, status: entry.status, hints: hintsFor(entry), entry })),
    sideOf,
  );
}

/** The state before a play that still counts: who has the ball and where it was left, from the plays before it in the order they happened. */
function stateBefore(current: readonly SessionPlay[], playId: string): GameState {
  const ordered = current.filter((play) => play.status !== "discarded").sort((a, b) => a.play.seqStart - b.play.seqStart || a.play.seqEnd - b.play.seqEnd);
  const before: StatsPlay[] = [];
  for (const play of ordered) {
    if (play.playId === playId) break;
    before.push(play.play);
  }
  return stateAfter(before);
}

/**
 * Every drive solved (lib/livestats/ledger.ts), and the plays whose gain
 * changes as a result, rebuilt: a gain the facts pin, for a play nobody said a
 * number for (R43, estimated, source "ledger"); a worked-out figure the facts
 * no longer pin, taken back to blank; a stated yard the facts contradict,
 * noted and kept; a number said late written as stated while the facts allow
 * it (R23) and taken back when they do not. Kicks are R23's (their lengths
 * come from the spots) and are left alone.
 */
function settlePlays(current: readonly SessionPlay[], roster: Roster, context: ReadContext): SessionPlay[] {
  const changed: SessionPlay[] = [];
  // v7: the yards solver's figures are kept like the reader's own unless the facts contradict them.
  const worked = context.trustNamed ? SOLVER_SOURCES : READER_SOURCES;
  for (const drive of ledgerDrives(current, roster, context)) {
    const solution = solveDrive(drive, stateBefore(current, drive.plays[0].playId));
    for (const entry of drive.plays) {
      const target = entry.entry;
      const play = target.play;
      if (play.playType === "punt" || play.playType === "field_goal" || play.playType === "extra_point" || play.playType === "two_point") continue;
      const result = solution.gains.get(entry.playId);
      if (!result) continue;
      const kind = gainIs(play);
      if (kind === "none") continue;
      const notes: LoggedDrop[] = [];
      let next = play;
      const late = gainEvents(play).some((event) => event.late);
      if (kind === "stated" && !late) {
        if (result.brokenStated && !target.dropped.some((note) => note.rule === "R43" && note.kind === "noted")) {
          changed.push({ ...target, dropped: mergeNotes(target.dropped, [{ playerId: "", action: "yards", rule: "R43", reason: "the yards said for this play do not fit the drive's other facts; kept as said", kind: "noted" }]) });
        }
        continue;
      }
      // A number said after the play is taken back when the drive's facts contradict it, or when the line it came from turned out to begin the next play.
      if (late && (result.brokenLate || entry.hints?.lateYards === null)) {
        const blanked = withoutGainFigure(next, "R23", result.brokenLate ? "the number said after the play does not fit the drive's facts: taken back" : "the number said after the play belongs to the next play: taken back");
        notes.push(...blanked.notes);
        next = blanked.play;
      }
      // The reader's own worked-out figure (from two yard lines or a phrase it read) is its evidence: kept unless the facts contradict it.
      const reader = readerWorked(next, worked);
      if (reader && result.brokenReader) {
        const blanked = withoutGainFigure(next, "R43", "the reader's worked-out figure does not fit the drive's facts: taken back");
        notes.push(...blanked.notes);
        next = blanked.play;
      }
      const lateYards = entry.hints?.lateYards;
      if (!late && !reader && typeof lateYards === "number" && result.lateFits) {
        const filled = withGain(next, { yards: lateYards, source: "stated" }, "R23", "yards said in the lines after the play", true);
        notes.push(...filled.notes);
        next = filled.play;
      } else if (result.pinned && result.gain !== null && gainIs(next) !== "stated" && (!reader || result.brokenReader)) {
        const filled = withGain(next, { yards: result.gain, source: "ledger" }, "R43", `yards from the drive ledger: the downs, the yard lines and the gains said pin ${result.gain}`);
        notes.push(...filled.notes);
        next = filled.play;
      } else if (gainIs(next) === "estimated" && !readerWorked(next, worked) && !result.pinned) {
        const blanked = withoutGainFigure(next, "R43", "a worked-out figure the drive's facts no longer pin: taken back");
        notes.push(...blanked.notes);
        next = blanked.play;
      }
      if (notes.length > 0) changed.push(rebuildPlay(current, target, next, notes, roster, context));
    }
  }
  return changed;
}

/**
 * v7 (Part 6): a gain the yards solver worked out, written onto a play that
 * still counts and rebuilt through the rules, with a note under `rule`. A
 * stated gain is never replaced; the same session when nothing changed.
 */
export function setPlayGain(session: StatsSession, playId: string, worked: WorkedOut, rule: Extract<RuleId, "R47">, reason: string, roster: Roster, context: ReadContext = {}): { session: StatsSession; updated: SessionPlay | null } {
  const target = session.plays.find((play) => play.playId === playId);
  if (!target || target.status === "discarded" || target.edited) return { session, updated: null };
  if (gainIs(target.play) === "stated") return { session, updated: null };
  const filled = withGain(target.play, worked, rule, reason);
  if (filled.notes.length === 0) return { session, updated: null };
  const rebuilt = rebuildPlay(session.plays, target, filled.play, filled.notes, roster, context);
  return { session: { ...session, plays: session.plays.map((play) => (play.playId === playId ? rebuilt : play)) }, updated: rebuilt };
}

/**
 * v7 (Part 9): a play with the shared credits a re-read no longer names
 * (a tackle, a sack, a breakup, a forced fumble, a recovery) taken off, and
 * rebuilt through the rules. The merge only ever adds a shared credit, so a
 * correction that drops one comes through here. The same session when nothing changed.
 */
export function dropSharedCredits(session: StatsSession, playId: string, keep: ReadonlySet<string>, note: LoggedDrop, roster: Roster, context: ReadContext = {}): { session: StatsSession; updated: SessionPlay | null } {
  const target = session.plays.find((play) => play.playId === playId);
  if (!target || target.status === "discarded" || target.edited) return { session, updated: null };
  const events = target.play.events.filter((event) => !SHARED_CREDITS.has(event.action) || keep.has(eventKey(event)));
  if (events.length === target.play.events.length) return { session, updated: null };
  const rebuilt = rebuildPlay(session.plays, target, { ...target.play, events }, [note], roster, context);
  return { session: { ...session, plays: session.plays.map((play) => (play.playId === playId ? rebuilt : play)) }, updated: rebuilt };
}

const SHARED_CREDITS: ReadonlySet<string> = new Set(["tackle", "sack", "pass_breakup", "forced_fumble", "fumble_recovery"]);

/**
 * The ledger run over a session after a decision (OK, discard, undo, a
 * correction): the plays whose gain changed, rebuilt, and the session with
 * them in. The same session when nothing changed.
 */
export function settleLedger(session: StatsSession, roster: Roster, context: ReadContext = {}): { session: StatsSession; updated: SessionPlay[] } {
  const passes = settlePassResults(session.plays, roster, context);
  const byPass = new Map(passes.map((play) => [play.playId, play]));
  const plays = passes.length === 0 ? session.plays : session.plays.map((play) => byPass.get(play.playId) ?? play);
  const updated = new Map(passes.map((play) => [play.playId, play]));
  for (const play of settlePlays(plays, roster, context)) updated.set(play.playId, play);
  if (updated.size === 0) return { session, updated: [] };
  return { session: { ...session, plays: plays.map((play) => updated.get(play.playId) ?? play) }, updated: [...updated.values()] };
}

/**
 * R52 over every drive (./check.ts passResultFromDowns): each pass beside the
 * same drive's next play, in the order they happened, with nothing read
 * between. A play the announcer corrected is his. The plays that changed or
 * gained a note, rebuilt.
 */
function settlePassResults(current: readonly SessionPlay[], roster: Roster, context: ReadContext): SessionPlay[] {
  const utterances = context.utterances ?? [];
  const rosterList: readonly StatsRosterPlayer[] = roster instanceof Map ? [...roster.values()] : (roster as readonly StatsRosterPlayer[]);
  const sideOf = new Map(rosterList.map((player) => [player.playerId, player.side]));
  const live = current.filter((play) => play.status !== "discarded").sort((a, b) => a.play.seqStart - b.play.seqStart || a.play.seqEnd - b.play.seqEnd);
  const changed: SessionPlay[] = [];
  for (const drive of drivesOf(live.map((entry) => ({ playId: entry.playId, play: entry.play, status: entry.status, entry })), sideOf)) {
    for (let index = 0; index + 1 < drive.plays.length; index++) {
      const target = drive.plays[index].entry;
      if (target.edited) continue;
      const result = passResultFromDowns(target.play, drive.plays[index + 1].play, readLines(utterances, target.play.seqStart, target.play.seqEnd), roster);
      if (!result) continue;
      const notes = result.notes.map(noteToLogged);
      if (result.play === target.play) {
        // Only noted: once is enough.
        if (!target.dropped.some((note) => note.rule === "R52")) changed.push({ ...target, dropped: mergeNotes(target.dropped, notes) });
        continue;
      }
      changed.push(rebuildPlay(current, target, result.play, notes, roster, context));
    }
  }
  return changed;
}

/** What the ledger says about the next snap of the drive still going (for the GAME STATE block), or null. */
export function ledgerNext(session: StatsSession, roster: Roster, context: ReadContext = {}): LedgerNext | null {
  const drives = ledgerDrives(session.plays, roster, context);
  const open = drives[drives.length - 1];
  if (!open || open.endedBy !== null) return null;
  return solveDrive(open, stateBefore(session.plays, open.plays[0].playId)).next;
}

/** Every gap the downs show, drive by drive (fix 6, Part 3). */
export function ledgerGaps(session: StatsSession, roster: Roster, context: ReadContext = {}): LedgerGap[] {
  const gaps: LedgerGap[] = [];
  for (const drive of ledgerDrives(session.plays, roster, context)) gaps.push(...solveDrive(drive, stateBefore(session.plays, drive.plays[0].playId)).gaps);
  return gaps;
}

// -----------------------------------------------------------------------------
// A missing snap (fix 6, Part 3).
// -----------------------------------------------------------------------------

/**
 * Words that say the missing snap was not an incomplete pass: a flag, or a
 * run or a sack (fix 6, Part 3, R45). Whole words, general terms.
 */
export const NOT_AN_INCOMPLETION =
  /\b(?:flag|penalty|holding|offside|offsides|false start|illegal|interference|run|runs|ran|running|rush|rushes|carry|carries|carried|handoff|hands? off|keeper|keeps|scramble|scrambles|sack|sacked|pitch|toss|sweep|draw|tackle|tackled|stuffed|stopped|brought down|gain|loss|catch|caught|complete|completion)\b/i;

/**
 * Whether a gap the re-read found nothing in was one incomplete pass (R45):
 * one snap, the down up by one, the distance unchanged, the ball where it
 * was, no flag and no run or sack word in its lines. Anything else stays a
 * gap: its yards belong to nobody.
 */
export function inferredIncompletion(gap: LedgerGap, lines: string): boolean {
  if (gap.snaps !== 1) return false;
  if (gap.before.down === null || gap.after.down !== gap.before.down + 1) return false;
  if (gap.before.distance === null || gap.after.distance === null || gap.before.distance !== gap.after.distance) return false;
  if (gap.before.spot !== null && gap.after.spot !== null && gap.before.spot !== gap.after.spot) return false;
  return !NOT_AN_INCOMPLETION.test(lines);
}

/**
 * The incomplete pass a gap infers (R45), as a play in line: by the
 * quarterback on the field, estimated, on the gap's lines, with its own id so
 * a reload finds it again. Null when that side has no quarterback.
 */
export function addInferredIncompletion(session: StatsSession, gap: LedgerGap, lines: { seqFrom: number; seqTo: number }, roster: Roster, at: number, out?: ReadonlySet<string>): Step {
  const prior = session.plays.filter((play) => play.status !== "discarded").map((play) => play.play);
  const qb = currentQbs(roster, prior, out)[gap.offense];
  if (!qb) return { session, play: null };
  const playId = `gap-${lines.seqFrom}-${lines.seqTo}`;
  if (session.plays.some((play) => play.playId === playId)) return { session, play: null };
  const event: StatsEvent = { playerId: qb, action: "pass_incomplete", yards: null, yardsSource: null, made: null, estimated: true };
  const play: StatsPlay = {
    seqStart: lines.seqFrom,
    seqEnd: lines.seqTo,
    quarter: null,
    clock: null,
    down: gap.before.down,
    distance: gap.before.distance,
    offense: gap.offense,
    playType: "pass",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.5,
    summary: "Incomplete pass, from the downs",
    evidence: "",
    events: [event],
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
      { playerId: qb, action: "pass_incomplete", rule: "R45", reason: "a snap the downs say was run, with the distance and the ball unchanged and no flag, run or sack said: an incomplete pass by the quarterback on the field", kind: "filled", to: qb },
      ...applied.dropped.map(dropToLogged),
    ],
    status: "pending",
    edited: false,
    updated: 0,
    readAt: at,
    decidedAt: null,
  };
  return { session: { ...session, plays: [...session.plays, entry] }, play: entry };
}

/** One drive solved, for a test or the harness. */
export function solveSessionDrives(session: StatsSession, roster: Roster, context: ReadContext = {}): DriveSolution[] {
  return ledgerDrives(session.plays, roster, context).map((drive) => solveDrive(drive, stateBefore(session.plays, drive.plays[0].playId)));
}

// -----------------------------------------------------------------------------
// The booth's stat lines (fix 6, Part 1).
// -----------------------------------------------------------------------------

export interface BoothRead {
  session: StatsSession;
  accepted: BoothLine[];
  refused: RefusedBoothLine[];
  /** Accepted lines on a count stat the plays disagree with: each one is a re-read (R42) for the loop to queue. */
  mismatched: BoothLine[];
}

/**
 * The stat lines one reply carried, checked (lib/livestats/statLines.ts) and
 * the accepted ones added to the session, where they set totals (R41). Read
 * after the reply's plays, so what the plays had counted at each line is
 * what the strip says the total was.
 */
export function readBoothLines(session: StatsSession, lines: readonly BoothStatLine[], roster: Roster, context: Pick<ReadContext, "utterances" | "readThrough" | "aliases"> = {}): BoothRead {
  if (lines.length === 0) return { session, accepted: [], refused: [], mismatched: [] };
  const check = checkBoothLines(lines, {
    plays: session.plays.map((play) => ({ seqStart: play.play.seqStart, status: play.status, changes: play.changes, quarter: play.play.quarter })),
    accepted: boothLinesOf(session),
    roster,
    utterances: context.utterances,
    readThrough: context.readThrough,
    aliases: context.aliases,
  });
  const next = check.accepted.length > 0 ? { ...session, boothLines: [...boothLinesOf(session), ...check.accepted] } : session;
  return { session: next, accepted: check.accepted, refused: check.refused, mismatched: check.mismatched };
}

const PASS_OR_SACKED: ReadonlySet<string> = new Set(["pass_complete", "pass_incomplete", "pass_intercepted", "sacked"]);

/** The player last credited with a kick or punt return on each side, among the plays that count. */
function returnersOf(plays: readonly SessionPlay[], sideOf: ReadonlyMap<string, Side>): Record<Side, string | null> {
  const returners: Record<Side, string | null> = { home: null, away: null };
  for (const entry of plays) {
    if (entry.status === "discarded") continue;
    for (const event of entry.play.events) {
      if (event.action !== "kick_return" && event.action !== "punt_return") continue;
      const side = sideOf.get(event.playerId);
      if (side) returners[side] = event.playerId;
    }
  }
  return returners;
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

/** Every player the announcer typed on a play: a name typed in, or a stat set or removed. */
function typedPlayers(edits: readonly TypedEdit[] | undefined): Set<string> {
  const typed = new Set<string>();
  for (const edit of edits ?? []) {
    if (edit.type === "player") {
      typed.add(edit.from);
      typed.add(edit.to);
    } else typed.add(edit.playerId);
  }
  return typed;
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
 * A kick's length when nobody said a number (rule R23): a punt's or a field
 * goal's, from the spots. A play from scrimmage is the drive ledger's (R43,
 * settlePlays), which runs once every play of the read is in.
 */
function fillYards(play: StatsPlay, state: GameState, notes: LoggedDrop[]): StatsPlay {
  if (play.playType !== "punt" && play.playType !== "field_goal") return play;
  if (gainIs(play) !== "unknown") return play;
  const worked = workOutYards(play, state);
  if (!worked) return play;
  const filled = withGain(play, worked, "R23", "the kick's length from the yard lines");
  notes.push(...filled.notes);
  return filled.play;
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
export function freshReads(plays: readonly StatsPlay[], session: StatsSession, watermark: number, recentIds: ReadonlySet<string>, reread = false): StatsPlay[] {
  // A re-read (Part 7) looks at lines read long ago: everything it returns is worth reading in, the merge sorts updates from new plays.
  if (reread) return [...plays];
  const live = session.plays.filter((play) => play.status !== "discarded");
  return plays.filter(
    (play) => play.seqEnd > watermark || (play.updates !== undefined && recentIds.has(play.updates)) || live.some((each) => sameLines(play, each.play)),
  );
}

/** The session the log describes, after a reload: its plays, and the booth lines that set totals. */
export function restoreSession(folded: readonly FoldedPlay[], booth: readonly FoldedBoothLine[] = []): StatsSession {
  return {
    plays: folded.map((play) => ({
      ...play,
      // Validated when it was read and written by this app; the log keeps it whole.
      play: play.play as StatsPlay,
    })),
    boothLines: booth.map((line) => ({ seq: line.seq, playerId: line.playerId, key: line.key, value: line.value, scope: line.scope as BoothLine["scope"], had: line.had })),
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
 * The stats only one player can have on a play: the slots of
 * lib/livestats/merge.ts (the carrier, the passer, the receiver, the kicker,
 * the punter, the returner, the interceptor, the fumbler). A typed one takes
 * the stat from whoever a later read gives it to; tackles, sacks, breakups,
 * forced fumbles and recoveries are shared, and a later read may still add one.
 */
const ONE_PER_PLAY: ReadonlySet<FootballStatKey> = new Set<FootballStatKey>([
  "rush_att", "rush_yds", "rush_td",
  "pass_cmp", "pass_att", "pass_yds", "pass_td", "pass_int",
  "rec", "rec_yds", "rec_td",
  "fgm", "fga", "fg_long", "xpm", "xpa",
  "punts", "punt_yds",
  "kr", "kr_yds", "kr_td", "pr", "pr_yds", "pr_td",
  "def_int", "int_ret_yds", "int_td",
  "fum", "fum_lost",
]);

/** One typed edit, laid on a play's changes. */
function applyEdit(changes: readonly StatChange[], edit: TypedEdit): StatChange[] {
  if (edit.type === "remove") return changes.filter((change) => !(change.playerId === edit.playerId && change.key === edit.key));
  if (edit.type === "player") {
    // The old player's items, and whoever a later read gave his one-holder stats to, are the new player's.
    const moved = changes.map((change) =>
      change.playerId === edit.from || (change.playerId !== edit.to && edit.keys.includes(change.key)) ? { ...change, playerId: edit.to } : change,
    );
    const seen = new Set<string>();
    return moved.filter((change) => {
      const key = `${change.playerId}|${change.key}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const typed: StatChange = { playerId: edit.playerId, key: edit.key, amount: edit.amount, estimated: edit.estimated };
  const clashes = (change: StatChange) => change.key === edit.key && (change.playerId === edit.playerId || ONE_PER_PLAY.has(edit.key));
  const at = changes.findIndex(clashes);
  const rest = changes.filter((change) => !clashes(change));
  if (at === -1) return [...rest, typed];
  // Where the item it replaces stood, so the strip keeps its order.
  const before = changes.slice(0, at).filter((change) => !clashes(change)).length;
  return [...rest.slice(0, before), typed, ...rest.slice(before)];
}

/** Typed edits laid on a play's changes, in the order they were typed. */
export function layOn(changes: readonly StatChange[], edits: readonly TypedEdit[]): StatChange[] {
  return edits.reduce<StatChange[]>((current, edit) => applyEdit(current, edit), [...changes]);
}

/**
 * On a completion with one passer and one receiver, the yards typed for one
 * are the other's too (Oct 10: an edit left them disagreeing).
 */
function partnerYards(changes: readonly StatChange[], item: StatChange, amount: number | null): TypedEdit | null {
  if (item.key !== "pass_yds" && item.key !== "rec_yds") return null;
  const passers = new Set(changes.filter((change) => change.key === "pass_cmp" && change.amount).map((change) => change.playerId));
  const receivers = new Set(changes.filter((change) => change.key === "rec" && change.amount).map((change) => change.playerId));
  if (passers.size !== 1 || receivers.size !== 1) return null;
  const [passer] = passers;
  const [receiver] = receivers;
  if (passer === receiver) return null;
  return item.key === "pass_yds"
    ? { type: "set", playerId: receiver, key: "rec_yds", amount, estimated: false }
    : { type: "set", playerId: passer, key: "pass_yds", amount, estimated: false };
}

/** The edits one correction from the strip makes, against the play's changes as they stand. */
function editsFor(changes: readonly StatChange[], correction: Correction): TypedEdit[] | null {
  if (correction.type === "add") {
    const { playerId, key, amount, estimated } = correction.change;
    return [{ type: "set", playerId, key, amount, estimated }];
  }
  const item = changes[correction.index];
  if (!item) return null;
  if (correction.type === "remove") return [{ type: "remove", playerId: item.playerId, key: item.key }];
  if (correction.type === "player") {
    // A misheard name is misheard for the whole play: every item of the old player moves.
    const keys = changes.filter((change) => change.playerId === item.playerId && ONE_PER_PLAY.has(change.key)).map((change) => change.key);
    return [{ type: "player", from: item.playerId, to: correction.playerId, keys }];
  }
  if (correction.type === "stat") {
    return [
      { type: "remove", playerId: item.playerId, key: item.key },
      { type: "set", playerId: item.playerId, key: correction.key, amount: item.amount, estimated: item.estimated && isYardKey(correction.key) },
    ];
  }
  const amount = correction.amount === null || !Number.isFinite(correction.amount) ? null : correction.amount;
  const own: TypedEdit = { type: "set", playerId: item.playerId, key: item.key, amount, estimated: false };
  const partner = partnerYards(changes, item, amount);
  return partner ? [own, partner] : [own];
}

/**
 * A correction from the strip. A new player on an item moves every item of
 * the old player on that play, because a misheard name is misheard for the
 * whole play. A typed amount is the announcer's own number, so it is no longer
 * worked out. Only what is typed is locked (Oct 10): a later read of the play
 * can still add a tackler or yards nobody typed, and what was typed is laid
 * on top of it (layOn).
 */
export function correctPlay(session: StatsSession, playId: string, correction: Correction): Step {
  const target = session.plays.find((play) => play.playId === playId);
  if (!target || target.status === "discarded") return { session, play: null };
  const edits = editsFor(target.changes, correction);
  if (!edits) return { session, play: null };
  return replace(session, { ...target, changes: layOn(target.changes, edits), edited: true, edits: [...(target.edits ?? []), ...edits] });
}

/**
 * Whether a play went backwards: a sack, or a play whose summary or lines say
 * loss. A yardage typed on it with no sign is a loss (suggest.ts, typedAmount).
 */
export function saysLoss(play: Pick<StatsPlay, "playType" | "summary" | "evidence">, lines?: string): boolean {
  return play.playType === "sack" || /\bloss\b/i.test(`${play.summary} ${lines ?? play.evidence}`);
}

/** The yards that go negative for a loss. A sack's own yards (sack_yds) are counted as a positive number. */
export const LOSS_SIGNED: ReadonlySet<FootballStatKey> = new Set<FootballStatKey>(["rush_yds", "pass_yds", "rec_yds"]);

function replace(session: StatsSession, play: SessionPlay): Step {
  return { session: { ...session, plays: session.plays.map((each) => (each.playId === play.playId ? play : each)) }, play };
}

// -----------------------------------------------------------------------------
// What it all adds up to.
// -----------------------------------------------------------------------------

/**
 * Tonight for every player: the OK'd plays, with a total the booth read on air
 * setting the number from its line on (R41, tallyWithBooth). The one place a
 * total is worked out; the strip, the cards, the report and the scorer all
 * come here.
 */
export function talliesOf(session: StatsSession): Map<string, TonightTally> {
  return tallyWithBooth(
    session.plays.filter((play) => play.status === "applied").map((play) => ({ seqStart: play.play.seqStart, changes: play.changes })),
    boothLinesOf(session),
  );
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
  /** Who the last read knew was out tonight (the newest stats_out record). */
  out: Set<string>;
  /** Second looks taken (stats_reply records with look "second"), for the cap. */
  secondLooks: number;
  /** Drive re-reads that ran (look "drive"). */
  driveRereads: number;
  /** Re-reads a booth line's count mismatch queued (look "booth", fix 6 Part 1). */
  boothRereads: number;
  /** Re-reads of a missing snap (look "gap", fix 6 Part 3), the gaps already looked at (by their lines, "from|to") and the incompletions inferred (R45). */
  gapRereads: number;
  gapsSeen: string[];
  gapFills: number;
  /** The newest booth line group accepted, for the strip's quiet line; null when none. */
  booth: BoothLine[] | null;
  /** The halftime check, when it ran: done with how many plays its reply touched, or failed with its code. Null when it never did. */
  halftime: { state: "done"; changes: number } | { state: "failed"; code: string } | null;
}

/** The loop's state as the log leaves it. The log is the only place tonight's stats are kept. */
export function restoreFromLog(records: readonly { kind: string }[]): RestoredStats {
  const restored: RestoredStats = {
    session: restoreSession(foldStats(records), foldBooth(records)),
    utterances: [],
    on: true,
    offMidGame: false,
    playsApplied: 0,
    playsUndone: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    out: new Set(),
    secondLooks: 0,
    driveRereads: 0,
    boothRereads: 0,
    gapRereads: 0,
    gapsSeen: [],
    gapFills: 0,
    booth: null,
    halftime: null,
  };
  const gapsSeen = new Set<string>();
  for (const play of restored.session.plays) {
    const match = /^gap-(\d+)-(\d+)$/.exec(play.playId);
    if (!match) continue;
    restored.gapFills += 1;
    gapsSeen.add(`${match[1]}|${match[2]}`);
  }
  let halftimeAt: number | null = null;
  // The newest line the booth read: the accepted lines with the latest seq, one group.
  const booth = boothLinesOf(restored.session);
  if (booth.length > 0) {
    const last = booth[booth.length - 1];
    restored.booth = booth.filter((line) => line.seq === last.seq && line.playerId === last.playerId);
  }
  for (const record of records) {
    const any = record as Record<string, unknown> & { kind: string };
    if (any.kind === "stats_out" && Array.isArray(any.playerIds)) {
      restored.out = new Set(any.playerIds.filter((id): id is string => typeof id === "string"));
      continue;
    }
    if (any.kind === "utterance" && typeof any.text === "string" && typeof any.at === "number") {
      if (any.text.trim().length > 0) restored.utterances.push({ text: any.text, at: any.at });
    } else if (any.kind === "stats_switch" && typeof any.on === "boolean") {
      restored.on = any.on;
      if (!any.on) restored.offMidGame = true;
    } else if (any.kind === "stats_decision") {
      if (any.decision === "ok") restored.playsApplied += 1;
      if (any.decision === "undo") restored.playsUndone += 1;
    } else if (any.kind === "stats_reply") {
      if (any.look === "second") restored.secondLooks += 1;
      if (any.look === "drive") restored.driveRereads += 1;
      if (any.look === "booth") restored.boothRereads += 1;
      if (any.look === "gap") {
        restored.gapRereads += 1;
        if (typeof any.seqFrom === "number" && typeof any.seqTo === "number") gapsSeen.add(`${any.seqFrom}|${any.seqTo}`);
      }
      if (any.look === "halftime" && restored.halftime === null) {
        if (any.ok === true && typeof any.at === "number") {
          halftimeAt = any.at;
          restored.halftime = { state: "done", changes: 0 };
        } else restored.halftime = { state: "failed", code: typeof any.code === "string" ? any.code : "unknown" };
      }
      if (any.ok === true) {
        restored.tokensIn += count(any.tokensIn);
        restored.tokensOut += count(any.tokensOut);
        restored.tokensCached += count(any.tokensCached);
      }
    }
  }
  restored.gapsSeen = [...gapsSeen];
  // What the halftime check's reply touched: the play, update and discard records written with it.
  if (halftimeAt !== null && restored.halftime?.state === "done") {
    let changes = 0;
    for (const record of records) {
      const any = record as Record<string, unknown> & { kind: string };
      if (any.at !== halftimeAt) continue;
      if (any.kind === "stats_play" || any.kind === "stats_update" || (any.kind === "stats_decision" && any.decision === "discard")) changes += 1;
    }
    restored.halftime = { state: "done", changes };
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
    for (const edit of play.edits ?? []) for (const id of edit.type === "player" ? [edit.from, edit.to] : [edit.playerId]) used.add(id);
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
      ...(play.edits ? { edits: play.edits.map((edit) => moveEdit(edit, move)) } : {}),
    })),
  };
}

function moveEdit(edit: TypedEdit, move: (id: string) => string): TypedEdit {
  if (edit.type === "player") return { ...edit, from: move(edit.from), to: move(edit.to) };
  return { ...edit, playerId: move(edit.playerId) };
}
