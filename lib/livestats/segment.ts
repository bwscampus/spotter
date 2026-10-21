import type { DownDistance, NameHit, ParsedLine, PlayCues, SpotMention } from "./parse";
import { bestHits } from "./parse/names";
import { isTerminal, playCues, soundsLikeRecap, startsNewPlay } from "./parse/playWords";
import { statedInLines } from "./yards";

// =============================================================================
// The play segmenter (v7, Part 3; reworked for TV broadcasts in fix 1, Part
// 2): a stream of parsed lines in, one segment per play out, closed the
// moment the words say the play is over, so the extractor can be asked at
// once instead of on a 30 s cadence.
//
// The boundary rules, in priority order:
//   1. A down-and-distance call opens a new pre-snap state (and closes any
//      open segment). The next snap cue or play word starts the play.
//   2. A line that says the ball is dead (tackled, out of bounds, incomplete,
//      touchdown, sacked: isTerminal, narrower than the result cue, which
//      also hears "breaks a tackle" and "needs a first down") followed by
//      RESULT_SILENCE_MS, or a new down-and-distance call, closes the segment.
//   3. After a terminal result (the ball is dead) on an earlier line, a new
//      snap, carry or throw is the next play, at once when the booth says it
//      the way it starts a play ("hands it to", "drops back", "takes the
//      snap", "fires", "keeps it"), unless the line sounds like a recap
//      ("that was", "there he goes again", replay words).
//   4. A segment closes PLAY_IDLE_MS after its last line with a play word, and
//      in any case PLAY_MAX_MS after it opened, so a long run described over
//      fifteen seconds stays one play and a broken stream cannot hold one open.
//   5. Penalty words keep the segment open PENALTY_HOLD_MS, so "flag" and
//      "holding, number 72" attach to it.
//   6. Replay and color talk ("let's look at that again", "on the replay")
//      opens a replay span: its lines attach to the previous segment as
//      postLines and never start a play.
//   7. A recap is not a play: a segment with no snap that starts within
//      RECAP_JOIN_MS of the last one's close, with no call or snap between,
//      that names no offensive player the last one did not and states no
//      other gain, joins the last one as POST lines instead.
// A call and a play on one line ("3rd and 10 the throw from castellane") is both:
// the call, and the new play's first line. Lines in no segment and in no
// segment's POST window that together name a roster player at
// SWEEP_NAME_SCORE and say the play is over or what it gained ("fennimore is
// pulled backwards", "no gain on the play"), not claimed within SWEEP_MS, are
// swept into a segment of their own. A name alone is color, not a play.
// Synchronous, no allocation beyond the segments; the controller runs it on
// every final (under the hot path's 5 ms with the parser,
// test/parse/benchmark.test.ts).
//
// The POST window (fix 1, Part 1): the lines after a play that are nobody
// else's are its POST lines, up to POST_LINES, because a TV booth names the
// carrier and the gain after the result ("that's fennimore, a gain of 9"). The
// window closes (postClosedAt) at the next down-and-distance call (that line
// is its last POST line), at a snap cue, when a later segment closes, or when
// the reader releases the segment to be read (lib/livestats/v7.ts holds a
// segment until then, at most POST_WAIT_MS), so the next play's pre-snap
// talk is never this play's, and a segment never changes after it is sent.
// A line attached as a POST line is never swept (fix 1, Part 2).
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Silence after a result cue that closes the play. */
export const RESULT_SILENCE_MS = 3_000;

/** A play closes this long after its last line with a play word or a yard line (fix 1, Part 2; it was 12 s from the first, which cut long calls). */
export const PLAY_IDLE_MS = 8_000;

/** And this long after it opened, whatever is said, so a broken stream cannot hold it open. */
export const PLAY_MAX_MS = 25_000;

/**
 * A segment with no snap that starts this soon after the last one closed,
 * with no call or snap between, naming no new offensive player, is talk about
 * that play (fix 1, Part 2).
 */
export const RECAP_JOIN_MS = 20_000;

/** A flag keeps the play open this long after the penalty words. */
export const PENALTY_HOLD_MS = 8_000;

/** A replay span ends this long after its last replay word, when no down and distance ends it first. */
export const REPLAY_SPAN_MS = 12_000;

/** Lines that name a player but sit in no segment are swept into one after this long. */
export const SWEEP_MS = 15_000;

/** Lines before the play kept with it. */
export const PRE_LINES = 2;

/** Lines after the play kept with it, filled in as they arrive; a segment with this many is read at once (lib/livestats/v7.ts). */
export const POST_LINES = 5;

/**
 * The longest a closed segment waits for its POST lines before it is read
 * anyway (lib/livestats/v7.ts). The latency knob: the Oct 20 dev runs had p95
 * of 24.6, 19.3 and 35.0 s before any wait.
 */
export const POST_WAIT_MS = 6_000;

/** A name hit this strong on a line with no play word is still worth reading (the sweep). */
export const SWEEP_NAME_SCORE = 0.8;

/** The most POST lines a play keeps once a recap has joined it (the request carries at most 40 lines). */
export const MAX_POST_LINES = 12;

// =============================================================================

export type SegmentClose = "dd" | "result" | "idle" | "cap" | "replay" | "snap" | "sweep" | "finish";

export interface PlaySegment {
  id: string;
  lineStart: number;
  lineEnd: number;
  /** The play's own lines. */
  lines: ParsedLine[];
  /** Up to PRE_LINES before it (the down-and-distance call among them). */
  preLines: ParsedLine[];
  /** Up to POST_LINES after it, filled in as they arrive (the list is appended to after emission, until postClosedAt). */
  postLines: ParsedLine[];
  /** When the POST window closed (a call, a snap, a later segment, the read), ms; null while it is open. */
  postClosedAt: number | null;
  /** The last down-and-distance call before the play, and the spot said with it. */
  ddBefore: DownDistance | null;
  ddBeforeSeq: number | null;
  spotBefore: SpotMention | null;
  /** Every play cue in the play's lines, merged. */
  cues: PlayCues;
  /** When it closed, ms. */
  emittedAt: number;
  /** When its first line arrived, and its last. */
  startedAt: number;
  lastLineAt: number;
  closedBy: SegmentClose;
}

interface Open {
  lines: Array<{ line: ParsedLine; at: number }>;
  pre: ParsedLine[];
  ddBefore: DownDistance | null;
  ddBeforeSeq: number | null;
  spotBefore: SpotMention | null;
  startedAt: number;
  /** When a line last said the ball was dead (isTerminal): RESULT_SILENCE_MS runs from here, and only after one does a new snap or carry start the next play. */
  terminalAt: number | null;
  /** The last line with a play word or a yard line: PLAY_IDLE_MS runs from here. */
  cueAt: number;
  penaltyAt: number | null;
  /** A call or a snap came between the last segment's close and this one's start: it cannot be a recap of it. */
  afterBoundary: boolean;
}

/** Counts the segmenter keeps about itself, for the tests and the replay's printout. */
export interface SegmenterCounts {
  /** Would-be segments joined to the play before as its POST lines (rule 7). */
  joined: number;
  /** Of those, joined after the play before had been sent: their lines reached no request. */
  joinedAfterSend: number;
  /** Each join's lines and the segment it joined, for the segmentation scorer (the first JOIN_LOG_MAX). */
  joins: Array<{ lineStart: number; lineEnd: number; into: string; afterSend: boolean }>;
}

/** Joins kept in SegmenterCounts.joins. */
const JOIN_LOG_MAX = 500;

const EMPTY_CUES: PlayCues = { rush: false, pass: false, complete: false, incomplete: false, sack: false, turnover: false, penalty: false, result: false, tackle: false, touchdown: false, firstDown: false, kick: false, replay: false, snap: false, any: false, matched: [] };

/** A line's play cues, with the replay words taken as what they are: not a play of their own. */
function startsPlay(line: ParsedLine): boolean {
  return cuesStartPlay(line.cues);
}

function cuesStartPlay(c: PlayCues): boolean {
  if (c.replay) return false;
  return c.snap || c.rush || c.pass || c.complete || c.incomplete || c.sack || c.turnover || c.kick || c.penalty || c.tackle || c.touchdown;
}

/**
 * A call with the play after it on the same line ("3rd and 10 from the 36
 * the throw from castellane", "2nd and 10 langan steps and delivers to tafita"): the
 * words after the call start a play (fix 1, Part 2; a TV booth says the down
 * as the ball is snapped, and these lines were read as calls only).
 */
function callStartsPlay(line: ParsedLine): boolean {
  if (!line.dd) return false;
  const after = line.words.slice(line.dd.span[1] + 1).join(" ");
  return after.length > 0 && cuesStartPlay(playCues(after));
}

export function mergeCues(lines: readonly ParsedLine[]): PlayCues {
  const merged: PlayCues = { ...EMPTY_CUES, matched: [] };
  for (const line of lines) {
    for (const key of Object.keys(EMPTY_CUES) as Array<keyof PlayCues>) {
      if (key === "matched") continue;
      if (line.cues[key]) (merged as unknown as Record<string, boolean>)[key] = true;
    }
    for (const name of line.cues.matched) if (!merged.matched.includes(name)) merged.matched.push(name);
  }
  return merged;
}

/** The best name hit per player across a segment's lines and its post lines. */
export function segmentNameHits(segment: Pick<PlaySegment, "lines" | "postLines">): NameHit[] {
  return bestHits([...segment.lines, ...segment.postLines].flatMap((line) => line.nameHits));
}

export class Segmenter {
  private open: Open | null = null;
  /** The last two lines seen that are nobody's play yet, for the next segment's preLines. */
  private recent: ParsedLine[] = [];
  private pendingDd: { dd: DownDistance; seq: number; spot: SpotMention | null } | null = null;
  /** Segments closed, whose postLines still fill in. */
  private closed: PlaySegment[] = [];
  private replayUntil: number | null = null;
  /** Lines that might be a play nobody gave a play word, with when the first arrived (the sweep). */
  private orphans: Array<{ line: ParsedLine; at: number }> = [];
  private ids = new Map<string, number>();
  /** A call or a snap since the last segment closed: the next one is not a recap of it. */
  private boundarySinceClose = true;
  readonly counts: SegmenterCounts = { joined: 0, joinedAfterSend: 0, joins: [] };
  /** Whether a playerId is an offensive player (QB, RB, FB, WR, TE): only they decide whether a segment is a recap. */
  private offensive: (playerId: string) => boolean;

  // A field, not a parameter property: Node's type stripping (replay:stats) refuses those.
  constructor(offensive: (playerId: string) => boolean = () => true) {
    this.offensive = offensive;
  }

  /** The roster changed: who counts as an offensive player. */
  setOffensive(offensive: (playerId: string) => boolean) {
    this.offensive = offensive;
  }

  /** The segment still open, if any: the controller's End game reads it. */
  isOpen(): boolean {
    return this.open !== null;
  }

  /** One parsed line, said at `at` ms. Returns the segments this line closed. */
  push(line: ParsedLine, at: number): PlaySegment[] {
    const out: PlaySegment[] = [];
    this.expireWindows(at);
    // Time has passed since the last line: anything that should have closed by now closes first.
    const timed = this.closeByTime(at);
    if (timed) out.push(timed);

    // Rule 1: a down-and-distance call ends what was open and opens the pre-snap state.
    if (line.dd) {
      if (this.open) {
        const closed = this.close(at, "dd");
        if (closed) out.push(closed);
      }
      // Lines between two calls that might be a play nobody gave a play word: read now rather than at the sweep.
      else {
        const swept = this.sweep(at, true);
        if (swept) out.push(swept);
      }
      this.replayUntil = null;
      this.pendingDd = { dd: line.dd, seq: line.seq, spot: line.spots.find((spot) => spot.kind === "at" || spot.kind === "start") ?? null };
      this.orphans = [];
      // The call and the play on one line: the line is the new play's first, not the last play's POST.
      if (callStartsPlay(line)) {
        this.closeWindow(at);
        this.boundarySinceClose = true;
        this.openWith(line, at);
        return out;
      }
      // The call is the play's last POST line: what comes after it is the next play's.
      this.attachPost(line);
      this.closeWindow(at);
      this.boundarySinceClose = true;
      this.remember(line);
      return out;
    }

    // Rule 6: replay talk attaches to the play before, and never starts one.
    if (line.cues.replay) {
      if (this.open) {
        // The booth is replaying the play that was open: it is over.
        const closed = this.close(at, "replay");
        if (closed) out.push(closed);
      }
      this.replayUntil = at + REPLAY_SPAN_MS;
      this.attachPost(line);
      this.remember(line);
      return out;
    }
    if (this.replayUntil !== null && at < this.replayUntil) {
      this.attachPost(line);
      this.remember(line);
      return out;
    }
    this.replayUntil = null;

    if (this.open) {
      const open = this.open;
      // Rule 3: after the ball is dead, a snap, or a carry or throw said the way a play starts, is the next play.
      if (open.terminalAt !== null && !line.cues.tackle && !soundsLikeRecap(line.text, line.cues)) {
        const said = startsNewPlay(line.text);
        const nextSnap = line.cues.snap;
        const nextCarry = (line.cues.rush || line.cues.pass) && !line.cues.result && !line.cues.penalty && at - open.terminalAt >= 1_000;
        if (said || nextSnap || nextCarry) {
          const closed = this.close(at, "snap");
          if (closed) out.push(closed);
          this.boundarySinceClose = true;
          this.openWith(line, at);
          return out;
        }
      }
      open.lines.push({ line, at });
      // A play word or a yard line ("at the 30, the 20") keeps a play going.
      if (line.cues.any || line.spots.length > 0) open.cueAt = at;
      if (line.cues.penalty) open.penaltyAt = at;
      if (isTerminal(line.text)) open.terminalAt = at;
      return out;
    }

    if (startsPlay(line)) {
      // Lines before it that were a play nobody gave a play word are read first, not dropped.
      const swept = this.sweep(at, true);
      if (swept) out.push(swept);
      this.openWith(line, at);
      return out;
    }

    // Nobody's line: a post line of the last play, a pre line of the next, and maybe part of a play nobody gave a play word.
    const attached = this.attachPost(line);
    this.remember(line);
    if (line.cues.snap) this.boundarySinceClose = true;
    if (!attached && (namesClearly(line) || saysOver(line))) this.orphans.push({ line, at });
    return out;
  }

  /** The clock moved to `now` with nothing said: anything due to close by time, and the sweep. */
  tick(now: number): PlaySegment[] {
    const out: PlaySegment[] = [];
    this.expireWindows(now);
    const timed = this.closeByTime(now);
    if (timed) out.push(timed);
    if (this.replayUntil !== null && now >= this.replayUntil) this.replayUntil = null;
    const swept = this.sweep(now);
    if (swept) out.push(swept);
    return out;
  }

  /** End game: whatever is open closes now, and the orphans are swept. */
  finish(now: number): PlaySegment[] {
    const out: PlaySegment[] = [];
    if (this.open) {
      const closed = this.close(now, "finish");
      if (closed) out.push(closed);
    }
    const swept = this.sweep(now, true);
    if (swept) out.push(swept);
    return out;
  }

  private closeByTime(now: number): PlaySegment | null {
    const open = this.open;
    if (!open) return null;
    if (now - open.startedAt >= PLAY_MAX_MS) return this.close(now, "cap");
    const held = open.penaltyAt !== null && now < open.penaltyAt + PENALTY_HOLD_MS;
    if (held) return null;
    if (open.terminalAt !== null && now - open.terminalAt >= RESULT_SILENCE_MS) return this.close(now, "result");
    if (now - open.cueAt >= PLAY_IDLE_MS) return this.close(now, "idle");
    return null;
  }

  private openWith(line: ParsedLine, at: number) {
    // A snap is the next play: the last play's POST window is over.
    if (line.cues.snap) {
      this.closeWindow(at);
      this.boundarySinceClose = true;
    }
    const pending = this.pendingDd;
    this.open = {
      lines: [{ line, at }],
      pre: this.recent.slice(-PRE_LINES),
      ddBefore: pending?.dd ?? null,
      ddBeforeSeq: pending?.seq ?? null,
      spotBefore: pending?.spot ?? null,
      startedAt: at,
      terminalAt: isTerminal(line.text) ? at : null,
      cueAt: at,
      penaltyAt: line.cues.penalty ? at : null,
      afterBoundary: this.boundarySinceClose,
    };
    this.pendingDd = null;
    this.recent = [];
  }

  /** Closes the open segment: a new segment, or null when it was a recap and joined the play before (rule 7). */
  private close(at: number, closedBy: SegmentClose): PlaySegment | null {
    const open = this.open!;
    this.open = null;
    const lines = open.lines.map((entry) => entry.line);
    const first = lines[0];
    const last = lines[lines.length - 1];
    // The play's own last lines are the next play's context too.
    this.recent = lines.slice(-PRE_LINES);
    const before = this.closed[this.closed.length - 1];
    if (before && this.isRecap(open, lines, before)) {
      this.counts.joined += 1;
      if (before.postClosedAt !== null) this.counts.joinedAfterSend += 1;
      if (this.counts.joins.length < JOIN_LOG_MAX) this.counts.joins.push({ lineStart: first.seq, lineEnd: last.seq, into: before.id, afterSend: before.postClosedAt !== null });
      else {
        for (const line of lines) if (before.postLines.length < MAX_POST_LINES) before.postLines.push(line);
        before.postClosedAt = at;
      }
      this.boundarySinceClose = false;
      return null;
    }
    const segment: PlaySegment = {
      id: this.idFor(first.seq, last.seq),
      lineStart: first.seq,
      lineEnd: last.seq,
      lines,
      preLines: open.pre,
      postLines: [],
      postClosedAt: null,
      ddBefore: open.ddBefore,
      ddBeforeSeq: open.ddBeforeSeq,
      spotBefore: open.spotBefore,
      cues: mergeCues(lines),
      emittedAt: at,
      startedAt: open.startedAt,
      lastLineAt: open.lines[open.lines.length - 1].at,
      closedBy,
    };
    this.closeWindow(at);
    this.closed.push(segment);
    if (this.closed.length > 3) this.closed.shift();
    this.boundarySinceClose = false;
    return segment;
  }

  /**
   * Rule 7: talk about the play before rather than a play. No snap and no
   * new-play words; started within RECAP_JOIN_MS of that play's close with no
   * call or snap between; every offensive player it names was named there
   * too; and a gain it states (if both state one) is within a yard of that
   * play's.
   */
  private isRecap(open: Open, lines: readonly ParsedLine[], before: PlaySegment): boolean {
    if (open.afterBoundary || open.startedAt - before.emittedAt > RECAP_JOIN_MS) return false;
    if (lines.some((line) => line.cues.snap) || startsNewPlay(lines[0].text)) return false;
    const offenseIn = (from: readonly ParsedLine[]) => new Set(bestHits(from.flatMap((line) => line.nameHits)).filter((hit) => hit.score >= SWEEP_NAME_SCORE && this.offensive(hit.playerId)).map((hit) => hit.playerId));
    const earlier = offenseIn([...before.preLines, ...before.lines, ...before.postLines]);
    for (const id of offenseIn(lines)) if (!earlier.has(id)) return false;
    const gain = gainIn(lines);
    const earlierGain = gainIn([...before.lines, ...before.postLines]);
    if (gain !== null && earlierGain !== null && Math.abs(gain - earlierGain) > 1) return false;
    return true;
  }

  private idFor(start: number, end: number): string {
    const base = `seg-${start}-${end}`;
    const seen = (this.ids.get(base) ?? 0) + 1;
    this.ids.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  }

  /** A nobody's line onto the last play's POST lines, while its window is open. True when it went on. */
  private attachPost(line: ParsedLine): boolean {
    const last = this.closed[this.closed.length - 1];
    if (!last || last.postClosedAt !== null || last.postLines.length >= POST_LINES || line.seq <= last.lineEnd) return false;
    last.postLines.push(line);
    return true;
  }

  /** A POST window open POST_WAIT_MS is over: the reader has sent the segment by then (lib/livestats/v7.ts). */
  private expireWindows(now: number) {
    for (const segment of this.closed) if (segment.postClosedAt === null && now - segment.emittedAt >= POST_WAIT_MS) segment.postClosedAt = segment.emittedAt + POST_WAIT_MS;
  }

  /** Every closed segment's POST window is over: a call, a snap or a later segment has come. */
  private closeWindow(at: number) {
    for (const segment of this.closed) segment.postClosedAt ??= at;
  }

  private remember(line: ParsedLine) {
    this.recent.push(line);
    if (this.recent.length > PRE_LINES) this.recent.shift();
  }

  private sweep(now: number, force = false): PlaySegment | null {
    if (this.open || this.orphans.length === 0) return null;
    if (!force && now - this.orphans[0].at < SWEEP_MS) return null;
    // A play only when the lines together name a player and say it is over or what it gained: a name alone is color.
    if (!this.orphans.some((entry) => namesClearly(entry.line)) || !this.orphans.some((entry) => saysOver(entry.line))) {
      this.orphans = [];
      return null;
    }
    const lines = this.orphans.map((entry) => entry.line);
    const first = lines[0];
    const last = lines[lines.length - 1];
    const segment: PlaySegment = {
      id: this.idFor(first.seq, last.seq),
      lineStart: first.seq,
      lineEnd: last.seq,
      lines,
      preLines: [],
      postLines: [],
      postClosedAt: null,
      ddBefore: this.pendingDd?.dd ?? null,
      ddBeforeSeq: this.pendingDd?.seq ?? null,
      spotBefore: this.pendingDd?.spot ?? null,
      cues: mergeCues(lines),
      emittedAt: now,
      startedAt: this.orphans[0].at,
      lastLineAt: this.orphans[this.orphans.length - 1].at,
      closedBy: "sweep",
    };
    this.orphans = [];
    this.closeWindow(now);
    this.closed.push(segment);
    if (this.closed.length > 3) this.closed.shift();
    this.boundarySinceClose = false;
    return segment;
  }
}

/**
 * "for 6", "for about 2 yards", "gains a yard", "a couple of yards", "with
 * the stop": a gain or a stop said the way a TV booth says it, which the
 * yards solver will not take as a stated number but the sweep may take as a
 * play.
 */
const BARE_GAIN = /\b(?:for (?:a |about |around |roughly |maybe |just )?(?:loss of )?\d{1,2}\b|gains? (?:a|an|\d{1,2})\b|(?:a )?couple (?:of )?yards|(?:with|makes|made) (?:a|the) (?:stop|tackle)\b)/;

/** The gain a run of lines states, "for 6" included, or null. */
function gainIn(lines: readonly ParsedLine[]): number | null {
  const texts = lines.map((line) => line.text);
  const stated = statedInLines(texts);
  if (stated !== null) return stated;
  for (const text of texts) {
    const match = /\bfor (?:a |about |around )?(loss of )?(\d{1,2})\b/.exec(text.toLowerCase());
    if (match) return match[1] ? -Number(match[2]) : Number(match[2]);
  }
  return null;
}

/** A player named clearly enough to be read. */
function namesClearly(line: ParsedLine): boolean {
  return line.nameHits.some((hit) => hit.score >= SWEEP_NAME_SCORE);
}

/** The play is over, or what it gained is said. The sweep needs this and a name, on any of its lines (a name alone is color). */
function saysOver(line: ParsedLine): boolean {
  return line.cues.result || line.cues.firstDown || statedInLines([line.text]) !== null || BARE_GAIN.test(line.text.toLowerCase());
}
