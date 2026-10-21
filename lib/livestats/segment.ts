import type { DownDistance, NameHit, ParsedLine, PlayCues, SpotMention } from "./parse";
import { bestHits } from "./parse/names";

// =============================================================================
// The play segmenter (v7, Part 3): a stream of parsed lines in, one segment
// per play out, closed the moment the words say the play is over, so the
// extractor can be asked at once instead of on a 30 s cadence.
//
// The boundary rules, in priority order:
//   1. A down-and-distance call opens a new pre-snap state (and closes any
//      open segment). The next snap cue or play word starts the play.
//   2. A result cue (tackle, out of bounds, incomplete, touchdown, sack)
//      followed by RESULT_SILENCE_MS of silence, or by a new down-and-distance
//      call, closes the segment.
//   3. A segment closes PLAY_TIMEOUT_MS after its first play word if nothing
//      else closes it.
//   4. Penalty words keep the segment open PENALTY_HOLD_MS, so "flag" and
//      "holding, number 72" attach to it.
//   5. Replay and color talk ("let's look at that again", "on the replay")
//      opens a replay span: its lines attach to the previous segment as
//      postLines and never start a play.
// A line that names a roster player but opens no segment within SWEEP_MS is
// swept into a segment of its own, so a quiet booth's "fennimore" is still
// read. Synchronous, no allocation beyond the segments; the controller runs
// it on every final (under the hot path's 5 ms with the parser,
// test/parse/benchmark.test.ts).
//
// The POST window (fix 1, Part 1): the lines after a play that are nobody
// else's are its POST lines, up to POST_LINES, because a TV booth names the
// carrier and the gain after the result ("that's pierce, a gain of 9"). The
// window closes (postClosedAt) at the next down-and-distance call (that line
// is its last POST line), at a snap cue, when a later segment closes, or when
// the reader releases the segment to be read (lib/livestats/v7.ts holds a
// segment until then, at most POST_WAIT_MS), so the next play's pre-snap
// talk is never this play's, and a segment never changes after it is sent.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Silence after a result cue that closes the play. */
export const RESULT_SILENCE_MS = 3_000;

/** A play closes this long after its first play word whatever else is said. */
export const PLAY_TIMEOUT_MS = 12_000;

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

// =============================================================================

export type SegmentClose = "dd" | "result" | "timeout" | "replay" | "snap" | "sweep" | "finish";

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
  resultAt: number | null;
  penaltyAt: number | null;
}

const EMPTY_CUES: PlayCues = { rush: false, pass: false, complete: false, incomplete: false, sack: false, turnover: false, penalty: false, result: false, tackle: false, touchdown: false, firstDown: false, kick: false, replay: false, snap: false, any: false, matched: [] };

/** A line's play cues, with the replay words taken as what they are: not a play of their own. */
function startsPlay(line: ParsedLine): boolean {
  const c = line.cues;
  if (c.replay) return false;
  return c.snap || c.rush || c.pass || c.complete || c.incomplete || c.sack || c.turnover || c.kick || c.penalty || c.tackle || c.touchdown;
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
  /** Lines that named a player but opened nothing, with when the first arrived. */
  private orphans: Array<{ line: ParsedLine; at: number }> = [];
  private ids = new Map<string, number>();

  /** The segment still open, if any: the controller's End game reads it. */
  isOpen(): boolean {
    return this.open !== null;
  }

  /** One parsed line, said at `at` ms. Returns the segments this line closed (at most one). */
  push(line: ParsedLine, at: number): PlaySegment[] {
    const out: PlaySegment[] = [];
    // Time has passed since the last line: anything that should have closed by now closes first.
    const timed = this.closeByTime(at);
    if (timed) out.push(timed);

    // Rule 1: a down-and-distance call ends what was open and opens the pre-snap state.
    if (line.dd) {
      if (this.open) out.push(this.close(at, "dd"));
      // Lines between two calls that named a player and opened no play: the play was in them, so they are read now rather than at the sweep.
      else {
        const swept = this.sweep(at, true);
        if (swept) out.push(swept);
      }
      this.replayUntil = null;
      // The call is the play's last POST line: what comes after it is the next play's.
      this.attachPost(line);
      this.closeWindow(at);
      this.pendingDd = { dd: line.dd, seq: line.seq, spot: line.spots.find((spot) => spot.kind === "at" || spot.kind === "start") ?? null };
      this.remember(line);
      this.orphans = [];
      return out;
    }

    // Rule 5: replay talk attaches to the play before, and never starts one.
    if (line.cues.replay) {
      if (this.open) {
        // The booth is replaying the play that was open: it is over.
        out.push(this.close(at, "replay"));
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
      // A snap after a result: the next play, with no down and distance said (a hurry-up).
      const nextPlay = open.resultAt !== null && line.cues.snap && !line.cues.tackle;
      const nextCarry = open.resultAt !== null && (line.cues.rush || line.cues.pass) && !line.cues.tackle && !line.cues.result && !line.cues.penalty && at - open.resultAt >= 1_000;
      if (nextPlay || nextCarry) {
        out.push(this.close(at, "snap"));
        this.openWith(line, at);
        return out;
      }
      open.lines.push({ line, at });
      if (line.cues.penalty) open.penaltyAt = at;
      if (line.cues.result) open.resultAt = at;
      return out;
    }

    if (startsPlay(line)) {
      this.openWith(line, at);
      this.orphans = [];
      return out;
    }

    // Nobody's line: a post line of the last play, a pre line of the next, and maybe an orphan to sweep.
    this.attachPost(line);
    this.remember(line);
    if (line.nameHits.some((hit) => hit.score >= SWEEP_NAME_SCORE)) this.orphans.push({ line, at });
    return out;
  }

  /** The clock moved to `now` with nothing said: anything due to close by time, and the sweep. */
  tick(now: number): PlaySegment[] {
    const out: PlaySegment[] = [];
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
    if (this.open) out.push(this.close(now, "finish"));
    const swept = this.sweep(now, true);
    if (swept) out.push(swept);
    return out;
  }

  private closeByTime(now: number): PlaySegment | null {
    const open = this.open;
    if (!open) return null;
    const held = open.penaltyAt !== null && now < open.penaltyAt + PENALTY_HOLD_MS;
    if (held) return null;
    if (open.resultAt !== null && now - open.resultAt >= RESULT_SILENCE_MS) return this.close(now, "result");
    if (now - open.startedAt >= PLAY_TIMEOUT_MS) return this.close(now, "timeout");
    return null;
  }

  private openWith(line: ParsedLine, at: number) {
    // A snap is the next play: the last play's POST window is over.
    if (line.cues.snap) this.closeWindow(at);
    const pending = this.pendingDd;
    this.open = {
      lines: [{ line, at }],
      pre: this.recent.slice(-PRE_LINES),
      ddBefore: pending?.dd ?? null,
      ddBeforeSeq: pending?.seq ?? null,
      spotBefore: pending?.spot ?? null,
      startedAt: at,
      resultAt: line.cues.result ? at : null,
      penaltyAt: line.cues.penalty ? at : null,
    };
    this.pendingDd = null;
    this.recent = [];
  }

  private close(at: number, closedBy: SegmentClose): PlaySegment {
    const open = this.open!;
    this.open = null;
    const lines = open.lines.map((entry) => entry.line);
    const first = lines[0];
    const last = lines[lines.length - 1];
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
    // The play's own last lines are the next play's context too.
    this.recent = lines.slice(-PRE_LINES);
    return segment;
  }

  private idFor(start: number, end: number): string {
    const base = `seg-${start}-${end}`;
    const seen = (this.ids.get(base) ?? 0) + 1;
    this.ids.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  }

  private attachPost(line: ParsedLine) {
    const last = this.closed[this.closed.length - 1];
    if (last && last.postClosedAt === null && last.postLines.length < POST_LINES && line.seq > last.lineEnd) last.postLines.push(line);
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
    return segment;
  }
}
