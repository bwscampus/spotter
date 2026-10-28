import type { EventName, EventProps } from "@/lib/analytics/events";
import type { StatsRecord } from "@/lib/log/statsLog";
import { buildCandidates, CANDIDATE_MIN_SCORE, candidateAt, NAMED_BEFORE_SNAP, type Candidate } from "./candidates";
import { currentQbs } from "./check";
import { drivesOf, newlyEnded } from "./drives";
import { answerToPlay } from "./extract/mapping";
import type { SegmentFacts, SegmentLine, SegmentLook, SegmentRequest, V7GameState } from "./extract/request";
import type { ReaderAnswers, SegmentReply } from "./extract/run";
import type { ExtractAnswer } from "./extract/schema";
import { absoluteSpot, gainIs, stateAfter, type GameState } from "./gameState";
import type { LedgerGap } from "./ledger";
import { parseContextFor, parseLine, type ParseContext, type ParsedLine } from "./parse";
import { startsNewPlay } from "./parse/playWords";
import { spotProgress } from "./parse/spots";
import { DECISIVE_VOTE, flipsOf, voteOf } from "./possession";
import { hasGroup } from "./positions";
import { applyPriors } from "./priors";
import { agreementKey, numberInLines } from "./reconcile";
import { mergeCues, POST_LINES, POST_WAIT_MS, Segmenter, segmentNameHits, type PlaySegment, type SegmenterCounts } from "./segment";
import { dropSharedCredits, ledgerGaps, readPlays, setPlayGain, talliesOf, type SessionPlay, type StatsSession } from "./session";
import { eventKey } from "./check";
import { GameTracker } from "./stateMachine";
import type { Side, StatsEvent, StatsPlay, StatsRosterPlayer, StatsUsage, TeamWords } from "./types";
import { solveYards, type YardsFacts } from "./yards";

// =============================================================================
// The v7 reader (Oct 20): the staged pipeline inside the live stats loop.
// Every final is parsed (./parse) and segmented (./segment.ts) the moment it
// lands, on the hot path's budget and with no await; each segment that closes
// is read at once, one at a time, through the host's segment route (reader A,
// reader B and the tie-break are the route's business, ./reconcile.ts): the
// candidate list (./candidates.ts), the answer mapped to a play
// (./extract/mapping.ts), the priors (./priors.ts), the same check, merge,
// stat rules and ledger as v6 (./session.ts readPlays), then the yards solver
// (./yards.ts) on the play and again on the play before it once this
// segment's down and distance is in. A quiet segment that names a player
// gets one second look; a drive that ends has each of its plays re-read with
// its current answer, a correction accepted only when it passes the name
// check and its yards match a solver method; a snap the downs say was missed
// is read from its lines (Part 9). The controller (./controller.ts) owns the
// session, the log, the keys and the clock and hands them in as the host, so
// this file never touches a card, a socket or React.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A quiet segment gets a second look when a candidate was named this clearly. */
export const V7_SECOND_LOOK_MIN_SCORE = 0.8;

export const V7_SECOND_LOOKS_PER_GAME = 40;
export const V7_GAP_REREADS_PER_GAME = 15;

/** Reads waiting, at most: a backlog longer than this loses its oldest re-read first, then its oldest segment, which the log says. */
export const V7_QUEUE_MAX = 20;

/** Lines before a gap that go with it as PRE, and the most lines a gap read may carry. */
export const V7_GAP_MARGIN_LINES = 2;
export const V7_MAX_GAP_LINES = 40;

export const V7_QUEUE_DROPPED = "segment_dropped";

/**
 * Yards from the play before (fix 1, item 2): its end is this play's start,
 * and the down it implies is this play's down, only when it ended this
 * recently before this play began (a snap every 30 to 40 s on TV; past this,
 * a snap was likely missed between).
 */
export const BALL_CARRY_MS = 50_000;

/** Lines after a play searched for the next down-and-distance call, up to the next snap. */
export const NEXT_CALL_LINES = 10;

/**
 * A read that starts this soon after a counted play's segment closed, with
 * no call or snap between, the same kind of play and the same players, is
 * that play read again from the talk after it (fix 1, Part 6, R50).
 */
export const DUP_JOIN_MS = 30_000;

/** How many counted plays back a read may be the same play as. */
export const DUP_LOOKBACK = 2;

// =============================================================================

/** What the reader needs of the loop. */
export interface V7Host {
  gameId: string;
  roster(): StatsRosterPlayer[];
  teams(): TeamWords | null;
  out(): ReadonlySet<string>;
  utterances(): readonly { seq: number; text: string; offsetMs: number }[];
  session(): StatsSession;
  setSession(next: StatsSession): void;
  log(record: StatsRecord): void;
  track(name: EventName, props: EventProps): void;
  now(): number;
  extractSegment(request: SegmentRequest): Promise<SegmentReply>;
  /** A play was read in: counted at once under autoOk. */
  added(play: SessionPlay): void;
  /** A reply came back and was read: the loop is no longer paused. */
  succeeded(): void;
  /** The session changed: the view and the cards follow. */
  changed(): void;
  /** A note was written on a play and no line changed: the view follows, the cards need not. */
  noted(): void;
  failed(code: string, seqFrom?: number, seqTo?: number): void;
  addUsage(usage: StatsUsage): void;
  disposed(): boolean;
}

interface Job {
  segment: PlaySegment;
  look: SegmentLook;
  current?: ExtractAnswer;
  playId?: string;
  note?: string;
  rule?: "R38" | "R39" | "R44";
  /** The list the segment was first read with: a re-read and a second look send the same one, so `current`'s indexes mean the same players. */
  candidates?: Candidate[];
}

/** A first read or a second look comes before any re-read (fix 1, Part 1): the plays still to come are what the latency is. */
const FRESH: ReadonlySet<SegmentLook> = new Set(["segment", "second"]);

/**
 * The offense a segment is read with (fix 1, Part 3), and what said so: a
 * possession phrase in its own lines, the vote of the offensive players its
 * PLAY lines name, the tracker's timeline at its first line, or nothing.
 */
export interface SegmentOffense {
  side: Side | null;
  basis: "phrase" | "skill" | "tracker" | null;
}

interface Answered {
  segment: PlaySegment;
  candidates: Candidate[];
  answer: ExtractAnswer;
  playId: string | null;
}

/** One segment as the plays file records it (lib/livestats/playsJson.ts): its lines, its times, how it closed. */
export interface SegmentSummary {
  id: string;
  lineStart: number;
  lineEnd: number;
  startedAt: number;
  lastLineAt: number;
  emittedAt: number;
  closedBy: string;
  /** The play it was read as, when one was counted. */
  playId: string | null;
}

/**
 * One request as it was sent and answered, for the plays file's segmentDetail
 * (fix 1, Part 0): the lines, the candidates and the game state exactly as
 * sent, each reader's own answer, the reconciled one and the play it became.
 * Kept only when the reader is built with recordDetail (the replay harness);
 * the live screen never holds them.
 */
export interface SegmentDetail {
  segmentId: string;
  look: SegmentLook;
  closedBy: string;
  /** When the request went out, and when the segment's last line was said, ms. */
  sentAt: number;
  lastLineAt: number;
  lines: SegmentLine[];
  candidates: Array<{ idx: number; playerId: string | null; label: string; score: number; tags: string[] }>;
  gameState: Pick<V7GameState, "offense" | "down" | "distance" | "spot" | "qbs">;
  /** What decided the offense sent (fix 1, Part 3): a phrase, the vote, the tracker, or nothing. */
  offenseFrom: SegmentOffense["basis"];
  answers: ReaderAnswers | null;
  reconciled: ExtractAnswer | null;
  agreement: string | null;
  /** The failure code, when the read failed. */
  failed: string | null;
  /** The play it was read as, or the play a re-read was about; null for none. */
  playId: string | null;
}

export interface V7Counts {
  secondLooks: number;
  driveRereads: number;
  gapRereads: number;
  spentUsd: number;
}

/** A play's kind for Part 6's same-play test: a run, a pass or a sack; null for anything else. */
function familyOf(play: StatsPlay): "run" | "pass" | "sack" | null {
  if (play.nullified || play.penalty?.noPlay) return null;
  return play.playType === "run" || play.playType === "pass" || play.playType === "sack" ? play.playType : null;
}

/** Who a play credits in each role that makes it the play it is: the carrier, the passer and receiver, the quarterback sacked. */
function rolesOf(play: StatsPlay, family: "run" | "pass" | "sack"): string[] {
  const of = (actions: readonly StatsEvent["action"][]) => play.events.find((event) => actions.includes(event.action))?.playerId ?? "";
  if (family === "run") return [of(["rush"])];
  if (family === "sack") return [of(["sacked"])];
  return [of(["pass_complete", "pass_incomplete", "pass_intercepted"]), of(["reception", "interception"])];
}

/** The same carrier, or the same passer and receiver: every role named the same, and at least one named. */
function samePlayers(play: StatsPlay, earlier: StatsPlay, family: "run" | "pass" | "sack"): boolean {
  const now = rolesOf(play, family);
  const then = rolesOf(earlier, family);
  return now.some((id) => id !== "") && now.every((id, index) => id === then[index]);
}

/** The gain a play states, or null. */
function statedGain(play: StatsPlay): number | null {
  return play.events.find((event) => event.yards !== null && event.yardsSource === "stated")?.yards ?? null;
}

/**
 * The POST lines the yards solver may read a number from (fix 1, Part 5): up
 * to the first that starts the next play (a snap, "hands it to", "fires"). A
 * down-and-distance line stays: "a gain of 6 brings up second and 4" is
 * about the play just over.
 */
function postForYards(segment: PlaySegment): string[] {
  const lines: string[] = [];
  for (const line of segment.postLines) {
    if (line.cues.snap || startsNewPlay(line.text)) break;
    lines.push(line.text);
  }
  return lines;
}

/** Who decides whether a segment is a recap (segment.ts rule 7): a quarterback or a skill player by roster position. */
function offensiveIn(roster: readonly StatsRosterPlayer[]): (playerId: string) => boolean {
  const ids = new Set(roster.filter((player) => hasGroup(player.position, "qb") || hasGroup(player.position, "skill")).map((player) => player.playerId));
  return (playerId) => ids.has(playerId);
}

export interface V7Options {
  maxCostUsd: number | null;
  allowInferredRb: boolean;
  /** Keep every request and its answer (details), for the replay harness's plays file. */
  recordDetail?: boolean;
}

export class V7Reader {
  private readonly segmenter: Segmenter;
  private readonly tracker: GameTracker;
  private context: ParseContext;
  private readonly lines = new Map<number, ParsedLine>();
  /** Closed segments waiting for their POST lines (fix 1, Part 1), in line order. */
  private held: PlaySegment[] = [];
  private queue: Job[] = [];
  private inFlight: Promise<void> | null = null;
  private spentUsd = 0;
  private secondLooks = 0;
  private driveRereads = 0;
  private gapRereads = 0;
  private readonly secondLooked = new Set<string>();
  private readonly rereadDrives = new Set<string>();
  private readonly gapsSeen = new Set<string>();
  /** What each segment was answered, by segment id, and which segment each play came from. */
  private readonly answered = new Map<string, Answered>();
  private readonly segmentOf = new Map<string, string>();
  /** The last segment read as a new play, for the back-fill of its yards when the next call lands. */
  private lastPlay: { playId: string; segment: PlaySegment } | null = null;
  private silent = false;
  /** Seconds from a segment's last line to its play being applied. */
  readonly latencies: number[] = [];
  /** Every segment the segmenter closed (a sweep included), for the segmentation scorer. */
  readonly segments: SegmentSummary[] = [];
  /** Every request with its answer, when built with recordDetail; empty otherwise. */
  readonly details: SegmentDetail[] = [];

  // Fields assigned in the constructor rather than as parameter properties:
  // `npm run replay:stats` runs this file through Node's own type stripping,
  // which refuses parameter properties (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX).
  private readonly host: V7Host;
  private readonly options: V7Options;

  constructor(host: V7Host, options: V7Options) {
    this.host = host;
    this.options = options;
    this.segmenter = new Segmenter(offensiveIn(host.roster()));
    this.tracker = new GameTracker(host.teams());
    this.context = parseContextFor(host.roster(), host.teams(), null);
  }

  setRoster(roster: readonly StatsRosterPlayer[]) {
    this.context = parseContextFor(roster, this.host.teams(), null);
    this.segmenter.setOffensive(offensiveIn(roster));
  }

  setTeams(teams: TeamWords | null) {
    this.context = parseContextFor(this.host.roster(), teams, null);
  }

  /** The segmenter's own counts: recaps joined to the play before (segment.ts rule 7). */
  segmenterCounts(): SegmenterCounts {
    return { ...this.segmenter.counts, joins: [...this.segmenter.counts.joins] };
  }

  counts(): V7Counts {
    return { secondLooks: this.secondLooks, driveRereads: this.driveRereads, gapRereads: this.gapRereads, spentUsd: this.spentUsd };
  }

  /** While the log is being read back: lines are parsed and segmented, but nothing is read. */
  restoreBegin() {
    this.silent = true;
  }

  /** The log is in: the counted plays move the tracker, and reading starts. */
  restoreEnd(session: StatsSession, counts: { secondLooks: number; driveRereads: number; gapRereads: number }) {
    this.silent = false;
    this.queue = [];
    this.held = [];
    this.secondLooks = counts.secondLooks;
    this.driveRereads = counts.driveRereads;
    this.gapRereads = counts.gapRereads;
    const live = session.plays.filter((play) => play.status !== "discarded").sort((a, b) => a.play.seqStart - b.play.seqStart);
    for (const play of live) this.tracker.onPlay(play.play);
    for (const drive of drivesOf(session.plays, this.sideOf())) {
      if (drive.endedBy !== null) this.rereadDrives.add(drive.plays[drive.plays.length - 1].playId);
    }
  }

  /** Whether a call is in flight or waiting: the harness's idle() waits on it. */
  busy(): boolean {
    // Once the loop is disposed nothing more is read, so a queue left behind is not work to wait for.
    if (this.host.disposed()) return false;
    return this.inFlight !== null || this.queue.length > 0;
  }

  pending(): Promise<void> | null {
    return this.inFlight;
  }

  // ---------------------------------------------------------------------------
  // The hot path: parse, track, segment. No await.
  // ---------------------------------------------------------------------------

  heard(seq: number, text: string, at: number) {
    const offense = this.tracker.snapshot().possession;
    const line = parseLine(text, { ...this.context, offense }, seq);
    this.lines.set(seq, line);
    this.tracker.onLine(line);
    this.enqueue(this.segmenter.push(line, at), at);
  }

  tick(now: number) {
    this.enqueue(this.segmenter.tick(now), now);
    this.pump();
  }

  /** End game: the open segment closes and everything waiting is read. Resolves once the queue is empty. */
  async finish(now: number): Promise<void> {
    this.enqueue(this.segmenter.finish(now), now, true);
    this.pump();
    while (this.busy() && !this.host.disposed()) {
      if (this.inFlight) await this.inFlight.catch(() => undefined);
      await Promise.resolve();
      this.pump();
    }
  }

  /**
   * Segments that closed wait on `held` until their POST lines are in (fix
   * 1, Part 1): POST_LINES of them, the window closed (a call, a snap, a
   * later segment), POST_WAIT_MS since the segment closed, or End game.
   * Released in line order, so the queue stays in line order.
   */
  private enqueue(segments: readonly PlaySegment[], now: number, all = false) {
    if (this.silent) return;
    for (const segment of segments) {
      this.segments.push({ id: segment.id, lineStart: segment.lineStart, lineEnd: segment.lineEnd, startedAt: segment.startedAt, lastLineAt: segment.lastLineAt, emittedAt: segment.emittedAt, closedBy: segment.closedBy, playId: null });
      this.held.push(segment);
    }
    while (this.held.length > 0) {
      const segment = this.held[0];
      const ready = all || segment.postLines.length >= POST_LINES || segment.postClosedAt !== null || now - segment.emittedAt >= POST_WAIT_MS;
      if (!ready) break;
      this.held.shift();
      // Sent as it is now: nothing more is added to it.
      segment.postClosedAt ??= now;
      this.queue.push({ segment, look: "segment" });
    }
    this.trimQueue();
    this.pump();
  }

  /** A backlog past V7_QUEUE_MAX loses its oldest re-read first, then its oldest segment, and the log says so. */
  private trimQueue() {
    while (this.queue.length > V7_QUEUE_MAX) {
      const background = this.queue.findIndex((job) => !FRESH.has(job.look));
      const [dropped] = this.queue.splice(background >= 0 ? background : 0, 1);
      this.host.log({ kind: "stats_reply", gameId: this.host.gameId, at: this.host.now(), ok: false, code: V7_QUEUE_DROPPED, seqFrom: dropped.segment.lineStart, seqTo: dropped.segment.lineEnd, segmentId: dropped.segment.id });
    }
  }

  /** The next read: a first read or a second look before any re-read (fix 1, Part 1), each kind in the order it was queued. */
  private nextJob(): Job | undefined {
    const fresh = this.queue.findIndex((job) => FRESH.has(job.look));
    return this.queue.splice(fresh >= 0 ? fresh : 0, 1)[0];
  }

  private pump() {
    if (this.inFlight || this.host.disposed()) return;
    const job = this.nextJob();
    if (!job) return;
    this.inFlight = this.read(job)
      .catch(() => {
        this.host.failed("apply_failed", job.segment.lineStart, job.segment.lineEnd);
      })
      .finally(() => {
        this.inFlight = null;
        this.pump();
      });
  }

  // ---------------------------------------------------------------------------
  // One segment, read.
  // ---------------------------------------------------------------------------

  private sideOf(): ReadonlyMap<string, Side> {
    return new Map(this.host.roster().map((player) => [player.playerId, player.side]));
  }

  private countedPlays(): StatsPlay[] {
    return this.host.session().plays.filter((play) => play.status !== "discarded").map((play) => play.play);
  }

  private qbs(): Record<Side, string | null> {
    return currentQbs(this.host.roster(), this.countedPlays(), this.host.out());
  }

  /**
   * What the extractor is told: the tracker's view, with the segment's own
   * call before the play standing in for the down, distance and spot (the
   * tracker has already moved on to the call that closed the segment), and
   * the segment's own offense (fix 1, Part 3).
   */
  private gameState(qbs: Record<Side, string | null>, segment: PlaySegment | null, offense: Side | null): V7GameState {
    const tracker = this.tracker.readerState();
    const state: V7GameState = {};
    if (tracker.teams) state.teams = tracker.teams;
    if (tracker.quarter !== undefined) state.quarter = tracker.quarter;
    if (tracker.score) state.score = tracker.score;
    if (offense) state.offense = offense;
    if (segment?.ddBefore) {
      state.down = segment.ddBefore.down;
      if (segment.ddBefore.distance !== null) state.distance = segment.ddBefore.distance;
      if (segment.spotBefore && offense) {
        const progress = spotProgress(segment.spotBefore, offense);
        if (progress !== null) {
          const defense: Side = offense === "home" ? "away" : "home";
          state.spot = progress === 50 ? { yardLine: 50, territory: "midfield" } : progress < 50 ? { yardLine: progress, territory: offense } : { yardLine: 100 - progress, territory: defense };
          state.spotSaid = true;
        }
      }
    } else {
      // The tracker's next snap, only when it is about this offense and no call said after this segment began has moved it on.
      const said = this.tracker.snapshot().ddSeq;
      const current = segment === null || said === null || said < segment.lineStart;
      if (current && offense !== null && tracker.possession === offense) {
        if (tracker.down !== undefined) state.down = tracker.down;
        if (tracker.distance !== undefined) state.distance = tracker.distance;
        if (tracker.spot) state.spot = tracker.spot;
        if (tracker.spotSaid !== undefined) state.spotSaid = tracker.spotSaid;
      }
    }
    const known: Partial<Record<Side, string>> = {};
    for (const side of ["home", "away"] as const) if (qbs[side]) known[side] = qbs[side]!;
    if (Object.keys(known).length > 0) state.qbs = known;
    return state;
  }

  private facts(segment: PlaySegment): SegmentFacts {
    const lines = [
      ...segment.preLines.map((line) => ({ seq: line.seq, text: line.text, role: "pre" as const })),
      ...segment.lines.map((line) => ({ seq: line.seq, text: line.text, role: "play" as const })),
      ...segment.postLines.map((line) => ({ seq: line.seq, text: line.text, role: "post" as const })),
    ];
    return { id: segment.id, lines, dd: segment.ddBefore ? { down: segment.ddBefore.down, distance: segment.ddBefore.distance, isGoal: segment.ddBefore.isGoal } : null };
  }

  /**
   * Who has the ball on this segment (fix 1, Part 3), in this order: a
   * possession phrase in its PRE lines, or in its PLAY lines when the play is
   * no turnover or kick (there it says who has it after); the vote of the
   * offensive players its PLAY lines name, when it is decisive or nothing
   * else is known; the tracker's timeline at its first line, within the
   * current drive (GameTracker.currentAt); else unknown.
   * Never the offense of a play the tracker itself filled in.
   */
  offenseFor(segment: PlaySegment, roster: readonly StatsRosterPlayer[]): SegmentOffense {
    for (const line of [...segment.preLines].reverse()) {
      const side = this.tracker.phraseIn(line);
      if (side) return { side, basis: "phrase" };
    }
    if (!segment.cues.turnover && !segment.cues.kick) {
      for (const line of segment.lines) {
        const side = this.tracker.phraseIn(line);
        if (side) return { side, basis: "phrase" };
      }
    }
    // Only a fact from this drive: past a score, a turnover or a kick nobody counted yet, the tracker does not know.
    const known = this.tracker.currentAt(segment.lineStart - 1);
    const vote = voteOf(segment.lines, roster, segment.preLines);
    if (vote && (vote.margin >= DECISIVE_VOTE || !known)) return { side: vote.side, basis: "skill" };
    if (known) return { side: known.side, basis: "tracker" };
    return { side: null, basis: null };
  }

  private async read(job: Job): Promise<void> {
    const host = this.host;
    const { segment } = job;
    const roster = host.roster();
    const qbs = this.qbs();
    // The flips the counted plays imply, rebuilt every read, then this segment's own offense.
    this.tracker.setFlips(flipsOf(host.session().plays, roster));
    const said = this.offenseFor(segment, roster);
    const offense = said.side;
    const offenseSaid = said.basis === "phrase" || said.basis === "skill";
    const tonight = talliesOf(host.session());
    const candidates = job.candidates ?? buildCandidates(segment, { offense, qbs }, roster, tonight);
    const request: SegmentRequest = {
      look: job.look,
      segment: this.facts(segment),
      candidates,
      gameState: this.gameState(qbs, segment, offense),
      budget: { spentUsd: this.spentUsd, maxCostUsd: this.options.maxCostUsd },
      ...(job.current ? { current: job.current } : {}),
      ...(job.note ? { note: job.note } : {}),
    };
    const detail = this.options.recordDetail ? this.detailOf(job, request, said.basis) : null;
    const reply = await host.extractSegment(request);
    if (host.disposed()) return;
    const at = host.now();
    if (!reply.ok) {
      if (detail) detail.failed = reply.code;
      host.failed(reply.code, segment.lineStart, segment.lineEnd);
      return;
    }
    if (detail) {
      detail.answers = reply.answers ?? null;
      detail.reconciled = reply.answer;
      detail.agreement = reply.agreement;
    }
    host.succeeded();
    let tokensIn = 0;
    let tokensOut = 0;
    let tokensCached = 0;
    for (const call of reply.calls) {
      this.spentUsd += call.costUsd;
      tokensIn += call.promptTokens + call.cachedTokens + call.cacheWriteTokens;
      tokensOut += call.completionTokens;
      tokensCached += call.cachedTokens;
      host.addUsage({ inputTokens: call.promptTokens, outputTokens: call.completionTokens, cacheWriteTokens: call.cacheWriteTokens, cacheReadTokens: call.cachedTokens, costUsd: call.costUsd, reasoningTokens: call.reasoningTokens });
    }
    const v7Look = job.look === "segment" ? undefined : job.look;
    const context = { utterances: host.utterances(), out: host.out(), teams: host.teams(), readThrough: this.lastSeqSeen(), trustNamed: true as const };

    if (job.look === "reread") {
      const outcome = this.correct(job, reply.answer, candidates, at);
      host.log({ kind: "stats_reply", gameId: host.gameId, at, ok: true, plays: outcome.play ? [outcome.play] : [], seqFrom: segment.lineStart, seqTo: segment.lineEnd, tokensIn, tokensOut, tokensCached, look: "drive", segmentId: segment.id, agreement: reply.agreement, answer: reply.answer, v7Look });
      return;
    }

    const mapped = answerToPlay(reply.answer, segment, candidates, { offense, offenseSaid, out: host.out(), roster });
    host.log({ kind: "stats_reply", gameId: host.gameId, at, ok: true, plays: mapped.play ? [mapped.play] : [], seqFrom: segment.lineStart, seqTo: segment.lineEnd, tokensIn, tokensOut, tokensCached, ...(job.look === "second" ? { look: "second" as const } : job.look === "gap" ? { look: "gap" as const } : {}), segmentId: segment.id, agreement: reply.agreement, answer: reply.answer, v7Look });
    this.answered.set(segment.id, { segment, candidates, answer: reply.answer, playId: null });

    if (!mapped.play) {
      this.maybeSecondLook(job, candidates, reply.answer);
      return;
    }
    const priors = applyPriors(mapped.play, roster, { allowInferredRb: this.options.allowInferredRb, out: host.out(), tonight, qbs });
    // Part 6 (R50): the same play read again from the talk after it joins that play as an update.
    const same = job.look === "gap" ? null : this.sameAs(priors.play, segment);
    const play = same ? { ...priors.play, updates: same } : priors.play;
    const notes = [...mapped.notes, ...priors.notes.map((note) => ({ ...note, rule: note.rule === "R9" ? ("R48" as const) : note.rule }))];
    const source = same
      ? { rule: "R50" as const, reason: "the same play read again from the talk after it" }
      : job.rule
        ? { rule: job.rule, reason: job.rule === "R38" ? "read on the second look at a quiet segment" : "read from the lines where the downs say a snap was missed" }
        : undefined;
    const read = readPlays(host.session(), [play], roster, at, { ...context, ...(offenseSaid ? { v7OffenseSaid: true } : {}), ...(source ? { source } : {}) });
    let session = read.session;
    // The mapping's and the priors' notes ride on the play.
    const added = read.added.map((entry) => (notes.length > 0 ? { ...entry, dropped: [...notes, ...entry.dropped] } : entry));
    session = { ...session, plays: session.plays.map((entry) => added.find((each) => each.playId === entry.playId) ?? entry) };
    host.setSession(session);
    for (const entry of added) host.log({ kind: "stats_play", gameId: host.gameId, at, playId: entry.playId, play: entry.play, changes: entry.changes, dropped: entry.dropped });
    for (const entry of read.updated) host.log({ kind: "stats_update", gameId: host.gameId, at, playId: entry.playId, play: entry.play, changes: entry.changes, dropped: entry.dropped });

    if (detail && added.length > 0) detail.playId = added[0].playId;
    // A decisive vote is a fact about who has the ball once its play counts (a phrase is one already).
    if (added.length > 0 && said.basis === "skill" && said.side) this.tracker.note(said.side, "skill", segment.lineStart);
    for (const entry of added) {
      this.segmentOf.set(entry.playId, segment.id);
      const held = this.answered.get(segment.id);
      if (held) held.playId = entry.playId;
      const summary = this.segments.find((each) => each.id === segment.id);
      if (summary) summary.playId = entry.playId;
      // The yards: this play now, and the play before it with this segment's call as its next facts.
      this.solveFor(entry.playId, segment, null, at);
      this.tracker.onPlay(host.session().plays.find((each) => each.playId === entry.playId)?.play ?? entry.play);
      this.latencies.push(Math.max(0, (at - segment.lastLineAt) / 1000));
    }
    if (same && detail) detail.playId = same;
    if (added.length === 0 && mapped.play && !same) this.maybeSecondLook(job, candidates, reply.answer);
    if (this.lastPlay && added.length > 0 && job.look === "segment") this.solveFor(this.lastPlay.playId, this.lastPlay.segment, segment, at);
    if (added.length > 0 && job.look === "segment") this.lastPlay = { playId: added[0].playId, segment };

    const drivesBefore = drivesOf(this.previousPlays, this.sideOf());
    this.previousPlays = host.session().plays;
    host.changed();
    for (const entry of added) host.added(host.session().plays.find((each) => each.playId === entry.playId) ?? entry);
    // Part 9: a drive that ended is re-read play by play; a snap the downs say was missed is read from its lines.
    for (const drive of newlyEnded(drivesBefore, drivesOf(host.session().plays, this.sideOf()))) this.rereadDrive(drive.plays.map((entry) => entry.playId));
    if (job.look !== "gap") this.rereadGaps(context);
  }

  private previousPlays: readonly SessionPlay[] = [];

  /**
   * Part 6: whether a segment is talk about the counted play just before it:
   * it started within DUP_JOIN_MS of that play's segment closing, with no call
   * or snap between or in it, and every offensive player it names clearly is
   * one that play credits.
   */
  private talkAboutCounted(segment: PlaySegment): boolean {
    const last = this.host
      .session()
      .plays.filter((entry) => entry.status !== "discarded" && entry.play.seqEnd < segment.lineStart)
      .sort((a, b) => b.play.seqEnd - a.play.seqEnd)[0];
    if (!last) return false;
    const before = this.answered.get(this.segmentOf.get(last.playId) ?? "")?.segment;
    if (!before || segment.startedAt - before.emittedAt > DUP_JOIN_MS) return false;
    if (segment.ddBeforeSeq !== null && segment.ddBeforeSeq > last.play.seqEnd) return false;
    for (let seq = last.play.seqEnd + 1; seq <= segment.lineEnd; seq++) {
      const line = this.lines.get(seq);
      if (line && (line.dd !== null || line.cues.snap)) return false;
    }
    const credited = new Set(last.play.events.map((event) => event.playerId).filter((id) => id !== ""));
    const offensive = offensiveIn(this.host.roster());
    return segmentNameHits(segment)
      .filter((hit) => hit.score >= V7_SECOND_LOOK_MIN_SCORE && offensive(hit.playerId))
      .every((hit) => credited.has(hit.playerId));
  }

  /**
   * Part 6 (R50): the counted play this read is the same play as, or null. One
   * of the last DUP_LOOKBACK counted plays before the segment, when all of
   * these hold: the same kind of play (a run, a pass, a sack); the same
   * carrier, or the same passer and receiver; no down-and-distance call or
   * snap in the lines between; the segment started within DUP_JOIN_MS of
   * that play's segment closing; and no stated gain more than a yard apart.
   */
  private sameAs(play: StatsPlay, segment: PlaySegment): string | null {
    const family = familyOf(play);
    if (!family) return null;
    const earlier = this.host
      .session()
      .plays.filter((entry) => entry.status !== "discarded" && entry.play.seqEnd < segment.lineStart)
      .sort((a, b) => b.play.seqEnd - a.play.seqEnd)
      .slice(0, DUP_LOOKBACK);
    for (const entry of earlier) {
      if (familyOf(entry.play) !== family) continue;
      if (!samePlayers(play, entry.play, family)) continue;
      const before = this.answered.get(this.segmentOf.get(entry.playId) ?? "")?.segment;
      if (!before || segment.startedAt - before.emittedAt > DUP_JOIN_MS) continue;
      if (segment.ddBeforeSeq !== null && segment.ddBeforeSeq > entry.play.seqEnd) continue;
      let boundary = false;
      for (let seq = entry.play.seqEnd + 1; seq < segment.lineStart && !boundary; seq++) {
        const line = this.lines.get(seq);
        if (line && (line.dd !== null || line.cues.snap)) boundary = true;
      }
      if (boundary || segment.lines.some((line) => line.cues.snap)) continue;
      const gain = statedGain(play);
      const earlierGain = statedGain(entry.play);
      if (gain !== null && earlierGain !== null && Math.abs(gain - earlierGain) > 1) continue;
      return entry.playId;
    }
    return null;
  }

  /** The request as sent, for the plays file; its answer is filled in when it lands. */
  private detailOf(job: Job, request: SegmentRequest, offenseFrom: SegmentOffense["basis"]): SegmentDetail {
    const { segment } = job;
    const state = request.gameState;
    const gameState: SegmentDetail["gameState"] = {};
    if (state.offense) gameState.offense = state.offense;
    if (state.down !== undefined) gameState.down = state.down;
    if (state.distance !== undefined) gameState.distance = state.distance;
    if (state.spot) gameState.spot = state.spot;
    if (state.qbs) gameState.qbs = state.qbs;
    const detail: SegmentDetail = {
      segmentId: segment.id,
      look: job.look,
      closedBy: segment.closedBy,
      sentAt: this.host.now(),
      lastLineAt: segment.lastLineAt,
      lines: request.segment.lines.map((line) => ({ ...line })),
      candidates: request.candidates.map((candidate) => ({ idx: candidate.idx, playerId: candidate.playerId, label: candidate.label, score: candidate.score, tags: [...candidate.tags] })),
      gameState,
      offenseFrom,
      answers: null,
      reconciled: null,
      agreement: null,
      failed: null,
      playId: job.look === "reread" ? (job.playId ?? null) : null,
    };
    this.details.push(detail);
    return detail;
  }

  /** The last line the reader has seen: the newest line parsed. */
  private lastSeqSeen(): number {
    let last = -1;
    for (const seq of this.lines.keys()) if (seq > last) last = seq;
    return last;
  }

  // ---------------------------------------------------------------------------
  // The yards (Part 6).
  // ---------------------------------------------------------------------------

  /**
   * Where the ball was before this play, by the plays counted before it
   * (gameState.ts's stateAfter: a kick, a turnover or a flag leaves nothing),
   * when the last of them is this offense's and ended within BALL_CARRY_MS of
   * this play's first line; null otherwise (fix 1, item 2).
   */
  private ballBefore(play: StatsPlay): GameState | null {
    if (!play.offense) return null;
    const before = this.countedPlays().filter((each) => each.seqEnd < play.seqStart).sort((a, b) => a.seqStart - b.seqStart || a.seqEnd - b.seqEnd);
    const last = before[before.length - 1];
    if (!last) return null;
    const times = new Map(this.host.utterances().map((line) => [line.seq, line.offsetMs]));
    const endedAt = times.get(last.seqEnd);
    const startedAt = times.get(play.seqStart);
    if (endedAt === undefined || startedAt === undefined || startedAt - endedAt > BALL_CARRY_MS) return null;
    const state = stateAfter(before);
    return state.possession === play.offense ? state : null;
  }

  private yardsFacts(play: StatsPlay, segment: PlaySegment, answer: ExtractAnswer | null, next: PlaySegment | null): YardsFacts {
    const offense = play.offense;
    const progress = (spot: StatsPlay["startSpot"]) => (spot && offense ? absoluteSpot(spot, offense) : null);
    // The play before: its end is this play's start, its implied down this play's down, when nothing was said for this one.
    const ball = segment.ddBefore && play.startSpot ? null : this.ballBefore(play);
    const gain = play.events.find((event) => event.yards !== null && event.yardsSource === "ledger");
    const nextStart = next?.spotBefore && offense ? spotProgress(next.spotBefore, offense) : null;
    return {
      playType: answer?.playType ?? (play.playType === "run" ? "rush" : play.playType === "sack" ? "sack" : play.events.some((event) => event.action === "pass_incomplete") ? "pass_incomplete" : play.playType === "pass" ? "pass_complete" : "not_a_play"),
      yardsSaid: answer?.yardsSaid ?? null,
      lines: segment.lines.map((line) => line.text),
      postLines: postForYards(segment),
      dd: segment.ddBefore ? { down: segment.ddBefore.down, distance: segment.ddBefore.distance, isGoal: segment.ddBefore.isGoal } : ball && ball.down !== null ? { down: ball.down, distance: ball.distance, isGoal: false } : null,
      nextDd: next?.ddBefore ? { down: next.ddBefore.down, distance: next.ddBefore.distance, isGoal: next.ddBefore.isGoal } : null,
      startSpot: progress(play.startSpot) ?? ball?.spot ?? null,
      endSpot: progress(play.endSpot),
      nextStart,
      penalty: answer?.penalty ?? (play.penalty && play.penalty.on !== "none" ? (play.penalty.on === "unknown" ? "unclear" : play.penalty.on) : "none"),
      penaltyYards: play.penalty?.penaltyYards ?? null,
      ledger: gain?.yards ?? null,
      touchdown: play.touchdown,
    };
  }

  /**
   * The next segment's facts, or what the segment's own post lines say: the
   * call that closed it is the next down and distance. Else (fix 1, item 2)
   * the first call in the NEXT_CALL_LINES lines after the play, before a line
   * that starts the next play: a TV booth says the down between plays, in
   * talk no segment keeps.
   */
  private nextFacts(segment: PlaySegment, next: PlaySegment | null): PlaySegment | null {
    if (next?.ddBefore) return next;
    const callOf = (line: ParsedLine): PlaySegment => ({ ...segment, ddBefore: line.dd, spotBefore: line.spots.find((entry) => entry.kind === "at" || entry.kind === "start") ?? null });
    const call = segment.postLines.find((line) => line.dd !== null);
    if (call?.dd) return callOf(call);
    for (let seq = segment.lineEnd + 1; seq <= segment.lineEnd + NEXT_CALL_LINES; seq++) {
      if (next && seq >= next.lineStart) break;
      const line = this.lines.get(seq);
      if (!line) continue;
      if (line.dd) return callOf(line);
      if (line.cues.snap || startsNewPlay(line.text)) break;
    }
    return next;
  }

  /** The solver on one counted play, with the next segment's facts when it has arrived. A stated figure is never replaced. */
  private solveFor(playId: string, segment: PlaySegment, next: PlaySegment | null, at: number) {
    const host = this.host;
    const entry = host.session().plays.find((play) => play.playId === playId);
    if (!entry || entry.status === "discarded" || gainIs(entry.play) === "stated" || gainIs(entry.play) === "none") return;
    const answer = this.answered.get(segment.id)?.answer ?? null;
    const solution = solveYards(this.yardsFacts(entry.play, segment, answer, this.nextFacts(segment, next)));
    if (solution.yards === null || !solution.source || !solution.method) return;
    const held = entry.play.events.find((event) => event.yards !== null);
    if (held && held.yards === solution.yards && held.yardsSource === solution.source) return;
    const context = { utterances: host.utterances(), out: host.out(), teams: host.teams(), trustNamed: true as const };
    const reason = `yards from the ${solution.method === "dd" ? "next down and distance" : solution.method === "spots" ? "yard lines" : solution.method === "stated" ? "words of the play" : solution.method === "statedPost" ? "words after the play" : solution.method}${solution.agree ? "" : " (another method disagrees)"}`;
    const set = setPlayGain(host.session(), playId, { yards: solution.yards, source: solution.source }, "R47", reason, host.roster(), context);
    if (!set.updated) return;
    host.setSession(set.session);
    host.log({ kind: "stats_update", gameId: host.gameId, at, playId, play: set.updated.play, changes: set.updated.changes, dropped: set.updated.dropped });
    host.changed();
  }

  // ---------------------------------------------------------------------------
  // The second look, the drive re-read and the gap re-read (Part 9).
  // ---------------------------------------------------------------------------

  private maybeSecondLook(job: Job, candidates: readonly Candidate[], answer: ExtractAnswer) {
    if (job.look !== "segment" || this.secondLooked.has(job.segment.id)) return;
    // Part 6: talk about the counted play just before is not worth asking again.
    if (this.talkAboutCounted(job.segment)) return;
    if (this.secondLooks >= V7_SECOND_LOOKS_PER_GAME || this.overBudget()) return;
    const credited = [answer.carrierIdx, answer.passerIdx, answer.receiverIdx].some((idx) => idx !== null && idx !== 0);
    if (credited) return;
    // Named in the play or after it: a name said only before the snap is not reason enough to ask again.
    if (!candidates.some((candidate) => candidate.playerId !== null && candidate.score >= V7_SECOND_LOOK_MIN_SCORE && !candidate.tags.includes(NAMED_BEFORE_SNAP))) return;
    this.secondLooked.add(job.segment.id);
    this.secondLooks += 1;
    this.queue.unshift({ segment: job.segment, look: "second", rule: "R38", candidates: [...candidates] });
  }

  private overBudget(): boolean {
    return this.options.maxCostUsd !== null && this.spentUsd >= this.options.maxCostUsd;
  }

  private rereadDrive(playIds: readonly string[]) {
    const endId = playIds[playIds.length - 1];
    if (this.rereadDrives.has(endId) || this.overBudget()) return;
    this.rereadDrives.add(endId);
    let queued = 0;
    for (const playId of playIds) {
      const segmentId = this.segmentOf.get(playId);
      const held = segmentId ? this.answered.get(segmentId) : undefined;
      if (!held) continue;
      this.queue.push({ segment: held.segment, look: "reread", current: held.answer, playId, rule: "R39", candidates: held.candidates });
      queued += 1;
    }
    if (queued > 0) this.driveRereads += 1;
    this.trimQueue();
    this.pump();
  }

  /** A re-read's answer, accepted as a correction when it passes the name check and its yards match a method; refused and noted otherwise. */
  private correct(job: Job, answer: ExtractAnswer, candidates: readonly Candidate[], at: number): { play: StatsPlay | null } {
    const host = this.host;
    const playId = job.playId!;
    const entry = host.session().plays.find((play) => play.playId === playId);
    const held = this.answered.get(job.segment.id);
    if (!entry || entry.status === "discarded" || !held) return { play: null };
    const current = held.answer;
    const same = agreementKey(answer) === agreementKey(current) && answer.yardsSaid === current.yardsSaid && answer.tacklerIdx === current.tacklerIdx && answer.touchdown === current.touchdown;
    if (same) return { play: null };
    const refuse = (reason: string) => {
      const noted = { ...entry, dropped: [...entry.dropped, { playerId: "", action: "reread", rule: "R49" as const, reason: `the drive re-read's correction was refused: ${reason}`, kind: "noted" as const }] };
      host.setSession({ ...host.session(), plays: host.session().plays.map((play) => (play.playId === playId ? noted : play)) });
      host.log({ kind: "stats_update", gameId: host.gameId, at, playId, play: noted.play, changes: noted.changes, dropped: noted.dropped });
      host.noted();
      return { play: null };
    };
    if (entry.edited) return refuse("the announcer corrected the play");
    // The name check: every credited index is a named candidate, or the quarterback prior for the passer. A
    // player named only before the snap stays only where the first read put him: a re-read never adds one.
    for (const [field, idx, was] of [["carrier", answer.carrierIdx, current.carrierIdx], ["passer", answer.passerIdx, current.passerIdx], ["receiver", answer.receiverIdx, current.receiverIdx], ["tackler", answer.tacklerIdx, current.tacklerIdx]] as const) {
      if (idx === null || idx === 0) continue;
      const candidate = candidateAt(candidates, idx);
      if (!candidate) return refuse(`${field} index ${idx} is not on the list`);
      const beforeSnap = candidate.tags.includes(NAMED_BEFORE_SNAP);
      const named = (candidate.score >= CANDIDATE_MIN_SCORE && (!beforeSnap || idx === was)) || (field === "passer" && candidate.tags.includes("prior:qb"));
      if (!named) return refuse(`${field} ${candidate.label} is not named in the lines${beforeSnap ? ", only before the snap" : ""}`);
    }
    // The yards: null, unchanged, or a number a solver method gives.
    if (answer.yardsSaid !== null && answer.yardsSaid !== current.yardsSaid) {
      const lines = [...job.segment.lines, ...job.segment.postLines].map((line) => line.text);
      // The methods speak without the proposed number: the words, the downs, the spots, the ledger.
      const solution = solveYards(this.yardsFacts(entry.play, job.segment, { ...answer, yardsSaid: null }, this.nextFacts(job.segment, null)));
      const matches = solution.candidates.some((candidate) => Math.abs(candidate.yards - answer.yardsSaid!) <= 1) || numberInLines(answer.yardsSaid, lines);
      if (!matches) return refuse(`${answer.yardsSaid} yards matches no method`);
    }
    const mapped = answerToPlay(answer, job.segment, candidates, { offense: entry.play.offense, out: host.out(), roster: host.roster() });
    if (!mapped.play) {
      const removed = { ...entry, status: "discarded" as const, decidedAt: at, dropped: [...entry.dropped, { playerId: "", action: "remove", rule: "R49" as const, reason: "the drive re-read says this was not a play; taken out", kind: "dropped" as const }] };
      host.setSession({ ...host.session(), plays: host.session().plays.map((play) => (play.playId === playId ? removed : play)) });
      host.log({ kind: "stats_decision", gameId: host.gameId, at, playId, decision: "discard" });
      host.changed();
      return { play: null };
    }
    const update: StatsPlay = { ...mapped.play, updates: playId };
    const read = readPlays(host.session(), [update], host.roster(), at, {
      utterances: host.utterances(),
      out: host.out(),
      teams: host.teams(),
      readThrough: this.lastSeqSeen(),
      trustNamed: true,
      reread: { ids: new Set([playId]) },
      source: { rule: "R39", reason: "corrected by the drive's re-read of this play" },
    });
    host.setSession(read.session);
    held.answer = answer;
    for (const changed of read.updated) host.log({ kind: "stats_update", gameId: host.gameId, at, playId: changed.playId, play: changed.play, changes: changed.changes, dropped: changed.dropped });
    // A shared credit the correction no longer names (a tackle, a breakup) comes off: the merge only ever adds one.
    const keep = new Set(mapped.play.events.map(eventKey));
    const dropped = dropSharedCredits(host.session(), playId, keep, { playerId: "", action: "reread", rule: "R39", reason: "corrected by the drive's re-read of this play: a credit it no longer names is taken off", kind: "changed" }, host.roster(), { utterances: host.utterances(), out: host.out(), teams: host.teams(), trustNamed: true });
    if (dropped.updated) {
      host.setSession(dropped.session);
      host.log({ kind: "stats_update", gameId: host.gameId, at, playId, play: dropped.updated.play, changes: dropped.updated.changes, dropped: dropped.updated.dropped });
    }
    if (read.updated.length > 0 || dropped.updated) {
      this.solveFor(playId, job.segment, null, at);
      host.changed();
    }
    return { play: update };
  }

  private rereadGaps(context: { utterances: readonly { seq: number; text: string; offsetMs: number }[]; teams: TeamWords | null }) {
    if (this.overBudget()) return;
    for (const gap of ledgerGaps(this.host.session(), this.host.roster(), { utterances: context.utterances, teams: context.teams })) {
      const found = this.gapLines(gap);
      if (!found) continue;
      const { pre, lines } = found;
      const key = `${lines[0].seq}|${lines[lines.length - 1].seq}`;
      if (this.gapsSeen.has(key)) continue;
      if (this.gapRereads >= V7_GAP_REREADS_PER_GAME) return;
      this.gapsSeen.add(key);
      this.gapRereads += 1;
      const segment: PlaySegment = {
        id: `gap-${lines[0].seq}-${lines[lines.length - 1].seq}`,
        lineStart: lines[0].seq,
        lineEnd: lines[lines.length - 1].seq,
        lines,
        preLines: pre,
        // Nothing after the gap: those lines are the next play's (fix 1, Part 1).
        postLines: [],
        postClosedAt: this.host.now(),
        ddBefore: gap.before.down !== null ? { down: gap.before.down as 1 | 2 | 3 | 4, distance: gap.before.distance, isGoal: false, fuzzy: false, lineIdx: 0, span: [0, 0] } : null,
        ddBeforeSeq: null,
        spotBefore: null,
        cues: mergeCues(lines),
        emittedAt: this.host.now(),
        startedAt: this.host.now(),
        lastLineAt: this.host.now(),
        closedBy: "sweep",
      };
      const yards = gap.yards !== null ? `, so one snap of about ${gap.yards} yards is missing` : ", so one snap is missing";
      this.queue.push({ segment, look: "gap", note: `Between the two plays already entered, the ${gap.offense} team went from ${gap.before.down ?? "?"} and ${gap.before.distance ?? "?"} to ${gap.after.down ?? "?"} and ${gap.after.distance ?? "?"}${yards}.`, rule: "R44" });
    }
    this.pump();
  }

  /**
   * The parsed lines between the two plays of a gap, at most V7_MAX_GAP_LINES,
   * with V7_GAP_MARGIN_LINES before them as PRE; none after, since those are
   * the next play's own lines.
   */
  private gapLines(gap: LedgerGap): { pre: ParsedLine[]; lines: ParsedLine[] } | null {
    const plays = this.host.session().plays;
    const before = gap.beforeId ? plays.find((play) => play.playId === gap.beforeId) : null;
    const after = plays.find((play) => play.playId === gap.afterId);
    if (!after) return null;
    let from = before ? before.play.seqEnd + 1 : 0;
    if (!before) {
      const earlier = plays.filter((play) => play.status !== "discarded" && play.play.seqEnd < after.play.seqStart).reduce((last, play) => Math.max(last, play.play.seqEnd), -1);
      from = earlier + 1;
    }
    const to = after.play.seqStart - 1;
    if (to < from) return null;
    const seqTo = Math.min(to, from + V7_MAX_GAP_LINES - 1);
    const pick = (start: number, end: number) => {
      const picked: ParsedLine[] = [];
      for (let seq = start; seq <= end; seq++) {
        const line = this.lines.get(seq);
        if (line) picked.push(line);
      }
      return picked;
    };
    const lines = pick(from, seqTo);
    const pre = pick(Math.max(0, from - V7_GAP_MARGIN_LINES), from - 1);
    return lines.length > 0 && segmentNameHits({ lines, postLines: [] }).length + lines.filter((line) => line.cues.any).length > 0 ? { pre, lines } : null;
  }
}
