import type { EventName, EventProps } from "@/lib/analytics/events";
import type { StatsRecord } from "@/lib/log/statsLog";
import { buildCandidates, CANDIDATE_MIN_SCORE, candidateAt, type Candidate } from "./candidates";
import { currentQbs } from "./check";
import { drivesOf, newlyEnded } from "./drives";
import { answerToPlay } from "./extract/mapping";
import type { SegmentFacts, SegmentLine, SegmentLook, SegmentRequest, V7GameState } from "./extract/request";
import type { ReaderAnswers, SegmentReply } from "./extract/run";
import type { ExtractAnswer } from "./extract/schema";
import { absoluteSpot, gainIs } from "./gameState";
import type { LedgerGap } from "./ledger";
import { parseContextFor, parseLine, type ParseContext, type ParsedLine } from "./parse";
import { spotProgress } from "./parse/spots";
import { applyPriors } from "./priors";
import { agreementKey, numberInLines } from "./reconcile";
import { mergeCues, Segmenter, segmentNameHits, type PlaySegment } from "./segment";
import { dropSharedCredits, ledgerGaps, readPlays, setPlayGain, talliesOf, type SessionPlay, type StatsSession } from "./session";
import { eventKey } from "./check";
import { GameTracker } from "./stateMachine";
import type { Side, StatsPlay, StatsRosterPlayer, StatsUsage, TeamWords } from "./types";
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

/** Segments waiting to be read, at most: a backlog longer than this loses its oldest, which the log says. */
export const V7_QUEUE_MAX = 20;

/** Lines each side of a gap that go with it, and the most lines a gap read may carry. */
export const V7_GAP_MARGIN_LINES = 2;
export const V7_MAX_GAP_LINES = 40;

export const V7_QUEUE_DROPPED = "segment_dropped";

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

export interface V7Options {
  maxCostUsd: number | null;
  allowInferredRb: boolean;
  /** Keep every request and its answer (details), for the replay harness's plays file. */
  recordDetail?: boolean;
}

export class V7Reader {
  private readonly segmenter = new Segmenter();
  private readonly tracker: GameTracker;
  private context: ParseContext;
  private readonly lines = new Map<number, ParsedLine>();
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
    this.tracker = new GameTracker(host.teams());
    this.context = parseContextFor(host.roster(), host.teams(), null);
  }

  setRoster(roster: readonly StatsRosterPlayer[]) {
    this.context = parseContextFor(roster, this.host.teams(), null);
  }

  setTeams(teams: TeamWords | null) {
    this.context = parseContextFor(this.host.roster(), teams, null);
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
    this.enqueue(this.segmenter.push(line, at));
  }

  tick(now: number) {
    this.enqueue(this.segmenter.tick(now));
    this.pump();
  }

  /** End game: the open segment closes and everything waiting is read. Resolves once the queue is empty. */
  async finish(now: number): Promise<void> {
    this.enqueue(this.segmenter.finish(now));
    this.pump();
    while (this.busy() && !this.host.disposed()) {
      if (this.inFlight) await this.inFlight.catch(() => undefined);
      await Promise.resolve();
      this.pump();
    }
  }

  private enqueue(segments: readonly PlaySegment[]) {
    if (this.silent) return;
    for (const segment of segments) {
      this.segments.push({ id: segment.id, lineStart: segment.lineStart, lineEnd: segment.lineEnd, startedAt: segment.startedAt, lastLineAt: segment.lastLineAt, emittedAt: segment.emittedAt, closedBy: segment.closedBy, playId: null });
      this.queue.push({ segment, look: "segment" });
    }
    while (this.queue.length > V7_QUEUE_MAX) {
      const dropped = this.queue.shift()!;
      this.host.log({ kind: "stats_reply", gameId: this.host.gameId, at: this.host.now(), ok: false, code: V7_QUEUE_DROPPED, seqFrom: dropped.segment.lineStart, seqTo: dropped.segment.lineEnd, segmentId: dropped.segment.id });
    }
    this.pump();
  }

  private pump() {
    if (this.inFlight || this.host.disposed()) return;
    const job = this.queue.shift();
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
   * tracker has already moved on to the call that closed the segment).
   */
  private gameState(qbs: Record<Side, string | null>, segment: PlaySegment | null): V7GameState {
    const tracker = this.tracker.readerState();
    const state: V7GameState = {};
    if (tracker.teams) state.teams = tracker.teams;
    if (tracker.quarter !== undefined) state.quarter = tracker.quarter;
    if (tracker.score) state.score = tracker.score;
    const offense = tracker.possession ?? segment?.ddBefore?.down !== undefined ? tracker.possession : undefined;
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
      if (tracker.down !== undefined) state.down = tracker.down;
      if (tracker.distance !== undefined) state.distance = tracker.distance;
      if (tracker.spot) state.spot = tracker.spot;
      if (tracker.spotSaid !== undefined) state.spotSaid = tracker.spotSaid;
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

  private async read(job: Job): Promise<void> {
    const host = this.host;
    const { segment } = job;
    const roster = host.roster();
    const qbs = this.qbs();
    const offense = this.tracker.snapshot().possession;
    const tonight = talliesOf(host.session());
    const candidates = buildCandidates(segment, { offense, qbs }, roster, tonight);
    const request: SegmentRequest = {
      look: job.look,
      segment: this.facts(segment),
      candidates,
      gameState: this.gameState(qbs, segment),
      budget: { spentUsd: this.spentUsd, maxCostUsd: this.options.maxCostUsd },
      ...(job.current ? { current: job.current } : {}),
      ...(job.note ? { note: job.note } : {}),
    };
    const detail = this.options.recordDetail ? this.detailOf(job, request) : null;
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

    const mapped = answerToPlay(reply.answer, segment, candidates, { offense, out: host.out(), roster });
    host.log({ kind: "stats_reply", gameId: host.gameId, at, ok: true, plays: mapped.play ? [mapped.play] : [], seqFrom: segment.lineStart, seqTo: segment.lineEnd, tokensIn, tokensOut, tokensCached, ...(job.look === "second" ? { look: "second" as const } : job.look === "gap" ? { look: "gap" as const } : {}), segmentId: segment.id, agreement: reply.agreement, answer: reply.answer, v7Look });
    this.answered.set(segment.id, { segment, candidates, answer: reply.answer, playId: null });

    if (!mapped.play) {
      this.maybeSecondLook(job, candidates, reply.answer);
      return;
    }
    const priors = applyPriors(mapped.play, roster, { allowInferredRb: this.options.allowInferredRb, out: host.out(), tonight, qbs });
    const play = priors.play;
    const notes = [...mapped.notes, ...priors.notes.map((note) => ({ ...note, rule: note.rule === "R9" ? ("R48" as const) : note.rule }))];
    const source = job.rule ? { rule: job.rule, reason: job.rule === "R38" ? "read on the second look at a quiet segment" : "read from the lines where the downs say a snap was missed" } : undefined;
    const read = readPlays(host.session(), [play], roster, at, { ...context, ...(source ? { source } : {}) });
    let session = read.session;
    // The mapping's and the priors' notes ride on the play.
    const added = read.added.map((entry) => (notes.length > 0 ? { ...entry, dropped: [...notes, ...entry.dropped] } : entry));
    session = { ...session, plays: session.plays.map((entry) => added.find((each) => each.playId === entry.playId) ?? entry) };
    host.setSession(session);
    for (const entry of added) host.log({ kind: "stats_play", gameId: host.gameId, at, playId: entry.playId, play: entry.play, changes: entry.changes, dropped: entry.dropped });
    for (const entry of read.updated) host.log({ kind: "stats_update", gameId: host.gameId, at, playId: entry.playId, play: entry.play, changes: entry.changes, dropped: entry.dropped });

    if (detail && added.length > 0) detail.playId = added[0].playId;
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
    if (added.length === 0 && mapped.play) this.maybeSecondLook(job, candidates, reply.answer);
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

  /** The request as sent, for the plays file; its answer is filled in when it lands. */
  private detailOf(job: Job, request: SegmentRequest): SegmentDetail {
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

  private yardsFacts(play: StatsPlay, segment: PlaySegment, answer: ExtractAnswer | null, next: PlaySegment | null): YardsFacts {
    const offense = play.offense;
    const progress = (spot: StatsPlay["startSpot"]) => (spot && offense ? absoluteSpot(spot, offense) : null);
    const gain = play.events.find((event) => event.yards !== null && event.yardsSource === "ledger");
    const nextStart = next?.spotBefore && offense ? spotProgress(next.spotBefore, offense) : null;
    return {
      playType: answer?.playType ?? (play.playType === "run" ? "rush" : play.playType === "sack" ? "sack" : play.events.some((event) => event.action === "pass_incomplete") ? "pass_incomplete" : play.playType === "pass" ? "pass_complete" : "not_a_play"),
      yardsSaid: answer?.yardsSaid ?? null,
      lines: segment.lines.map((line) => line.text),
      dd: segment.ddBefore ? { down: segment.ddBefore.down, distance: segment.ddBefore.distance, isGoal: segment.ddBefore.isGoal } : null,
      nextDd: next?.ddBefore ? { down: next.ddBefore.down, distance: next.ddBefore.distance, isGoal: next.ddBefore.isGoal } : null,
      startSpot: progress(play.startSpot),
      endSpot: progress(play.endSpot),
      nextStart,
      penalty: answer?.penalty ?? (play.penalty && play.penalty.on !== "none" ? (play.penalty.on === "unknown" ? "unclear" : play.penalty.on) : "none"),
      penaltyYards: play.penalty?.penaltyYards ?? null,
      ledger: gain?.yards ?? null,
      touchdown: play.touchdown,
    };
  }

  /** The next segment's facts, or what the segment's own post lines say: the call that closed it is the next down and distance. */
  private nextFacts(segment: PlaySegment, next: PlaySegment | null): PlaySegment | null {
    if (next?.ddBefore) return next;
    const call = segment.postLines.find((line) => line.dd !== null);
    if (!call?.dd) return next;
    const spot = call.spots.find((entry) => entry.kind === "at" || entry.kind === "start") ?? null;
    return { ...segment, ddBefore: call.dd, spotBefore: spot };
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
    const reason = `yards from the ${solution.method === "dd" ? "next down and distance" : solution.method === "spots" ? "yard lines" : solution.method === "stated" ? "words of the play" : solution.method}${solution.agree ? "" : " (another method disagrees)"}`;
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
    if (this.secondLooks >= V7_SECOND_LOOKS_PER_GAME || this.overBudget()) return;
    const credited = [answer.carrierIdx, answer.passerIdx, answer.receiverIdx].some((idx) => idx !== null && idx !== 0);
    if (credited) return;
    if (!candidates.some((candidate) => candidate.playerId !== null && candidate.score >= V7_SECOND_LOOK_MIN_SCORE)) return;
    this.secondLooked.add(job.segment.id);
    this.secondLooks += 1;
    this.queue.unshift({ segment: job.segment, look: "second", rule: "R38" });
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
      this.queue.push({ segment: held.segment, look: "reread", current: held.answer, playId, rule: "R39" });
      queued += 1;
    }
    if (queued > 0) this.driveRereads += 1;
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
    // The name check: every credited index is a named candidate, or the quarterback prior for the passer.
    for (const [field, idx] of [["carrier", answer.carrierIdx], ["passer", answer.passerIdx], ["receiver", answer.receiverIdx], ["tackler", answer.tacklerIdx]] as const) {
      if (idx === null || idx === 0) continue;
      const candidate = candidateAt(candidates, idx);
      if (!candidate) return refuse(`${field} index ${idx} is not on the list`);
      const named = candidate.score >= CANDIDATE_MIN_SCORE || (field === "passer" && candidate.tags.includes("prior:qb"));
      if (!named) return refuse(`${field} ${candidate.label} is not named in the lines`);
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
      const lines = this.gapLines(gap);
      if (!lines) continue;
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
        preLines: [],
        postLines: [],
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

  /** The parsed lines between the two plays of a gap, with a margin each side, at most V7_MAX_GAP_LINES. */
  private gapLines(gap: LedgerGap): ParsedLine[] | null {
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
    const seqFrom = Math.max(0, from - V7_GAP_MARGIN_LINES);
    const seqTo = Math.min(to + V7_GAP_MARGIN_LINES, seqFrom + V7_MAX_GAP_LINES - 1);
    const lines: ParsedLine[] = [];
    for (let seq = seqFrom; seq <= seqTo; seq++) {
      const line = this.lines.get(seq);
      if (line) lines.push(line);
    }
    return lines.length > 0 && segmentNameHits({ lines, postLines: [] }).length + lines.filter((line) => line.cues.any).length > 0 ? lines : null;
  }
}
