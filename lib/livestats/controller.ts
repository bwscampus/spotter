import type { CardLines } from "@/lib/cards/lines";
import { confidenceBucket, type EventName, type EventProps } from "@/lib/analytics/events";
import { NO_STATS_COUNTS, type LiveStatsBridge, type StatsChange, type StatsCounts } from "@/lib/game/statsBridge";
import { gapsBetween, type HeardGap } from "@/lib/log/gaps";
import type { StatsRecord } from "@/lib/log/statsLog";
import type { Utterance } from "@/lib/plays/storage";
import type { PlayUtterance } from "@/lib/plays/types";
import { advanceWatermark, isPlayBoundary, NO_WATERMARK, readingPlan, shouldAsk, type ReadingPlan } from "@/lib/plays/window";
import { isPlayTalk, rosterNames } from "./playTalk";
import { chipText } from "./describe";
import {
  correctPlay,
  discardPlay,
  EMPTY_SESSION,
  freshReads,
  linesOf,
  okPlay,
  readPlays,
  saysLoss,
  recentPlays,
  remapSession,
  restoreFromLog,
  undoLast,
  watermarkOf,
  type Correction,
  type SessionPlay,
  type StatsSession,
  type Step,
} from "./session";
import type { ExtractStatsRequest, StatsPlay, StatsRosterPlayer, StatsUsage } from "./types";
import { validatePlays } from "./validate";

// =============================================================================
// The live stats loop for one game (docs/V3_DEFINITION.md 8.1, 8.6 and 8.8).
//
// It asks Claude at a down-and-distance call or every minute, never within 10
// seconds (lib/plays/window.ts), and only once something since the last call
// sounds like football (playTalk.ts), one call at a time, and puts every new play in
// line for the announcer. After five failures in a row it stops until the
// switch is turned off and on again, or, with retryAfterStopMs, until that long
// has passed. With autoOk, nothing waits in line: every play is OK'd as it is
// read.
//
// A plain class with everything it touches handed in (the network, the log,
// analytics, the clock), so the whole loop can be tested without a browser or
// a network, and so this folder never reaches the card path. It never touches
// a card: it says what the lines are and when they changed, and the live
// screen decides what to do with that (G3).
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Failures in a row before the loop stops and says so (spec 8.8). */
export const MAX_FAILURES = 5;

/** How many plays already read go with each call, so Claude does not read them again (spec 8.1). */
export const RECENT_PLAYS = 5;

/**
 * End game waits this long for the last read of what was said since the last
 * call, then ends the game anyway and says so in the log. About the reader's
 * usual time for a window (Gemini takes about 5 s, now and then 14). A backlog
 * read in several windows gets this long for each.
 */
export const LAST_READ_TIMEOUT_MS = 10_000;

/** The code the log carries when the last read at End game did not finish. */
export const LAST_READ_UNFINISHED = "last_read_unfinished";

/**
 * Most windows one catch-up reads, one call at a time, oldest first, when
 * more than one window of lines has built up (lib/plays/window.ts
 * readingPlan; audit M9). Four is about 108 lines, several minutes of talk.
 */
export const MAX_CATCH_UP_WINDOWS = 4;

/** The code the log carries when a backlog was longer than MAX_CATCH_UP_WINDOWS and its oldest lines went unread. */
export const SKIPPED_LINES = "skipped_lines";

/**
 * The code the log and the strip carry when a reply came back but reading it
 * in threw (audit L5). The window stays unread and goes again next call.
 * Analytics, which take only declared codes, get "bad_response".
 */
export const APPLY_FAILED = "apply_failed";

// =============================================================================

/** What the loop is doing, for the strip. */
export type StatsLoopState =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "no_roster" }
  | { kind: "listening" }
  | { kind: "reading" }
  | { kind: "paused"; code: string }
  /** `retrying`: it tries again on its own once a while has passed, rather than waiting for the switch. */
  | { kind: "stopped"; code: string; retrying: boolean };

export interface StatsView {
  session: StatsSession;
  loop: StatsLoopState;
  on: boolean;
  roster: StatsRosterPlayer[];
  /** Every play counts the moment it is read (the default since Oct 8), rather than waiting for an OK. */
  autoOk: boolean;
  /** Stretches of over a minute with nothing heard (lib/log/gaps.ts), so the strip can say the totals are incomplete. */
  gaps: HeardGap[];
  /** Plays that went backwards (saysLoss in session.ts), by playId: a yardage typed on one with no sign is a loss. */
  lossPlays?: ReadonlySet<string>;
}

export type ExtractReply = { ok: true; plays: unknown; usage: StatsUsage } | { ok: false; code: string };

export interface ControllerDeps {
  /** POST /api/livestats/extract. Never throws: a failure comes back as its code. */
  extract(request: ExtractStatsRequest): Promise<ExtractReply>;
  /** Writes one record to this game's browser log. */
  log(record: StatsRecord): void;
  /** Reads this game's browser log, to pick up where a reload left off. */
  readLog(): Promise<readonly { kind: string }[]>;
  track(name: EventName, props: EventProps): void;
  now(): number;
}

export class StatsController {
  private readonly gameId: string;
  private startedAt: number | null;
  private readonly deps: ControllerDeps;
  private readonly autoOk: boolean;
  private readonly retryAfterStopMs: number | null;
  private roster: StatsRosterPlayer[];

  private session: StatsSession = EMPTY_SESSION;
  private utterances: Utterance[] = [];
  private firstAt: number | null = null;
  private watermark = NO_WATERMARK;
  /** The last line sent in a read that was applied, so a backlog is read once (readingPlan). */
  private readThrough = NO_WATERMARK;
  private lastCallAt = Number.NEGATIVE_INFINITY;
  private boundarySeen = false;
  /** Something since the last call sounded like football (playTalk.ts). Nothing else is worth a call. */
  private playTalkSeen = false;
  /** Both rosters' surnames, for playTalk. */
  private names: Set<string>;
  private inFlight = false;
  /** The call in flight, so End game can wait for it before the last read. */
  private inFlightCall: Promise<boolean> | null = null;
  /** End game has begun: no more calls of the loop's own. */
  private finishing = false;
  private failures = 0;
  private lastFailure: string | null = null;
  private on = true;
  private counts: StatsCounts = NO_STATS_COUNTS;

  private restored = false;
  private restoring = false;
  private disposed = false;
  private buffered: Array<[string, number]> = [];

  private view: StatsView;
  private readonly viewListeners = new Set<() => void>();
  private readonly lineListeners = new Set<(change: StatsChange) => void>();

  /** What the live screen gets (lib/game/statsBridge.ts). Stable for the controller's life. */
  readonly bridge: LiveStatsBridge;

  /**
   * `startedAt` is when the game was built, for the minute stats.toggled
   * reports; null starts the clock at start().
   *
   * `autoOk` counts every play the moment it is read, as if Enter had been
   * pressed on it: the live screen's default since Oct 8, unless the
   * announcer asked at setup to check each play (the snapshot's `statsAuto`).
   * `retryAfterStopMs` lets a loop stopped by MAX_FAILURES try again on its
   * own after that long, for an unattended test game; the live screen leaves
   * it off (RETRY_AFTER_STOP_MS in components/livestats/useLiveStats.ts).
   */
  constructor(options: {
    gameId: string;
    startedAt: number | null;
    roster: StatsRosterPlayer[];
    deps: ControllerDeps;
    autoOk?: boolean;
    retryAfterStopMs?: number | null;
  }) {
    this.gameId = options.gameId;
    this.startedAt = options.startedAt;
    this.roster = options.roster;
    this.names = rosterNames(options.roster);
    this.deps = options.deps;
    this.autoOk = options.autoOk ?? false;
    this.retryAfterStopMs = options.retryAfterStopMs ?? null;
    this.view = this.makeView();
    this.bridge = {
      heard: (text, at) => this.heard(text, at),
      lines: () => this.lines(),
      subscribe: (listener) => {
        this.lineListeners.add(listener);
        return () => this.lineListeners.delete(listener);
      },
      key: (action) => {
        if (action === "ok") this.ok();
        else if (action === "discard") this.discard();
        else this.undo();
      },
      keysLive: () => true,
      counts: () => this.counts,
      finish: () => this.finish(),
    };
  }

  // ---------------------------------------------------------------------------
  // React reads the view through useSyncExternalStore.
  // ---------------------------------------------------------------------------

  readonly subscribe = (listener: () => void) => {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  };

  readonly getView = () => this.view;

  // ---------------------------------------------------------------------------
  // Life.
  // ---------------------------------------------------------------------------

  /** Reads the log so a reload picks up the line, the decisions and the switch where they were. */
  async start() {
    this.disposed = false;
    this.startedAt ??= this.deps.now();
    if (this.restored || this.restoring) return;
    this.restoring = true;
    let records: readonly { kind: string }[] = [];
    try {
      records = await this.deps.readLog();
    } catch {
      // No log to read is a game with no stats yet.
    }
    this.restoring = false;
    if (this.disposed) return;

    const restored = restoreFromLog(records);
    // The rosters this game has had, from its game records, so a stat earned under a name or number
    // a refresh later fixed goes to the player it became.
    this.session = remapSession(restored.session, this.roster, rostersInLog(records));
    this.on = restored.on;
    this.counts = {
      playsApplied: restored.playsApplied,
      playsUndone: restored.playsUndone,
      offMidGame: restored.offMidGame,
      tokensIn: restored.tokensIn,
      tokensOut: restored.tokensOut,
      tokensCached: restored.tokensCached,
    };
    this.utterances = [];
    this.firstAt = null;
    for (const said of restored.utterances) this.append(said.text, said.at);
    // What the log held was asked about before the reload; only what is said from here is new.
    this.boundarySeen = false;
    this.playTalkSeen = false;
    this.watermark = watermarkOf(this.session, NO_WATERMARK);
    this.readThrough = this.watermark;
    this.restored = true;

    // Whatever was said while the log was being read, in the order it was said.
    const buffered = this.buffered;
    this.buffered = [];
    for (const [text, at] of buffered) this.append(text, at);

    this.emit();
    this.changed(new Map());

    // A play read just before a reload, whose OK never reached the log. One
    // taken back with U has been answered, so it stays waiting.
    if (this.autoOk) {
      for (const play of this.session.plays) {
        if (play.status === "pending" && play.decidedAt === null) this.ok(play.playId);
      }
    }
  }

  dispose() {
    this.disposed = true;
  }

  setRoster(roster: StatsRosterPlayer[]) {
    if (roster === this.roster) return;
    // Tonight stays with the player when a refresh fixes their name or number (Jed, Oct 5).
    this.session = remapSession(this.session, roster, [this.roster]);
    this.roster = roster;
    this.names = rosterNames(roster);
    this.emit();
    this.changed(new Map());
  }

  // ---------------------------------------------------------------------------
  // What was said, and when to ask.
  // ---------------------------------------------------------------------------

  heard(text: string, at: number) {
    // Numbered exactly as a reload and the replay number the log: blank finals are not utterances.
    if (this.disposed || text.trim().length === 0) return;
    if (!this.restored) {
      this.buffered.push([text, at]);
      return;
    }
    this.append(text, at);
    this.tick();
  }

  private append(text: string, at: number) {
    this.firstAt ??= at;
    const last = this.utterances.at(-1);
    // A clock that only moves forward, whatever the wall clock does.
    const offsetMs = Math.max(last?.offsetMs ?? 0, at - this.firstAt);
    this.utterances.push({ seq: this.utterances.length, text, at: new Date(at).toISOString(), offsetMs, connectionId: 1 });
    if (isPlayBoundary(text)) this.boundarySeen = true;
    if (isPlayTalk(text, this.names)) this.playTalkSeen = true;
  }

  /** Asks if it is time. Called on every final and on a timer for the one minute cadence. */
  tick() {
    if (!this.ready() || this.inFlight || this.finishing) return;
    const now = this.deps.now();
    if (this.failures >= MAX_FAILURES) {
      // Stopped. Without retryAfterStopMs, until the switch goes off and on.
      if (this.retryAfterStopMs === null || now - this.lastCallAt < this.retryAfterStopMs) return;
    }
    if (!shouldAsk({ now, lastCallAt: this.lastCallAt, boundarySeen: this.boundarySeen, worthReading: this.playTalkSeen })) return;
    this.call(now);
  }

  /** Resolves true when every window of the catch-up was read and applied. */
  private call(now: number): Promise<boolean> {
    const call = this.ask(now).finally(() => {
      if (this.inFlightCall === call) this.inFlightCall = null;
    });
    this.inFlightCall = call;
    return call;
  }

  /**
   * End game: one last read of whatever was said since the last call, applied
   * (and, with autoOk, counted) before the game closes and before any export
   * is built (Oct 6: both audited games ended on a field goal that was never
   * read). Waits for a call already in flight first. If it fails, or takes
   * more than `timeoutMs`, the game ends anyway and the log says the last
   * read did not finish. Resolves either way; never throws.
   */
  async finish(timeoutMs: number = LAST_READ_TIMEOUT_MS): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    if (!this.ready()) return;
    // A backlog is read in several windows, one call each, and each gets the budget.
    const windows = this.plan().windows.length;
    const work = (async (): Promise<"done" | "nothing" | "failed"> => {
      if (this.inFlightCall) await this.inFlightCall;
      if (this.disposed) return "nothing";
      const lastSeq = this.utterances.at(-1)?.seq ?? NO_WATERMARK;
      if (lastSeq <= this.watermark) return "nothing";
      return (await this.call(this.deps.now())) ? "done" : "failed";
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), timeoutMs * Math.max(1, windows));
    });
    const outcome = await Promise.race([work, late]);
    clearTimeout(timer);
    // A reply that comes back after this is not applied: the log says the last read did not finish.
    if (outcome === "late") this.disposed = true;
    if (outcome === "failed" || outcome === "late") {
      this.deps.log({ kind: "stats_reply", gameId: this.gameId, at: this.deps.now(), ok: false, code: LAST_READ_UNFINISHED });
    }
  }

  private ready(): boolean {
    return (
      this.restored &&
      !this.disposed &&
      this.on &&
      this.roster.length > 0
    );
  }

  private plan(): ReadingPlan {
    return readingPlan(this.utterances, this.watermark, this.readThrough, MAX_CATCH_UP_WINDOWS);
  }

  /**
   * One catch-up: the lines past what has been read, in one window, or, when
   * more than a window has built up, in up to MAX_CATCH_UP_WINDOWS windows,
   * oldest first, one call at a time, each applied before the next is sent
   * (audit M9). A backlog longer than that loses its oldest lines, and the log
   * says how many. A failure stops the catch-up where it is; what was applied
   * stays applied, and the rest goes again next call. Never throws (L5).
   * True when every window was read and applied.
   */
  private async ask(now: number): Promise<boolean> {
    this.inFlight = true;
    this.lastCallAt = now;
    this.boundarySeen = false;
    this.playTalkSeen = false;
    try {
      const plan = this.plan();
      if (plan.skipped > 0 && plan.skippedThrough !== null) {
        this.deps.log({
          kind: "stats_reply",
          gameId: this.gameId,
          at: this.deps.now(),
          ok: false,
          code: SKIPPED_LINES,
          skipped: plan.skipped,
          seqFrom: plan.skippedThrough - plan.skipped + 1,
          seqTo: plan.skippedThrough,
        });
        // Said once: the next plan starts after them.
        this.readThrough = Math.max(this.readThrough, plan.skippedThrough);
      }
      for (const window of plan.windows) {
        if (!(await this.readWindow(window))) return false;
      }
      return true;
    } catch {
      // Nothing above should throw; if it does, the loop pauses rather than dies.
      this.failed(APPLY_FAILED);
      return false;
    } finally {
      this.inFlight = false;
      if (!this.disposed) this.emit();
    }
  }

  /** A failed call or read, through the one failure path: "stats paused", and after MAX_FAILURES, stopped. */
  private failed(code: string, seqFrom?: number, seqTo?: number) {
    if (this.disposed) return;
    this.failures += 1;
    this.lastFailure = code;
    this.deps.log({ kind: "stats_reply", gameId: this.gameId, at: this.deps.now(), ok: false, code, seqFrom, seqTo });
    this.deps.track("stats.call_failed", { code: code === APPLY_FAILED ? "bad_response" : code });
  }

  /** One window: asked, checked, applied. True when it was applied and the catch-up can go on. */
  private async readWindow(window: PlayUtterance[]): Promise<boolean> {
    const request: ExtractStatsRequest = {
      utterances: window,
      // The route needs who can be credited, not their season numbers.
      rosters: this.roster.map((player) => ({
        playerId: player.playerId,
        side: player.side,
        jersey: player.jersey,
        first: player.first,
        last: player.last,
        position: player.position,
        // "Heard as" forms ride along, so the reader knows "fafitaga" is this player.
        ...(player.aliases?.length ? { aliases: player.aliases } : {}),
      })),
      recentPlays: recentPlays(this.session, RECENT_PLAYS),
    };
    this.emit();

    const reply = await this.deps.extract(request);
    if (this.disposed) return false;
    const at = this.deps.now();
    const seqFrom = window[0]?.seq;
    const seqTo = window.at(-1)?.seq;

    if (!reply.ok) {
      this.failed(reply.code, seqFrom, seqTo);
      return false;
    }

    const tokensIn = reply.usage.inputTokens + reply.usage.cacheWriteTokens + reply.usage.cacheReadTokens;
    this.counts = {
      ...this.counts,
      tokensIn: this.counts.tokensIn + tokensIn,
      tokensOut: this.counts.tokensOut + reply.usage.outputTokens,
      tokensCached: this.counts.tokensCached + reply.usage.cacheReadTokens,
    };

    let plays: StatsPlay[];
    let read: ReturnType<typeof readPlays>;
    let watermark: number;
    try {
      // The route checked these already. They are checked again here because the
      // browser trusts nothing it is sent either.
      plays = validatePlays({ plays: reply.plays }, { utterances: window });
      // A later read of a play already applied comes through, by its id or by
      // its lines; everything else dedupes on seqEnd as always.
      const recentIds = new Set(request.recentPlays.map((play) => play.playId));
      const fresh = freshReads(plays, this.session, this.watermark, recentIds);
      watermark = advanceWatermark(this.watermark, plays);
      // The name check reads a few lines past a play, but none the reader has not seen.
      read = readPlays(this.session, fresh, this.roster, at, { utterances: this.utterances, ...(seqTo !== undefined ? { readThrough: seqTo } : {}) });
    } catch {
      // The reply came back but could not be read in: nothing moves, so the
      // same lines go again next call (audit L5).
      this.failed(APPLY_FAILED, seqFrom, seqTo);
      return false;
    }

    // Applied: only now does reading move on.
    const { session, added, updated } = read;
    this.session = session;
    this.watermark = watermark;
    if (seqTo !== undefined) this.readThrough = Math.max(this.readThrough, seqTo);
    this.failures = 0;
    this.lastFailure = null;

    this.deps.log({
      kind: "stats_reply",
      gameId: this.gameId,
      at,
      ok: true,
      plays,
      seqFrom,
      seqTo,
      tokensIn,
      tokensOut: reply.usage.outputTokens,
      tokensCached: reply.usage.cacheReadTokens,
    });
    for (const play of added) {
      this.deps.log({
        kind: "stats_play",
        gameId: this.gameId,
        at,
        playId: play.playId,
        play: play.play,
        changes: play.changes,
        dropped: play.dropped,
      });
    }
    for (const play of updated) {
      this.deps.log({
        kind: "stats_update",
        gameId: this.gameId,
        at,
        playId: play.playId,
        play: play.play,
        changes: play.changes,
        dropped: play.dropped,
      });
    }
    this.emit();
    // A counted play that just gained yards or a tackler: the cards follow it.
    if (updated.some((play) => play.status === "applied")) this.changed(new Map());
    // Counted straight away, through the same OK as Enter, so the log, the
    // analytics and the cards see exactly what a pressed key would give them.
    if (this.autoOk) for (const play of added) this.ok(play.playId);
    return true;
  }

  // ---------------------------------------------------------------------------
  // The announcer.
  // ---------------------------------------------------------------------------

  /** Enter or OK: the play counts. */
  ok(playId?: string) {
    const at = this.deps.now();
    const step = okPlay(this.session, at, playId);
    if (!this.take(step, "ok")) return;
    const play = step.play!;
    this.counts = { ...this.counts, playsApplied: this.counts.playsApplied + 1 };
    this.deps.track("stats.play_applied", appliedProps(play, at));
    this.emit();
    this.changed(chipsFor(play));
  }

  /** Backspace or Discard: the play counts for nothing. */
  discard(playId?: string) {
    const at = this.deps.now();
    const step = discardPlay(this.session, at, playId);
    if (!this.take(step, "discard")) return;
    const play = step.play!;
    this.deps.track("stats.play_discarded", {
      play_type: play.play.playType,
      events: play.changes.length,
      confidence_bucket: confidenceBucket(play.play.confidence),
      seconds_pending: Math.round((at - play.readAt) / 1000),
    });
    this.emit();
  }

  /** U: the last OK'd play stops counting and goes back in line. */
  undo() {
    const at = this.deps.now();
    const before = this.session;
    const step = undoLast(this.session, at);
    if (!this.take(step, "undo")) return;
    const play = step.play!;
    const appliedAt = before.plays.find((each) => each.playId === play.playId)?.decidedAt ?? at;
    this.counts = { ...this.counts, playsUndone: this.counts.playsUndone + 1 };
    this.deps.track("stats.play_undone", {
      play_type: play.play.playType,
      actions: play.changes.length,
      seconds_since_applied: Math.round((at - appliedAt) / 1000),
    });
    this.emit();
    this.changed(new Map());
  }

  /** A click on a name, a stat or an amount. */
  correct(playId: string, correction: Correction) {
    const step = correctPlay(this.session, playId, correction);
    if (!this.take(step, "edit")) return;
    this.emit();
    if (step.play!.status === "applied") this.changed(new Map());
  }

  /** The Stats on and off button. Off stops the calls; what is in line and what counted stay. */
  setOn(on: boolean) {
    if (on === this.on) return;
    const at = this.deps.now();
    this.on = on;
    if (!on) this.counts = { ...this.counts, offMidGame: true };
    // Turning it back on is the announcer saying try again.
    else this.failures = 0;
    this.deps.log({ kind: "stats_switch", gameId: this.gameId, at, on });
    this.deps.track("stats.toggled", {
      state: on ? "on" : "off",
      minute: Math.max(0, Math.round((at - (this.startedAt ?? at)) / 60_000)),
    });
    this.emit();
  }

  private take(step: Step, decision: "ok" | "discard" | "undo" | "edit"): boolean {
    if (!step.play || this.disposed) return false;
    this.session = step.session;
    this.deps.log({
      kind: "stats_decision",
      gameId: this.gameId,
      at: this.deps.now(),
      playId: step.play.playId,
      decision,
      ...(decision === "edit" ? { changes: step.play.changes, ...(step.play.edits ? { edits: step.play.edits } : {}) } : {}),
    });
    return true;
  }

  // ---------------------------------------------------------------------------
  // What it adds up to.
  // ---------------------------------------------------------------------------

  /** Each player's card lines with tonight in them, by playerId. */
  lines(): ReadonlyMap<string, CardLines> {
    return linesOf(this.session, this.roster);
  }

  private changed(chips: ReadonlyMap<string, string>) {
    for (const listener of this.lineListeners) listener({ chips });
  }

  private emit() {
    this.view = this.makeView();
    for (const listener of this.viewListeners) listener();
  }

  private makeView(): StatsView {
    return {
      session: this.session,
      loop: this.loopState(),
      on: this.on,
      roster: this.roster,
      autoOk: this.autoOk,
      gaps: gapsBetween(this.utterances.map((utterance) => Date.parse(utterance.at))),
      lossPlays: this.lossPlays(),
    };
  }

  /** Whether each play went backwards, from its summary and its own lines; a play's answer is kept until its lines change. */
  private readonly lossCache = new Map<string, boolean>();
  private lossPlays(): ReadonlySet<string> {
    const plays = new Set<string>();
    for (const entry of this.session.plays) {
      const key = `${entry.playId}|${entry.play.seqStart}|${entry.play.seqEnd}|${entry.play.playType}|${entry.play.summary}`;
      let loss = this.lossCache.get(key);
      if (loss === undefined) {
        const lines = this.utterances
          .slice(Math.max(0, entry.play.seqStart), entry.play.seqEnd + 1)
          .filter((utterance) => utterance.seq >= entry.play.seqStart && utterance.seq <= entry.play.seqEnd)
          .map((utterance) => utterance.text)
          .join(" ");
        loss = saysLoss(entry.play, lines || undefined);
        this.lossCache.set(key, loss);
      }
      if (loss) plays.add(entry.playId);
    }
    return plays;
  }

  private loopState(): StatsLoopState {
    if (!this.restored) return { kind: "loading" };
    if (this.roster.length === 0) return { kind: "no_roster" };
    if (!this.on) return { kind: "off" };
    if (this.failures >= MAX_FAILURES) {
      return { kind: "stopped", code: this.lastFailure ?? "unknown", retrying: this.retryAfterStopMs !== null };
    }
    if (this.inFlight) return { kind: "reading" };
    if (this.lastFailure) return { kind: "paused", code: this.lastFailure };
    return { kind: "listening" };
  }
}

/** For the cards already up: each player's part of the play just OK'd. */
function chipsFor(play: SessionPlay): Map<string, string> {
  const byPlayer = new Map<string, SessionPlay["changes"]>();
  for (const change of play.changes) byPlayer.set(change.playerId, [...(byPlayer.get(change.playerId) ?? []), change]);
  const chips = new Map<string, string>();
  for (const [playerId, changes] of byPlayer) {
    const text = chipText(changes);
    if (text) chips.set(playerId, text);
  }
  return chips;
}

/**
 * stats.play_applied, under the property names admin.metrics_stats reads
 * (docs/METRICS.md): play_type, events and dropped_<rule>. Codes and counts.
 */
export function appliedProps(play: SessionPlay, at: number): EventProps {
  const props: EventProps = {
    play_type: play.play.playType,
    events: play.changes.length,
    confidence_bucket: confidenceBucket(play.play.confidence),
    corrected: play.edited,
    seconds_pending: Math.round((at - play.readAt) / 1000),
    yards_stated: 0,
    yards_spots: 0,
    yards_phrase: 0,
    yards_unknown: 0,
  };
  for (const event of play.play.events) {
    const key = event.yardsSource ? `yards_${event.yardsSource}` : null;
    if (key) props[key] = (props[key] as number) + 1;
  }
  props.yards_unknown = play.changes.filter((change) => change.amount === null).length;
  for (const drop of play.dropped) {
    const key = `dropped_${drop.rule.toLowerCase()}`;
    props[key] = ((props[key] as number | undefined) ?? 0) + 1;
  }
  return props;
}

/** The stats rosters the browser log's game records carry, oldest first: one at the start and another on every refresh. */
function rostersInLog(records: readonly { kind: string }[]): StatsRosterPlayer[][] {
  const rosters: StatsRosterPlayer[][] = [];
  for (const record of records) {
    if (record.kind !== "game") continue;
    const roster = (record as { snapshot?: { statsRoster?: unknown } }).snapshot?.statsRoster;
    if (Array.isArray(roster)) rosters.push(roster as StatsRosterPlayer[]);
  }
  return rosters;
}
