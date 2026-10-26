import type { CardLines } from "@/lib/cards/lines";
import { confidenceBucket, type EventName, type EventProps } from "@/lib/analytics/events";
import { NO_STATS_COUNTS, type LiveStatsBridge, type StatsChange, type StatsCounts } from "@/lib/game/statsBridge";
import { gapsBetween, type HeardGap } from "@/lib/log/gaps";
import type { StatsRecord } from "@/lib/log/statsLog";
import type { Utterance } from "@/lib/plays/storage";
import type { PlayUtterance } from "@/lib/plays/types";
import { advanceWatermark, isPlayBoundary, NO_WATERMARK, readingPlan, shouldAsk, type ReadingPlan } from "@/lib/plays/window";
import { creditsLine, driveWindow, drivesOf, newlyEnded, type Drive } from "./drives";
import { readerGameState } from "./gameStateBlock";
import { firstHalfEnd, HALFTIME_MIN_PLAYS, HALFTIME_QUIET_MS, HALFTIME_TIMEOUT, HALFTIME_TIMEOUT_MS, halftimeDue, halftimeSaid, secondHalfKickoff, secondHalfPlay } from "./halftime";
import type { LedgerGap } from "./ledger";
import { MAX_GAP_LINES, MAX_HALF_LINES, MAX_REREAD_LINES } from "./request";
import { boothText, type BoothLine } from "./statLines";
import { secondLookLines, SECOND_LOOKS_PER_GAME } from "./secondLook";
import { isPlayTalk, rosterNames } from "./playTalk";
import { chipText } from "./describe";
import {
  correctPlay,
  discardPlay,
  EMPTY_SESSION,
  freshReads,
  addInferredIncompletion,
  boothLinesOf,
  inferredIncompletion,
  ledgerGaps,
  linesOf,
  okPlay,
  readBoothLines,
  readPlays,
  saysLoss,
  recentPlays,
  remapSession,
  restoreFromLog,
  settleLedger,
  undoLast,
  watermarkOf,
  type Correction,
  type SessionPlay,
  type StatsSession,
  type Step,
} from "./session";
import type { ArbiterUse, BoothStatLine, ExtractStatsRequest, ReadLook, RuleId, StatsPlay, StatsRosterPlayer, StatsUsage, TeamWords } from "./types";
import { validatePlays, validateStatLines } from "./validate";
import type { SegmentRequest } from "./extract/request";
import type { SegmentReply } from "./extract/run";
import type { LiveStatsPipeline } from "./settings";
import { V7Reader, type V7Host } from "./v7";

export type { SegmentReply } from "./extract/run";

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

/**
 * How long a drive's re-read (Part 7) may take before the drive is left as it
 * was: the whole drive is a few hundred lines, so about four windows' worth.
 * A late reply is ignored.
 */
export const DRIVE_REREAD_TIMEOUT_MS = 20_000;

/** The code the log carries when a re-read did not come back in time. */
export const REREAD_TIMEOUT = "reread_timeout";

/**
 * Most booth re-reads (fix 6, Part 1, R42) in one game. A TV booth reads
 * about eight to twelve running totals a game, and only the ones whose count
 * the plays disagree with are re-read, each about the cost of a drive
 * re-read, so this caps the extra at about a tenth of a game's calls.
 */
export const BOOTH_REREADS_PER_GAME = 12;

/**
 * Most gap re-reads (fix 6, Part 3, R44) in one game. Eleven snaps were missed
 * on the audited broadcast; each re-read is about 40 lines, a seventh of a
 * drive re-read, so fifteen cost about two drive re-reads.
 */
export const GAP_REREADS_PER_GAME = 15;

/** Lines each side of a gap's own that go with it, so the snap is not cut off. */
export const GAP_MARGIN_LINES = 2;

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

/** Where the halftime check stands (Part 8), for the strip's one quiet line. */
export type HalftimeState = { state: "running" } | { state: "done"; changes: number } | { state: "failed"; code: string };

export interface StatsView {
  session: StatsSession;
  loop: StatsLoopState;
  on: boolean;
  /** The halftime check, once it has started; null until then. */
  halftime: HalftimeState | null;
  /** The booth's newest stat line that changed a total (fix 6, Part 1), as the strip says it; null until one has. */
  booth: { text: string; at: number } | null;
  roster: StatsRosterPlayer[];
  /** Every play counts the moment it is read (the default since Oct 8), rather than waiting for an OK. */
  autoOk: boolean;
  /** Stretches of over a minute with nothing heard (lib/log/gaps.ts), so the strip can say the totals are incomplete. */
  gaps: HeardGap[];
  /** Plays that went backwards (saysLoss in session.ts), by playId: a yardage typed on one with no sign is a loss. */
  lossPlays?: ReadonlySet<string>;
}

export type ExtractReply = { ok: true; plays: unknown; statLines?: unknown; usage: StatsUsage; arbiterUse?: ArbiterUse } | { ok: false; code: string };

export interface ControllerDeps {
  /** POST /api/livestats/extract. Never throws: a failure comes back as its code. */
  extract(request: ExtractStatsRequest): Promise<ExtractReply>;
  /** POST /api/livestats/segment (v7, Oct 20): one segment through the readers. Absent, the loop runs v6 whatever the pipeline says. */
  extractSegment?(request: SegmentRequest): Promise<SegmentReply>;
  /** POST /api/livestats/halftime (Part 8): the stronger model's one read of the first half. Absent, the check never runs. */
  halftime?(request: ExtractStatsRequest): Promise<ExtractReply>;
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
  /** Which engine reads the plays (lib/livestats/settings.ts): v6, the window reader, or v7, the staged pipeline in ./v7.ts. */
  readonly pipeline: LiveStatsPipeline;
  private readonly v7: V7Reader | null;
  /** Dollars spent on model calls this game, against maxCostUsd: past it the optional calls (second looks, re-reads, reader B) stop. */
  private spentUsd = 0;
  /** Two readers (Oct 26): the game's plays read by two readers and the ones that went to the arbiter. */
  private arbiterUse: ArbiterUse = { plays: 0, arbitrated: 0 };
  private readonly maxCostUsd: number | null;
  private readonly guessBack: boolean;
  private roster: StatsRosterPlayer[];
  /** The team names and the words that name them, for the game state block (Part 2). Null until the live screen hands them in. */
  private teams: TeamWords | null;
  /** Players marked out tonight (Part 3), by playerId. A credit to one is dropped (R35). */
  private out: ReadonlySet<string> = new Set();

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
  /** Second looks taken this game (Part 5), reloads included, against SECOND_LOOKS_PER_GAME. */
  private secondLooks = 0;
  /** Drive re-reads that ran this game (Part 7), reloads included. */
  private driveRereads = 0;
  /** Booth re-reads (fix 6, Part 1, R42): how many ran, which lines were re-read, the ones waiting, and whether one is in flight (one at a time). */
  private boothRereads = 0;
  private readonly boothSeen = new Set<string>();
  private boothQueue: BoothLine[] = [];
  private boothInFlight = false;
  /** The strip's booth line. */
  private booth: StatsView["booth"] = null;
  /** Gap re-reads (fix 6, Part 3, R44): how many ran, which gaps (by their lines) were looked at, and the incompletions inferred (R45). */
  private gapRereads = 0;
  private gapFills = 0;
  private readonly gapsSeen = new Set<string>();
  /** Re-reads in flight (Part 7, Part 8): never block the loop; idle() waits for them. */
  private readonly background = new Set<Promise<void>>();
  /** Drives already re-read, by the id of the play that ended them, so a drive is re-read once. */
  private readonly rereadDrives = new Set<string>();
  /** The halftime check (Part 8): where it stands, whether it has run (once a game), and what the transcript said. */
  private halftime: HalftimeState | null = null;
  private halftimeRan = false;
  /** The line that said halftime, when one has. */
  private halftimeLine: number | null = null;
  /** When something like football was last said, for the quiet trigger. */
  private lastPlayTalkAt = Number.NEGATIVE_INFINITY;
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
    teams?: TeamWords | null;
    /** v6 unless told v7 (and given deps.extractSegment). */
    pipeline?: LiveStatsPipeline;
    /** The most this game may spend on model calls; null for no cap. */
    maxCostUsd?: number | null;
    /** v7, Part 7: let the dominant back take an unnamed rush. Off by default. */
    allowInferredRb?: boolean;
    /** v6, R51 (Oct 22): a run nobody was named for goes to tonight's leading rusher. Off by default; only the replay harness sets it. */
    guessBack?: boolean;
    /** v7: keep every request and its answer for the replay harness's plays file (never on the live screen). */
    recordDetail?: boolean;
  }) {
    this.gameId = options.gameId;
    this.startedAt = options.startedAt;
    this.roster = options.roster;
    this.teams = options.teams ?? null;
    this.names = rosterNames(options.roster);
    this.deps = options.deps;
    this.autoOk = options.autoOk ?? false;
    this.retryAfterStopMs = options.retryAfterStopMs ?? null;
    this.maxCostUsd = options.maxCostUsd ?? null;
    this.guessBack = options.guessBack ?? false;
    this.pipeline = options.pipeline === "v7" && options.deps.extractSegment ? "v7" : "v6";
    this.v7 = this.pipeline === "v7" ? new V7Reader(this.v7Host(), { maxCostUsd: this.maxCostUsd, allowInferredRb: options.allowInferredRb ?? false, recordDetail: options.recordDetail ?? false }) : null;
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
        else if (action === "halftime") this.halftimeCheck();
        else this.undo();
      },
      keysLive: () => true,
      counts: () => this.allCounts(),
      finish: () => this.finish(),
    };
  }

  /** What the v7 reader needs of this loop: the session, the log, the keys and the clock, never the cards. */
  private v7Host(): V7Host {
    return {
      gameId: this.gameId,
      roster: () => this.roster,
      teams: () => this.teams,
      out: () => this.out,
      utterances: () => this.utterances,
      session: () => this.session,
      setSession: (next) => {
        this.session = next;
      },
      log: (record) => this.deps.log(record),
      track: (name, props) => this.deps.track(name, props),
      now: () => this.deps.now(),
      extractSegment: (request) => this.deps.extractSegment!(request),
      added: (play) => {
        this.emit();
        if (this.autoOk) this.ok(play.playId);
      },
      changed: () => {
        this.emit();
        this.changed(new Map());
      },
      noted: () => this.emit(),
      failed: (code, seqFrom, seqTo) => {
        this.failed(code, seqFrom, seqTo);
        if (!this.disposed) this.emit();
      },
      succeeded: () => {
        this.failures = 0;
        this.lastFailure = null;
        if (!this.disposed) this.emit();
      },
      addUsage: (usage) => this.spend(usage),
      disposed: () => this.disposed,
    };
  }

  /** Two readers (Oct 26): what a read added to the game's count for the arbiter's cost guard. */
  private countArbiter(added: ArbiterUse | undefined) {
    if (!added) return;
    this.arbiterUse = { plays: this.arbiterUse.plays + added.plays, arbitrated: this.arbiterUse.arbitrated + added.arbitrated };
  }

  /** One call's usage into the counts and the spend. */
  private spend(usage: StatsUsage) {
    this.spentUsd += usage.costUsd;
    this.counts = {
      ...this.counts,
      tokensIn: this.counts.tokensIn + usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens,
      tokensOut: this.counts.tokensOut + usage.outputTokens,
      tokensCached: this.counts.tokensCached + usage.cacheReadTokens,
      costUsd: Math.round((this.counts.costUsd ?? 0) * 1e6 + usage.costUsd * 1e6) / 1e6,
    };
  }

  /** Past the cap: no optional call (a second look, a re-read, reader B). */
  private overBudget(): boolean {
    return this.maxCostUsd !== null && this.spentUsd >= this.maxCostUsd;
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
    // The snapshot (setOut, already called) says who is out now; the log says
    // what the last read knew. When they differ, the log catches up.
    if (!sameIds(restored.out, this.out)) this.deps.log({ kind: "stats_out", gameId: this.gameId, at: this.deps.now(), playerIds: [...this.out].sort() });
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
      secondLooks: restored.secondLooks,
      driveRereads: restored.driveRereads,
      boothLines: boothLinesOf(restored.session).length,
      boothRereads: restored.boothRereads,
      gapRereads: restored.gapRereads,
      gapFills: restored.gapFills,
    };
    this.secondLooks = restored.secondLooks;
    this.driveRereads = restored.driveRereads;
    this.boothRereads = restored.boothRereads;
    this.gapRereads = restored.gapRereads;
    this.gapFills = restored.gapFills;
    for (const key of restored.gapsSeen) this.gapsSeen.add(key);
    // Every booth line already read was re-read then, or never will be.
    for (const line of boothLinesOf(restored.session)) this.boothSeen.add(`${line.playerId}|${line.seq}`);
    if (restored.booth) {
      const text = boothText(restored.booth, this.roster);
      if (text) this.booth = { text, at: this.deps.now() };
    }
    if (restored.halftime) {
      this.halftimeRan = true;
      this.halftime = restored.halftime;
      this.counts = { ...this.counts, halftimeChanges: restored.halftime.state === "done" ? restored.halftime.changes : -1 };
    }
    // The drives that had ended by the reload were re-read then, or never will be.
    for (const drive of drivesOf(this.session.plays, this.sideOf())) {
      if (drive.endedBy !== null) this.rereadDrives.add(drive.plays[drive.plays.length - 1].playId);
    }
    this.utterances = [];
    this.firstAt = null;
    this.v7?.restoreBegin();
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
    this.v7?.restoreEnd(this.session, { secondLooks: restored.secondLooks, driveRereads: restored.driveRereads, gapRereads: restored.gapRereads });

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

  /**
   * Resolves once nothing is in flight: for a harness that drives the loop with
   * its own clock (lib/livestats/liveReplay.ts) and must let each call land
   * before the next line is said.
   */
  async idle(): Promise<void> {
    while (this.inFlightCall || this.background.size > 0 || this.v7?.busy()) {
      if (this.inFlightCall) await this.inFlightCall.catch(() => undefined);
      for (const task of [...this.background]) await task.catch(() => undefined);
      const pending = this.v7?.pending();
      if (pending) await pending.catch(() => undefined);
      // The call's own continuation runs first.
      await Promise.resolve();
    }
  }

  /** The team names and cue words, for the game state block. A refresh hands them in again; nothing is re-read. */
  setTeams(teams: TeamWords | null) {
    this.teams = teams;
    this.v7?.setTeams(teams);
  }

  /**
   * Who is out tonight (Part 3), whole, from the snapshot. Logged each time it
   * changes, so a reload and the replay know who could be credited when.
   * Plays already counted are left as they are; the announcer can correct one.
   */
  setOut(ids: readonly string[]) {
    const next = new Set(ids);
    if (sameIds(next, this.out)) return;
    this.out = next;
    if (this.restored) this.deps.log({ kind: "stats_out", gameId: this.gameId, at: this.deps.now(), playerIds: [...next].sort() });
  }

  setRoster(roster: StatsRosterPlayer[]) {
    if (roster === this.roster) return;
    // Tonight stays with the player when a refresh fixes their name or number (Jed, Oct 5).
    this.session = remapSession(this.session, roster, [this.roster]);
    this.roster = roster;
    this.names = rosterNames(roster);
    this.v7?.setRoster(roster);
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
    const seq = this.utterances.length;
    this.utterances.push({ seq, text, at: new Date(at).toISOString(), offsetMs, connectionId: 1 });
    // v7: parsed and segmented now, synchronously; a segment that closes is read on the next turn of the loop.
    this.v7?.heard(seq, text, at);
    if (isPlayBoundary(text)) this.boundarySeen = true;
    if (isPlayTalk(text, this.names)) {
      this.playTalkSeen = true;
      this.lastPlayTalkAt = at;
    }
    // Halftime said (Part 8), once enough of a half has been counted for the word to mean the break.
    if (this.restored && this.halftimeLine === null && halftimeSaid(text) && this.countedPlays() >= HALFTIME_MIN_PLAYS && this.lastQuarter() !== 1) {
      this.halftimeLine = seq;
    }
  }

  /** A play's own lines, joined, for the words a trigger reads. */
  private linesOf(play: StatsPlay): string | undefined {
    const lines = this.utterances.filter((each) => each.seq >= play.seqStart && each.seq <= play.seqEnd).map((each) => each.text);
    return lines.length > 0 ? lines.join(" ") : undefined;
  }

  /** Plays counted so far, for the halftime guard. */
  private countedPlays(): number {
    return this.session.plays.filter((play) => play.status === "applied").length;
  }

  /** The quarter of the last counted play that had one, or null. */
  private lastQuarter(): number | null {
    for (let i = this.session.plays.length - 1; i >= 0; i--) {
      const play = this.session.plays[i];
      if (play.status === "discarded" || play.play.quarter === null) continue;
      return play.play.quarter;
    }
    return null;
  }

  /** Whether one of the halftime check's triggers has fired. */
  private halftimeIsDue(now: number): boolean {
    if (this.halftimeRan || !this.restored) return false;
    return halftimeDue({
      said: this.halftimeLine !== null,
      secondHalfPlay: this.session.plays.some((play) => play.status !== "discarded" && (secondHalfPlay(play.play) || secondHalfKickoff(play.play, this.linesOf(play.play)))),
      quietAfterSecondQuarter: this.lastQuarter() === 2 && Number.isFinite(this.lastPlayTalkAt) && now - this.lastPlayTalkAt >= HALFTIME_QUIET_MS,
    });
  }

  /** Asks if it is time. Called on every final and on a timer for the one minute cadence. */
  tick() {
    if (!this.ready() || this.finishing) return;
    const now = this.deps.now();
    if (this.halftimeIsDue(now)) this.halftimeCheck();
    if (this.v7) {
      // v7 asks per segment, not on a cadence: the segmenter's clock moves, and whatever closed is read.
      if (this.failures < MAX_FAILURES || (this.retryAfterStopMs !== null && now - this.lastCallAt >= this.retryAfterStopMs)) this.v7.tick(now);
      return;
    }
    if (this.inFlight) return;
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
    const windows = this.v7 ? 1 : this.plan().windows.length;
    const work = this.v7
      ? this.v7.finish(this.deps.now()).then((): "done" => "done")
      : (async (): Promise<"done" | "nothing" | "failed"> => {
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
    if (this.v7) this.lastCallAt = this.deps.now();
    this.deps.log({ kind: "stats_reply", gameId: this.gameId, at: this.deps.now(), ok: false, code, seqFrom, seqTo });
    this.deps.track("stats.call_failed", { code: code === APPLY_FAILED ? "bad_response" : code });
  }

  /**
   * One window: asked, checked, applied. True when it was applied and the
   * catch-up can go on. A first read that returns nothing may be followed by
   * one second look at the lines that sound like a play (Part 5).
   */
  private async readWindow(window: PlayUtterance[], look: ReadLook = "first"): Promise<boolean> {
    // The lines the reader had not seen before this window: the overlap was read already.
    const newFrom = this.readThrough + 1;
    const request: ExtractStatsRequest = {
      utterances: window,
      ...(look !== "first" ? { look } : {}),
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
      // Two readers (Oct 26): the game's count for the arbiter's cost guard, once there is one.
      ...(this.arbiterUse.plays > 0 ? { arbiterUse: { ...this.arbiterUse } } : {}),
      // What the code believes so far (Part 2), in the volatile part of the call.
      gameState: readerGameState(this.session.plays, this.roster, { teams: this.teams, out: this.out, utterances: this.utterances }),
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
    this.spend(reply.usage);
    this.countArbiter(reply.arbiterUse);

    let plays: StatsPlay[];
    let statLines: BoothStatLine[];
    let read: ReturnType<typeof readPlays>;
    let watermark: number;
    try {
      // The route checked these already. They are checked again here because the
      // browser trusts nothing it is sent either.
      plays = validatePlays({ plays: reply.plays }, { utterances: window });
      statLines = validateStatLines(reply.statLines, { utterances: window });
      // A later read of a play already applied comes through, by its id or by
      // its lines; everything else dedupes on seqEnd as always.
      const recentIds = new Set(request.recentPlays.map((play) => play.playId));
      const fresh = freshReads(plays, this.session, this.watermark, recentIds);
      watermark = advanceWatermark(this.watermark, plays);
      // The name check reads a few lines past a play, but none the reader has not seen.
      read = readPlays(this.session, fresh, this.roster, at, {
        utterances: this.utterances,
        out: this.out,
        teams: this.teams,
        ...(this.guessBack ? { guessBack: true } : {}),
        ...(seqTo !== undefined ? { readThrough: seqTo } : {}),
        ...(look === "second" ? { source: { rule: "R38", reason: "read on the second look at a quiet window" } } : {}),
      });
    } catch {
      // The reply came back but could not be read in: nothing moves, so the
      // same lines go again next call (audit L5).
      this.failed(APPLY_FAILED, seqFrom, seqTo);
      return false;
    }

    // Applied: only now does reading move on.
    const { session, added, updated } = read;
    const drivesBefore = drivesOf(this.session.plays, this.sideOf());
    this.session = session;
    this.watermark = watermark;
    if (seqTo !== undefined) this.readThrough = Math.max(this.readThrough, seqTo);
    this.failures = 0;
    this.lastFailure = null;
    // The end of a play the reader just returned is a play boundary too (Part
    // 6): the lines after it begin the next snap, so the next call goes at the
    // floor once more football has been said, not at the plain cadence.
    if (seqTo !== undefined && plays.some((play) => play.seqEnd < seqTo)) this.boundarySeen = true;

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
      ...(look !== "first" ? { look } : {}),
      ...(statLines.length > 0 ? { statLines } : {}),
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
    // The stat lines the booth read in these lines (fix 6, Part 1), after the
    // plays they follow have been counted, so what the plays had is what counts.
    const booth = this.applyBoothLines(statLines, at, seqTo);
    this.logBooth(booth, at);
    if (booth.accepted.length > 0) {
      this.emit();
      this.changed(new Map());
    }

    // A drive that ended in this read is read again whole, in the background (Part 7).
    for (const drive of newlyEnded(drivesBefore, drivesOf(this.session.plays, this.sideOf()))) this.rereadDrive(drive);
    // A booth line whose count the plays disagree with: the plays behind it are read again (fix 6, Part 1, R42).
    for (const line of booth.mismatched) this.rereadBooth(line);
    // A snap the downs say was missed: its few lines are read again (fix 6, Part 3, R44).
    this.rereadGaps();
    // A play in the second half: the first half is over (Part 8).
    if (this.halftimeIsDue(at)) this.halftimeCheck();

    // A quiet window whose new lines sound like a play: one second look at
    // just those lines, within the game's cap. Its reply is read like any other.
    if (look === "first" && plays.length === 0 && this.secondLooks < SECOND_LOOKS_PER_GAME && !this.overBudget()) {
      const again = secondLookLines(window, newFrom, this.roster);
      if (again) {
        this.secondLooks += 1;
        this.counts = { ...this.counts, secondLooks: this.secondLooks };
        return this.readWindow(again, "second");
      }
    }
    return true;
  }

  private sideOf(): ReadonlyMap<string, "home" | "away"> {
    return new Map(this.roster.map((player) => [player.playerId, player.side]));
  }

  /**
   * The stat lines one reply carried (fix 6, Part 1): checked, the accepted
   * ones added to the session where they set totals (R41), the strip's line
   * updated. The caller logs them and queues the re-reads.
   */
  private applyBoothLines(lines: readonly BoothStatLine[], at: number, readThrough: number | undefined): ReturnType<typeof readBoothLines> {
    const booth = readBoothLines(this.session, lines, this.roster, { utterances: this.utterances, ...(readThrough !== undefined ? { readThrough } : {}) });
    if (booth.accepted.length === 0) return booth;
    this.session = booth.session;
    this.counts = { ...this.counts, boothLines: (this.counts.boothLines ?? 0) + booth.accepted.length };
    // The newest group that changed a total, one quiet line on the strip.
    const groups = new Map<string, BoothLine[]>();
    for (const line of booth.accepted) {
      const id = `${line.seq}|${line.playerId}`;
      groups.set(id, [...(groups.get(id) ?? []), line]);
    }
    for (const group of groups.values()) {
      const text = boothText(group, this.roster);
      if (text) this.booth = { text, at };
    }
    return booth;
  }

  private logBooth(booth: ReturnType<typeof readBoothLines>, at: number) {
    for (const line of booth.accepted) {
      this.deps.log({ kind: "stats_booth", gameId: this.gameId, at, accepted: true, line: { seq: line.seq, playerId: line.playerId, scope: line.scope, key: line.key, value: line.value }, had: line.had });
    }
    for (const { line, reason } of booth.refused) {
      this.deps.log({ kind: "stats_booth", gameId: this.gameId, at, accepted: false, line, reason });
    }
  }

  /**
   * The re-read a booth line's count mismatch asks for (fix 6, Part 1, R42):
   * the lines from that player's previous booth line (else the game's start)
   * to this one, the plays counted in them with their credits, the game state
   * and the booth line, to the same reader, for corrections to that player's
   * plays only. One at a time, each line once, BOOTH_REREADS_PER_GAME a game.
   */
  private rereadBooth(line: BoothLine) {
    const id = `${line.playerId}|${line.seq}`;
    if (this.boothSeen.has(id) || this.disposed || this.finishing || this.overBudget()) return;
    this.boothSeen.add(id);
    if (this.boothRereads + this.boothQueue.length >= BOOTH_REREADS_PER_GAME) return;
    this.boothQueue.push(line);
    this.nextBoothReread();
  }

  private nextBoothReread(): void {
    if (this.boothInFlight || this.disposed) return;
    const line = this.boothQueue.shift();
    if (!line) return;
    const previous = boothLinesOf(this.session)
      .filter((each) => each.playerId === line.playerId && each.seq < line.seq)
      .reduce((latest, each) => Math.max(latest, each.seq), -1);
    const from = previous + 1;
    const all = this.utterances.filter((each) => each.seq >= from && each.seq <= line.seq).map((each) => ({ seq: each.seq, text: each.text, offsetMs: each.offsetMs }));
    const lines = all.length > MAX_REREAD_LINES ? all.slice(-MAX_REREAD_LINES) : all;
    if (lines.length === 0) {
      this.nextBoothReread();
      return;
    }
    const first = lines[0].seq;
    const ids = new Set(this.session.plays.filter((play) => play.status !== "discarded" && play.play.seqStart >= first && play.play.seqEnd <= line.seq).map((play) => play.playId));
    this.boothRereads += 1;
    this.boothInFlight = true;
    this.counts = { ...this.counts, boothRereads: this.boothRereads };
    const task: Promise<void> = this.reread("booth", lines, ids, "R42", "corrected by the booth line's re-read", DRIVE_REREAD_TIMEOUT_MS, (request) => this.deps.extract(request), {
      boothLine: { seq: line.seq, playerId: line.playerId, key: line.key, value: line.value, spotter: line.had },
    })
      .then(() => undefined)
      .finally(() => {
        this.background.delete(task);
        this.boothInFlight = false;
        this.nextBoothReread();
      });
    this.background.add(task);
  }

  /**
   * The re-read of one drive (Part 7): its whole transcript, the plays
   * counted for it with their credits, and the game state, to the same
   * reader, for corrections only. In the background: the loop goes on, and a
   * failure or a reply after DRIVE_REREAD_TIMEOUT_MS leaves the drive as it
   * was, with its code in the log. Each drive once.
   */
  private rereadDrive(drive: Drive<SessionPlay>) {
    const endId = drive.plays[drive.plays.length - 1].playId;
    // Not at End game: its last read has a short budget and nobody would wait for a re-read's reply.
    if (this.rereadDrives.has(endId) || this.disposed || this.finishing || this.overBudget()) return;
    this.rereadDrives.add(endId);
    const ids = new Set(drive.plays.map((play) => play.playId));
    const lines = driveWindow(drive, this.utterances, this.readThrough, MAX_REREAD_LINES).map((line) => ({ seq: line.seq, text: line.text, offsetMs: line.offsetMs }));
    if (lines.length === 0) return;
    this.driveRereads += 1;
    this.counts = { ...this.counts, driveRereads: this.driveRereads };
    const task: Promise<void> = this.reread("drive", lines, ids, "R39", "corrected by the drive's re-read", DRIVE_REREAD_TIMEOUT_MS, (request) => this.deps.extract(request))
      .then(() => undefined)
      .finally(() => {
        this.background.delete(task);
      });
    this.background.add(task);
  }

  /**
   * The halftime checkup (Part 8): the whole first half's lines, every play
   * counted for it with its credits, and the game state, to the stronger
   * model through deps.halftime, once a game, in the background: H runs it,
   * and so does the first of its triggers (halftime.ts). If it has not come
   * back when the second half's first play is read, it still applies when it
   * does; after HALFTIME_TIMEOUT_MS it gives up and the log says so. The
   * strip shows one quiet line when it is done.
   */
  halftimeCheck() {
    if (this.halftimeRan || !this.restored || this.disposed || !this.deps.halftime) return;
    const halftime = this.deps.halftime;
    this.halftimeRan = true;
    const lastSeq = this.utterances.at(-1)?.seq ?? NO_WATERMARK;
    const end = firstHalfEnd(this.session.plays, this.halftimeLine, lastSeq);
    const all = this.utterances.filter((line) => line.seq <= end).map((line) => ({ seq: line.seq, text: line.text, offsetMs: line.offsetMs }));
    const lines = all.length > MAX_HALF_LINES ? all.slice(-MAX_HALF_LINES) : all;
    const ids = new Set(this.session.plays.filter((play) => play.status !== "discarded" && play.play.seqEnd <= end).map((play) => play.playId));
    if (lines.length === 0) return;
    this.halftime = { state: "running" };
    this.emit();
    const task: Promise<void> = this.reread("halftime", lines, ids, "R40", "corrected by the halftime check", HALFTIME_TIMEOUT_MS, (request) => halftime(request))
      .then((result) => {
        this.halftime = result ? { state: "done", changes: result.changes } : { state: "failed", code: this.lastRereadCode ?? "unknown" };
        this.counts = { ...this.counts, halftimeChanges: result ? result.changes : -1 };
        if (!this.disposed) this.emit();
      })
      .finally(() => {
        this.background.delete(task);
      });
    this.background.add(task);
  }

  /** The last re-read failure's code, for the halftime line. */
  private lastRereadCode: string | null = null;

  /**
   * The gaps the ledger reports (fix 6, Part 3): where the downs say a snap
   * was run between two counted plays and never read. Each gap's lines (plus
   * GAP_MARGIN_LINES each side, at most MAX_GAP_LINES) go to the reader in
   * the background with the game state and one sentence about the missing
   * snap (R44). When nothing comes back and the gap can only have been an
   * incomplete pass, one is inferred for the quarterback on the field (R45).
   * Each gap once, GAP_REREADS_PER_GAME a game.
   */
  private rereadGaps() {
    if (this.disposed || this.finishing || this.overBudget()) return;
    for (const gap of ledgerGaps(this.session, this.roster, { utterances: this.utterances, teams: this.teams })) {
      const lines = this.gapLines(gap);
      if (!lines) continue;
      const key = `${lines.seqFrom}|${lines.seqTo}`;
      if (this.gapsSeen.has(key)) continue;
      if (this.gapRereads >= GAP_REREADS_PER_GAME) return;
      this.gapsSeen.add(key);
      const window = this.utterances.filter((each) => each.seq >= lines.seqFrom && each.seq <= lines.seqTo).map((each) => ({ seq: each.seq, text: each.text, offsetMs: each.offsetMs }));
      if (window.length === 0) {
        // Nothing was said between the two plays: nothing to read, but the downs still say what the snap was.
        this.fillGap(gap, lines, this.deps.now());
        continue;
      }
      this.gapRereads += 1;
      this.counts = { ...this.counts, gapRereads: this.gapRereads };
      const ids = new Set([gap.beforeId, gap.afterId].filter((id): id is string => id !== null));
      const before = this.session.plays.length;
      const task: Promise<void> = this.reread("gap", window, ids, "R44", "read from the lines where the downs say a snap was missed", DRIVE_REREAD_TIMEOUT_MS, (request) => this.deps.extract(request), {
        gap: { offense: gap.offense, before: this.gapSpot(gap.before, gap.offense), after: this.gapSpot(gap.after, gap.offense), yards: gap.yards },
      })
        .then((result) => {
          // Nothing came back for the gap: an incomplete pass, when that is all it can have been.
          if (result !== null && this.session.plays.length === before) this.fillGap(gap, lines, this.deps.now());
        })
        .finally(() => {
          this.background.delete(task);
        });
      this.background.add(task);
    }
  }

  /** The gap's lines: from the end of the play before (or the start of the game) to the start of the play after, with a margin each side, the first MAX_GAP_LINES. */
  private gapLines(gap: LedgerGap): { seqFrom: number; seqTo: number } | null {
    const before = gap.beforeId ? this.session.plays.find((play) => play.playId === gap.beforeId) : null;
    const after = this.session.plays.find((play) => play.playId === gap.afterId);
    if (!after) return null;
    let from = before ? before.play.seqEnd + 1 : 0;
    if (!before) {
      // The drive's start: from the end of the last play before the first one, whoever had the ball.
      const earlier = this.session.plays.filter((play) => play.status !== "discarded" && play.play.seqEnd < after.play.seqStart).reduce((last, play) => Math.max(last, play.play.seqEnd), -1);
      from = earlier + 1;
    }
    const to = after.play.seqStart - 1;
    if (to < from) return null;
    const seqFrom = Math.max(0, from - GAP_MARGIN_LINES);
    const seqTo = Math.min(to + GAP_MARGIN_LINES, seqFrom + MAX_GAP_LINES - 1, this.readThrough);
    return seqTo >= seqFrom ? { seqFrom, seqTo } : null;
  }

  /** A gap's down, distance and spot as the request carries them. */
  private gapSpot(facts: LedgerGap["before"], offense: "home" | "away") {
    const spot = facts.spot === null ? null : facts.spot === 50 ? { yardLine: 50, territory: "midfield" as const } : facts.spot < 50 ? { yardLine: facts.spot, territory: offense } : { yardLine: 100 - facts.spot, territory: offense === "home" ? ("away" as const) : ("home" as const) };
    return { down: facts.down, distance: facts.distance, spot };
  }

  /** The incomplete pass a gap infers (R45): in line, logged, counted under autoOk, and the ledger run again. */
  private fillGap(gap: LedgerGap, lines: { seqFrom: number; seqTo: number }, at: number) {
    const text = this.utterances.filter((each) => each.seq >= lines.seqFrom && each.seq <= lines.seqTo).map((each) => each.text).join(" ");
    if (!inferredIncompletion(gap, text)) return;
    const step = addInferredIncompletion(this.session, gap, lines, this.roster, at, this.out);
    if (!step.play) return;
    this.session = step.session;
    this.gapFills += 1;
    this.counts = { ...this.counts, gapFills: this.gapFills };
    this.deps.log({ kind: "stats_play", gameId: this.gameId, at, playId: step.play.playId, play: step.play.play, changes: step.play.changes, dropped: step.play.dropped });
    this.emit();
    if (this.autoOk) this.ok(step.play.playId);
  }

  /**
   * One re-read, of a drive or a half: asked, raced against `timeoutMs`,
   * checked and read in through the same path as any read, every play it
   * touches noted with `rule`. Never throws; null when it failed, else how
   * many plays it changed.
   */
  protected async reread(
    look: Exclude<ReadLook, "first" | "second">,
    lines: Array<{ seq: number; text: string; offsetMs: number }>,
    ids: ReadonlySet<string>,
    rule: Extract<RuleId, "R39" | "R40" | "R42" | "R44">,
    reason: string,
    timeoutMs: number,
    extract: (request: ExtractStatsRequest) => Promise<ExtractReply>,
    extra: Pick<ExtractStatsRequest, "boothLine" | "gap"> = {},
  ): Promise<{ changes: number } | null> {
    const plays = this.session.plays.filter((play) => ids.has(play.playId) && play.status !== "discarded");
    const request: ExtractStatsRequest = {
      utterances: lines,
      rosters: this.roster.map((player) => ({
        playerId: player.playerId,
        side: player.side,
        jersey: player.jersey,
        first: player.first,
        last: player.last,
        position: player.position,
        ...(player.aliases?.length ? { aliases: player.aliases } : {}),
      })),
      recentPlays: plays.map((play) => ({ playId: play.playId, summary: play.play.summary, detail: creditsLine(play.play) })),
      // A re-read is told the booth's stat lines too: facts about the totals (fix 6, Part 1).
      gameState: readerGameState(this.session.plays, this.roster, { teams: this.teams, out: this.out, booth: boothLinesOf(this.session), utterances: this.utterances }),
      look,
      ...extra,
      ...(this.arbiterUse.plays > 0 ? { arbiterUse: { ...this.arbiterUse } } : {}),
    };
    const seqFrom = lines[0]?.seq;
    const seqTo = lines[lines.length - 1]?.seq;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), timeoutMs);
    });
    let reply: ExtractReply | "late";
    try {
      reply = await Promise.race([extract(request), late]);
    } catch {
      reply = { ok: false, code: "unknown" };
    } finally {
      clearTimeout(timer);
    }
    if (this.disposed) return null;
    const at = this.deps.now();
    if (reply === "late" || !reply.ok) {
      const code = reply === "late" ? (look === "halftime" ? HALFTIME_TIMEOUT : REREAD_TIMEOUT) : reply.code;
      this.lastRereadCode = code;
      this.deps.log({ kind: "stats_reply", gameId: this.gameId, at, ok: false, code, seqFrom, seqTo, look });
      this.emit();
      return null;
    }
    const tokensIn = reply.usage.inputTokens + reply.usage.cacheWriteTokens + reply.usage.cacheReadTokens;
    this.spend(reply.usage);
    this.countArbiter(reply.arbiterUse);
    let read: ReturnType<typeof readPlays>;
    let validated: StatsPlay[];
    let statLines: BoothStatLine[];
    try {
      validated = validatePlays({ plays: reply.plays }, { utterances: lines, look });
      statLines = validateStatLines(reply.statLines, { utterances: lines });
      const fresh = freshReads(validated, this.session, this.watermark, ids, true);
      read = readPlays(this.session, fresh, this.roster, at, {
        utterances: this.utterances,
        out: this.out,
        teams: this.teams,
        ...(this.guessBack ? { guessBack: true } : {}),
        readThrough: seqTo,
        reread: { ids },
        source: { rule, reason },
      });
    } catch {
      this.lastRereadCode = APPLY_FAILED;
      this.deps.log({ kind: "stats_reply", gameId: this.gameId, at, ok: false, code: APPLY_FAILED, seqFrom, seqTo, look });
      this.emit();
      return null;
    }
    this.session = read.session;
    this.deps.log({
      kind: "stats_reply",
      gameId: this.gameId,
      at,
      ok: true,
      plays: validated,
      seqFrom,
      seqTo,
      tokensIn,
      tokensOut: reply.usage.outputTokens,
      tokensCached: reply.usage.cacheReadTokens,
      look,
      ...(statLines.length > 0 ? { statLines } : {}),
    });
    for (const play of read.added) this.deps.log({ kind: "stats_play", gameId: this.gameId, at, playId: play.playId, play: play.play, changes: play.changes, dropped: play.dropped });
    for (const play of read.updated) this.deps.log({ kind: "stats_update", gameId: this.gameId, at, playId: play.playId, play: play.play, changes: play.changes, dropped: play.dropped });
    for (const play of read.removed ?? []) this.deps.log({ kind: "stats_decision", gameId: this.gameId, at, playId: play.playId, decision: "discard" });
    this.emit();
    if (read.updated.some((play) => play.status === "applied") || (read.removed?.length ?? 0) > 0) this.changed(new Map());
    if (this.autoOk) for (const play of read.added) this.ok(play.playId);
    const booth = this.applyBoothLines(statLines, at, seqTo);
    this.logBooth(booth, at);
    if (booth.accepted.length > 0) {
      this.emit();
      this.changed(new Map());
    }
    for (const line of booth.mismatched) this.rereadBooth(line);
    if (look !== "gap") this.rereadGaps();
    return { changes: read.added.length + read.updated.length + (read.removed?.length ?? 0) };
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
    const at = this.deps.now();
    this.deps.log({
      kind: "stats_decision",
      gameId: this.gameId,
      at,
      playId: step.play.playId,
      decision,
      ...(decision === "edit" ? { changes: step.play.changes, ...(step.play.edits ? { edits: step.play.edits } : {}) } : {}),
    });
    // A decision changes which plays count or what one says, so the drive
    // ledger runs again (fix 6, Part 2): the other plays' worked-out gains
    // follow, and are logged as updates like any other change.
    const settled = settleLedger(this.session, this.roster, { utterances: this.utterances, out: this.out, teams: this.teams, ...(this.v7 ? { trustNamed: true } : {}) });
    if (settled.updated.length > 0) {
      this.session = settled.session;
      for (const play of settled.updated) this.deps.log({ kind: "stats_update", gameId: this.gameId, at, playId: play.playId, play: play.play, changes: play.changes, dropped: play.dropped });
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // What it adds up to.
  // ---------------------------------------------------------------------------

  /** The counts, with the v7 reader's own folded in. */
  private allCounts(): StatsCounts {
    if (!this.v7) return this.counts;
    const v7 = this.v7.counts();
    return { ...this.counts, secondLooks: v7.secondLooks, driveRereads: v7.driveRereads, gapRereads: v7.gapRereads, pipeline: "v7" };
  }

  /** Seconds from each play's segment's last line to its stats being applied (v7); empty under v6. */
  latencies(): readonly number[] {
    return this.v7?.latencies ?? [];
  }

  /** Every segment the v7 segmenter closed, for the plays file; empty under v6. */
  segments(): readonly import("./v7").SegmentSummary[] {
    return this.v7?.segments ?? [];
  }

  /** The v7 segmenter's own counts (recaps joined); null under v6. */
  segmenterCounts(): import("./segment").SegmenterCounts | null {
    return this.v7?.segmenterCounts() ?? null;
  }

  /** Every v7 request with its answer, when built with recordDetail; empty otherwise. */
  segmentDetail(): readonly import("./v7").SegmentDetail[] {
    return this.v7?.details ?? [];
  }

  /**
   * The v7 read in flight, once its reply has landed and been applied (the
   * replay harness, lib/livestats/liveReplay.ts, waits on it); null when none.
   */
  v7Pending(): Promise<void> | null {
    return this.v7?.pending() ?? null;
  }

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
      halftime: this.halftime,
      booth: this.booth,
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
    yards_downs: 0,
    yards_drive: 0,
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

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
