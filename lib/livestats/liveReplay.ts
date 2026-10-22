import type { TonightTally } from "@/lib/cards/tonight";
import type { FootballStatKey } from "@/lib/cards/statKeys";
import type { StatsCounts } from "@/lib/game/statsBridge";
import type { StatsRecord } from "@/lib/log/statsLog";
import { addUsage, costOf } from "./cost";
import { StatsController, type ExtractReply, type SegmentReply } from "./controller";
import type { CallRecord } from "./manifest";
import type { RecordedCall } from "./playsJson";
import type { LiveStatsPipeline } from "./settings";
import type { SegmentRequest } from "./extract/request";
import type { SegmentDetail, SegmentSummary } from "./v7";
import type { ReplayGame } from "./replayLog";
import { talliesOf, type SessionPlay } from "./session";
import {
  HALFTIME_SETTING,
  ratesFor,
  settingLabel,
  type LiveStatsSetting,
} from "./settings";
import {
  NO_USAGE,
  type ExtractStatsRequest,
  type ExtractStatsResponse,
  type StatsRosterPlayer,
  type StatsUsage,
} from "./types";

// =============================================================================
// Replaying a downloaded log through the reader, live (Oct 10; rebuilt Oct 11
// to drive the real loop): the log's lines are said to a StatsController on the
// log's own clock, so the calls land where they would have in the game, with
// the same windows, the same catch-up, the same second looks, drive re-reads
// and halftime check, and every play counted as autoOk counts it. The call is
// handed in, so a test can run it with a fake wire and the harness
// (scripts/replay-livestats.ts, scripts/score-livestats.ts) with the real one
// at any allowed setting. Writes nothing anywhere; the harness prints.
//
// The clock: each line is said at its wall-clock time from the log, the loop's
// timer ticks every CHECK_EVERY_MS of log time between lines, and a call's own
// real duration moves the clock on, so the seconds from a play's last line to
// its stats mean what they would have live.
//
// Under v7 (fix 1, Part 0) the transcript does not wait for a call: the lines
// and the ticks are said at their own times while a segment read is in
// flight, and the read's reply lands at the moment it would have live, when
// it was asked plus how long it really took. So the segmenter only ever sees
// the transcript's own clock, and a dry run (where a read takes no time) cuts
// the same segments a live one does. v6 keeps the clock it always had.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** The live screen's timer (components/livestats/useLiveStats.ts CHECK_EVERY_MS), ticked across gaps between lines. */
export const REPLAY_TICK_MS = 2_000;

/**
 * A replay has nobody to flip the switch, so a loop stopped by MAX_FAILURES
 * tries again this long after its last call rather than waiting out the game.
 */
export const REPLAY_RETRY_AFTER_STOP_MS = 60_000;

// =============================================================================

/**
 * A recorded call's timing (`--recorded --replies`, Oct 22): how long it took
 * and when the loop got it back, so a re-run moves the replay's clock exactly
 * as the run it re-reads did.
 */
export interface ReplayTiming {
  tookMs: number;
  returnAfterMs: number;
}

/** One call, at one setting. Throws on a failure, which counts as a failed call. A recorded reply carries its timing. */
export type ReplayExtract = (
  request: ExtractStatsRequest,
  setting: LiveStatsSetting,
) => Promise<ExtractStatsResponse & { timing?: ReplayTiming }>;

/** A recorded call that failed, re-run: its code as the message, with its timing. */
export class RecordedCallFailure extends Error {
  readonly timing: ReplayTiming;

  constructor(code: string, timing: ReplayTiming) {
    super(code);
    this.timing = timing;
  }
}

/** One v7 segment read (Part 5, Part 8): the route's work, with reader A, reader B and the tie-break inside it. Throws on a failure. */
export type ReplaySegmentExtract = (request: SegmentRequest) => Promise<SegmentReply>;

export interface LiveReplayOptions {
  setting: LiveStatsSetting;
  extract: ReplayExtract;
  /** v7 (Part 0): the segment reader; with it the loop runs the staged pipeline rather than the window reader. */
  extractSegment?: ReplaySegmentExtract;
  pipeline?: LiveStatsPipeline;
  /** Dollars the game may spend before the optional calls stop (--max-cost). Null or absent for no cap. */
  maxCostUsd?: number | null;
  /** Part 7's running-back prior, on or off. */
  allowInferredRb?: boolean;
  /** The halftime check's call (Part 8), at HALFTIME_SETTING. Absent, the check never runs, so a run can be scored with and without it. */
  halftime?: ReplayExtract;
  /** Between calls, to keep OpenRouter's rate limit out of what is measured. */
  paceMs?: number;
  /** v7: dollars spent at which the replay stops where it is (--max-cost), skipping End game's read. Absent for no stop. */
  hardCapUsd?: number | null;
  /** Called once the loop is built, with a function that returns the result so far (the harness writes it on Ctrl-C). */
  onStart?: (peek: () => LiveReplayResult) => void;
  /** Each line of progress, for the harness to print. */
  log?: (line: string) => void;
  /** The real clock, for how long each call takes. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface LiveReplayResult {
  setting: LiveStatsSetting;
  calls: number;
  failures: number;
  /** Calls that came back with no plays. */
  emptyCalls: number;
  /** Plays the reader returned, all calls together, before dedupe. */
  playsReturned: number;
  /** Plays as readPlays made them: new plays, not updates. */
  plays: SessionPlay[];
  usage: StatsUsage;
  /** Wall-clock seconds of each call that came back. */
  seconds: number[];
  /** Seconds from each new play's last line to the moment its stats were applied, on the replay's clock. */
  latencies: number[];
  totals: Map<string, TonightTally>;
  /** Every player the game ever had loaded, the latest version of each. */
  everyone: Map<string, StatsRosterPlayer>;
  /** The session as the loop left it, booth lines included (fix 6). */
  session: import("./session").StatsSession;
  /** The loop's own counts: re-reads, booth lines, inferred plays. */
  counts: StatsCounts;
  /** When the call that first returned each play came back, on the replay's clock: its first stats_play record's `at` (lib/livestats/playsJson.ts). */
  firstReturnedAt: Map<string, number>;
  /** Every model call, in order, as the manifest records it (v7, Part 0). */
  callRecords: CallRecord[];
  /** v6 (Oct 22): every call with its request's lines and its reply, for `--recorded --replies`; empty under v7. */
  callDetail: RecordedCall[];
  /** Every segment the v7 segmenter closed (lib/livestats/v7.ts), empty under v6, for the segmentation scorer. */
  segments: SegmentSummary[];
  /** Every v7 request with what it was answered (lib/livestats/v7.ts SegmentDetail); empty under v6. */
  segmentDetail: SegmentDetail[];
  /** Why the replay stopped before the end of the log, or null when it read the whole game. */
  stoppedBy: "max_cost" | null;
  /** v7: the segmenter's own counts (recaps joined to the play before); null under v6. */
  segmenter: import("./segment").SegmenterCounts | null;
}

/** Everyone the game ever had loaded, the latest version of each player winning. */
export function everyoneIn(game: ReplayGame): Map<string, StatsRosterPlayer> {
  const everyone = new Map<string, StatsRosterPlayer>();
  for (const roster of game.rosters)
    for (const player of roster.players) everyone.set(player.playerId, player);
  return everyone;
}

/** The middle value, 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One replay of the log at one setting, through the real loop. */
export async function runLiveReplay(
  game: ReplayGame,
  options: LiveReplayOptions,
): Promise<LiveReplayResult> {
  const { setting, extract } = options;
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pace = options.paceMs ?? 0;

  const everyone = everyoneIn(game);
  const atOfSeq = new Map(
    game.utterances.map((utterance) => [utterance.seq, utterance.at]),
  );
  const result: LiveReplayResult = {
    setting,
    calls: 0,
    failures: 0,
    emptyCalls: 0,
    playsReturned: 0,
    plays: [],
    usage: NO_USAGE,
    seconds: [],
    latencies: [],
    totals: new Map(),
    everyone,
    session: { plays: [] },
    counts: { playsApplied: 0, playsUndone: 0, offMidGame: false, tokensIn: 0, tokensOut: 0, tokensCached: 0 },
    firstReturnedAt: new Map(),
    callRecords: [],
    callDetail: [],
    segments: [],
    segmentDetail: [],
    stoppedBy: null,
    segmenter: null,
  };

  // The replay's clock: the log's wall clock, moved on by each call's real duration.
  let clock = game.utterances[0]?.at ?? 0;
  const first = clock;
  /** How many replies the loop has got back, for each call's `done`. */
  let returned = 0;

  /** One call through the wire at a setting, counted, timed and paced like the loop's own. */
  const wired =
    (call_: ReplayExtract, at: LiveStatsSetting) =>
    async (request: ExtractStatsRequest): Promise<ExtractReply> => {
      result.calls += 1;
      const call = result.calls;
      const started = now();
      const askedAt = clock;
      const seqs = request.utterances.map((utterance) => utterance.seq);
      /** The call as the plays file keeps it, once the loop has the reply back. A recorded reply puts the clock where it was then. */
      const detail = (took: number, timing: ReplayTiming | undefined, answer: Pick<RecordedCall, "ok" | "code" | "plays" | "statLines" | "usage">) => {
        if (timing) clock = Math.max(clock, askedAt + timing.returnAfterMs);
        returned += 1;
        result.callDetail.push({ index: call, done: returned, look: request.look ?? "first", seqFrom: seqs[0] ?? null, seqTo: seqs.at(-1) ?? null, seqs, askedAtMs: askedAt - first, tookMs: took, returnAfterMs: clock - askedAt, ...answer });
      };
      let reply: ExtractStatsResponse & { timing?: ReplayTiming };
      try {
        reply = await call_(request, at);
      } catch (error) {
        result.failures += 1;
        const timing = error instanceof RecordedCallFailure ? error.timing : undefined;
        const took = timing ? timing.tookMs : now() - started;
        clock = Math.max(clock, askedAt + took);
        result.callRecords.push({ index: call, look: request.look ?? "first", role: request.look === "halftime" ? "halftime" : "reader", model: at.model, promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0, seconds: took / 1000, ok: false });
        log(
          `${stamp(askedAt - first)}  call ${call}: FAILED, ${error instanceof Error ? error.message : String(error)}`,
        );
        const code = error instanceof Error ? error.message : "unknown";
        detail(took, timing, { ok: false, code });
        return { ok: false, code };
      }
      const took = reply.timing ? reply.timing.tookMs : now() - started;
      result.seconds.push(took / 1000);
      clock = Math.max(clock, askedAt + took);
      result.usage = addUsage(result.usage, reply.usage);
      result.callRecords.push({
        index: call,
        look: request.look ?? "first",
        role: request.look === "halftime" ? "halftime" : "reader",
        model: at.model,
        promptTokens: reply.usage.inputTokens,
        cachedTokens: reply.usage.cacheReadTokens,
        cacheWriteTokens: reply.usage.cacheWriteTokens,
        completionTokens: reply.usage.outputTokens,
        reasoningTokens: reply.usage.reasoningTokens ?? 0,
        costUsd: reply.usage.costUsd,
        seconds: took / 1000,
        ok: true,
      });
      result.playsReturned += reply.plays.length;
      if (reply.plays.length === 0) result.emptyCalls += 1;
      log(
        `${stamp(askedAt - first)}  call ${call}${request.look ? ` (${request.look})` : ""}: ${request.utterances.length} in, ${reply.plays.length} returned, ${reply.usage.outputTokens} out`,
      );
      if (pace > 0) await sleep(pace);
      detail(took, reply.timing, { ok: true, plays: reply.plays, statLines: reply.statLines ?? [], usage: reply.usage });
      return { ok: true, plays: reply.plays, statLines: reply.statLines ?? [], usage: reply.usage };
    };

  /**
   * The v7 read in flight (V7Reader sends one at a time): when its reply lands
   * on the log's clock, known once the real call has come back, and the gate
   * that hands the reply to the reader. The loop below opens the gate.
   */
  let flight: { landsAt: Promise<number>; land: () => void } | null = null;
  let flightStarted: (() => void) | null = null;
  const overCap = () => options.hardCapUsd !== undefined && options.hardCapUsd !== null && result.usage.costUsd >= options.hardCapUsd;

  /** One v7 segment read, counted, timed and paced like a v6 call; the route's own calls (A, B, the tie-break) are each recorded. */
  const wiredSegment =
    (call_: ReplaySegmentExtract) =>
    async (request: SegmentRequest): Promise<SegmentReply> => {
      // At the cap nothing more is sent: the loop stops at the next line, and End game's read is skipped.
      if (overCap()) {
        result.stoppedBy = "max_cost";
        return { ok: false, code: "max_cost" };
      }
      result.calls += 1;
      const started = now();
      const askedAt = clock;
      let landed!: (at: number) => void;
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      flight = { landsAt: new Promise<number>((resolve) => (landed = resolve)), land: open };
      flightStarted?.();
      let reply: SegmentReply;
      try {
        reply = await call_(request);
      } catch (error) {
        result.failures += 1;
        const took = now() - started;
        result.callRecords.push({ index: result.callRecords.length + 1, look: request.look, role: "a", model: setting.model, promptTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, completionTokens: 0, reasoningTokens: 0, costUsd: 0, seconds: took / 1000, ok: false, segmentId: request.segment.id });
        log(`${stamp(askedAt - first)}  segment ${request.segment.id} (${request.look}): FAILED, ${error instanceof Error ? error.message : String(error)}`);
        if (pace > 0) await sleep(pace);
        landed(askedAt + took);
        await gate;
        return { ok: false, code: error instanceof Error ? error.message : "unknown" };
      }
      const took = now() - started;
      result.seconds.push(took / 1000);
      if (reply.ok) {
        for (const made of reply.calls) {
          result.callRecords.push({ index: result.callRecords.length + 1, look: request.look, role: made.role, model: made.model, promptTokens: made.promptTokens, cachedTokens: made.cachedTokens, cacheWriteTokens: made.cacheWriteTokens, completionTokens: made.completionTokens, reasoningTokens: made.reasoningTokens, costUsd: made.costUsd, seconds: made.seconds, ok: made.ok, segmentId: request.segment.id });
          result.usage = addUsage(result.usage, { inputTokens: made.promptTokens, outputTokens: made.completionTokens, cacheWriteTokens: made.cacheWriteTokens, cacheReadTokens: made.cachedTokens, costUsd: made.costUsd, reasoningTokens: made.reasoningTokens });
        }
        result.playsReturned += reply.answer.playType === "not_a_play" ? 0 : 1;
        if (reply.answer.playType === "not_a_play") result.emptyCalls += 1;
        log(`${stamp(askedAt - first)}  segment ${request.segment.id} (${request.look}): ${request.segment.lines.length} lines, ${reply.answer.playType}${reply.agreement ? ` [${reply.agreement}]` : ""}, ${reply.calls.length} call${reply.calls.length === 1 ? "" : "s"}`);
      } else {
        result.failures += 1;
        log(`${stamp(askedAt - first)}  segment ${request.segment.id} (${request.look}): FAILED, ${reply.code}`);
      }
      if (pace > 0) await sleep(pace);
      // The reply lands when it would have live; the loop opens the gate once its clock gets there.
      landed(askedAt + took);
      await gate;
      return reply;
    };

  const controller = new StatsController({
    gameId: game.gameId || "replay",
    startedAt: first,
    roster: [],
    autoOk: true,
    retryAfterStopMs: REPLAY_RETRY_AFTER_STOP_MS,
    teams: game.teams,
    pipeline: options.pipeline ?? "v6",
    maxCostUsd: options.maxCostUsd ?? null,
    allowInferredRb: options.allowInferredRb ?? false,
    recordDetail: true,
    deps: {
      extract: wired(extract, setting),
      ...(options.extractSegment ? { extractSegment: wiredSegment(options.extractSegment) } : {}),
      ...(options.halftime
        ? { halftime: wired(options.halftime, HALFTIME_SETTING) }
        : {}),
      log: (record: StatsRecord) => {
        if (record.kind !== "stats_play") return;
        if (!result.firstReturnedAt.has(record.playId)) result.firstReturnedAt.set(record.playId, record.at);
        const said = atOfSeq.get(record.play.seqEnd);
        if (said !== undefined)
          result.latencies.push(Math.max(0, (record.at - said) / 1000));
        log(
          `            ${Math.round(record.play.confidence * 100)}%  ${record.play.summary}`,
        );
      },
      readLog: async () => [],
      track: () => undefined,
      now: () => clock,
    },
  });
  await controller.start();
  const v7 = controller.pipeline === "v7";

  /** The result as it stands: the whole of it at the end, or so far for a harness writing on Ctrl-C. */
  const snapshot = (): LiveReplayResult => {
    const session = controller.getView().session;
    const latencies = v7 ? [...controller.latencies()] : [...result.latencies];
    return {
      ...result,
      counts: controller.bridge.counts(),
      latencies,
      segments: v7 ? [...controller.segments()] : [],
      segmentDetail: v7 ? [...controller.segmentDetail()] : [],
      segmenter: controller.segmenterCounts(),
      plays: session.plays,
      session,
      totals: talliesOf(session),
      callRecords: [...result.callRecords],
      callDetail: [...result.callDetail],
      firstReturnedAt: new Map(result.firstReturnedAt),
    };
  };
  options.onStart?.(snapshot);

  /**
   * v7: lands the read in flight when its reply is back by `until` on the
   * log's clock, and waits for the reader to apply it (which may send the
   * next read). True when one landed.
   */
  const landBy = async (until: number): Promise<boolean> => {
    const current = flight;
    if (!current) return false;
    const at = await current.landsAt;
    if (at > until) return false;
    clock = Math.max(clock, at);
    flight = null;
    const applied = controller.v7Pending();
    current.land();
    if (applied) await applied.catch(() => undefined);
    return true;
  };
  const settle = async (until: number) => {
    while (await landBy(until));
  };

  let rosterIndex = -1;
  let outIndex = 0;
  for (let index = 0; index < game.utterances.length; index++) {
    const utterance = game.utterances[index];
    if (v7 && (result.stoppedBy !== null || overCap())) {
      result.stoppedBy = "max_cost";
      break;
    }
    if (v7) {
      // The live screen's timer, across the gap since the last line, with each read landing in its turn.
      while (clock + REPLAY_TICK_MS < utterance.at) {
        const tick = clock + REPLAY_TICK_MS;
        await settle(tick);
        clock = Math.max(clock, tick);
        controller.tick();
      }
      await settle(utterance.at);
    }
    if (utterance.roster !== rosterIndex) {
      rosterIndex = utterance.roster;
      controller.setRoster(game.rosters[rosterIndex].players);
    }
    // Who was marked out by now, as the game had it.
    while (
      outIndex < game.outChanges.length &&
      game.outChanges[outIndex].at <= utterance.at
    ) {
      controller.setOut(game.outChanges[outIndex].playerIds);
      outIndex += 1;
    }
    if (!v7) {
      // The live screen's timer, across the gap since the last line.
      while (clock + REPLAY_TICK_MS < utterance.at) {
        clock += REPLAY_TICK_MS;
        controller.tick();
        await controller.idle();
      }
    }
    clock = Math.max(clock, utterance.at);
    controller.heard(utterance.text, utterance.at);
    if (!v7) await controller.idle();
  }
  if (v7) {
    if (result.stoppedBy === null) {
      // End game's last read, as the live screen does it, with every read still to come landing as it comes back.
      let finished = false;
      const finishing = controller.finish().then(() => {
        finished = true;
      });
      while (!finished) {
        if (flight) {
          await landBy(Number.POSITIVE_INFINITY);
          continue;
        }
        await Promise.race([finishing, new Promise<void>((resolve) => (flightStarted = resolve))]);
        flightStarted = null;
      }
    }
    // A read the loop gave up on: its reply is not applied (the loop is done), but its promise is let go.
    const left = flight as { land: () => void } | null;
    left?.land();
    flight = null;
  } else {
    // End game's last read, as the live screen does it.
    await controller.finish();
    await controller.idle();
  }
  const done = snapshot();
  controller.dispose();
  return done;
}

/** One replay per setting, one after another, never two at once. */
export async function runComparison(
  game: ReplayGame,
  settings: readonly LiveStatsSetting[],
  options: Omit<LiveReplayOptions, "setting">,
): Promise<LiveReplayResult[]> {
  const results: LiveReplayResult[] = [];
  for (const setting of settings) {
    options.log?.(`\n=== ${settingLabel(setting)} ===`);
    results.push(await runLiveReplay(game, { ...options, setting }));
  }
  return results;
}

// -----------------------------------------------------------------------------
// What a comparison will cost, before it spends anything.
// -----------------------------------------------------------------------------

/**
 * How much more output medium effort writes than low, for the estimate only:
 * thinking bills as output, and medium thinks more. A guess, said as one.
 */
const MEDIUM_OUTPUT_FACTOR = 2;

export interface LoggedTokens {
  calls: number;
  /** Every input token, cached or not. */
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
}

/** The game's own token counts, from its stats_reply records. */
export function loggedTokens(
  records: readonly { kind: string }[],
): LoggedTokens {
  const total: LoggedTokens = {
    calls: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
  };
  for (const record of records) {
    const reply = record as {
      kind: string;
      ok?: unknown;
      tokensIn?: unknown;
      tokensOut?: unknown;
      tokensCached?: unknown;
    };
    if (reply.kind !== "stats_reply" || reply.ok !== true) continue;
    total.calls += 1;
    total.tokensIn += count(reply.tokensIn);
    total.tokensOut += count(reply.tokensOut);
    total.tokensCached += count(reply.tokensCached);
  }
  return total;
}

/** Roughly what one replay at this setting costs, from the game's own token counts. */
export function estimateCost(
  tokens: LoggedTokens,
  setting: LiveStatsSetting,
): number {
  const rates = ratesFor(setting.model);
  const cached = Math.min(tokens.tokensCached, tokens.tokensIn);
  const output =
    tokens.tokensOut * (setting.effort === "medium" ? MEDIUM_OUTPUT_FACTOR : 1);
  return costOf(
    {
      inputTokens: tokens.tokensIn - cached,
      outputTokens: output,
      cacheWriteTokens: 0,
      cacheReadTokens: cached,
      costUsd: 0,
    },
    rates,
  );
}

// -----------------------------------------------------------------------------
// The comparison, as text.
// -----------------------------------------------------------------------------

/** The summary lines of each setting, side by side. */
export function summaryTable(results: readonly LiveReplayResult[]): string {
  const rows: Array<[string, (result: LiveReplayResult) => string]> = [
    ["Calls", (result) => String(result.calls)],
    ["Failed calls", (result) => String(result.failures)],
    ["Plays returned", (result) => String(result.playsReturned)],
    ["Plays read", (result) => String(result.plays.length)],
    ["Calls with no plays", (result) => String(result.emptyCalls)],
    ["Total cost", (result) => `$${result.usage.costUsd.toFixed(2)}`],
    ["Median s a call", (result) => median(result.seconds).toFixed(1)],
    ["Median s to stats", (result) => median(result.latencies).toFixed(1)],
  ];
  return table(
    ["", ...results.map((result) => settingLabel(result.setting))],
    rows.map(([title, cell]) => [title, ...results.map(cell)]),
  );
}

/** One row per player anyone credited, home first, then by jersey, with a column per setting. */
export function playerTable(results: readonly LiveReplayResult[]): string {
  const everyone = new Map<string, StatsRosterPlayer>();
  for (const result of results)
    for (const [id, player] of result.everyone) everyone.set(id, player);
  const ids = new Set<string>();
  for (const result of results)
    for (const id of result.totals.keys()) ids.add(id);
  if (ids.size === 0) return "Nobody was credited with anything.";
  const sorted = [...ids].sort((a, b) => {
    const pa = everyone.get(a);
    const pb = everyone.get(b);
    if (pa?.side !== pb?.side) return pa?.side === "home" ? -1 : 1;
    return (
      Number(pa?.jersey ?? 999) - Number(pb?.jersey ?? 999) ||
      a.localeCompare(b)
    );
  });
  return table(
    ["PLAYER", ...results.map((result) => settingLabel(result.setting))],
    sorted.map((id) => {
      const player = everyone.get(id);
      const name = player
        ? `${player.last.toUpperCase()}${player.jersey ? ` #${player.jersey}` : ""} (${player.side === "home" ? "H" : "A"})`
        : id;
      return [
        name,
        ...results.map((result) => compactLine(result.totals.get(id))),
      ];
    }),
  );
}

/** A player's night in one short cell: "14/18 158py 1ptd · 4car 20ry". */
export function compactLine(tally: TonightTally | undefined): string {
  if (!tally) return "";
  const s = tally.stats;
  const n = (key: FootballStatKey) => s[key] ?? 0;
  const has = (...keys: FootballStatKey[]) => keys.some((key) => n(key) !== 0);
  const parts: string[] = [];
  const with_ = (base: string, extra: Array<[FootballStatKey, string]>) =>
    [
      base,
      ...extra
        .filter(([key]) => n(key) !== 0)
        .map(([key, label]) => `${n(key)}${label}`),
    ].join(" ");
  if (has("pass_att", "pass_cmp"))
    parts.push(
      with_(`${n("pass_cmp")}/${n("pass_att")} ${n("pass_yds")}py`, [
        ["pass_td", "ptd"],
        ["pass_int", "int"],
      ]),
    );
  if (has("rush_att"))
    parts.push(
      with_(`${n("rush_att")}car ${n("rush_yds")}ry`, [["rush_td", "rtd"]]),
    );
  if (has("rec"))
    parts.push(with_(`${n("rec")}rec ${n("rec_yds")}y`, [["rec_td", "td"]]));
  const defense = (
    [
      ["tkl", "tkl"],
      ["sacks", "sk"],
      ["def_int", "int"],
      ["pbu", "pbu"],
      ["ff", "ff"],
      ["fr", "fr"],
    ] as Array<[FootballStatKey, string]>
  ).filter(([key]) => n(key) !== 0);
  if (defense.length > 0)
    parts.push(defense.map(([key, label]) => `${n(key)}${label}`).join(" "));
  if (has("fum")) parts.push(`${n("fum")}fum`);
  if (has("fga")) parts.push(`${n("fgm")}/${n("fga")}fg`);
  if (has("xpa")) parts.push(`${n("xpm")}/${n("xpa")}xp`);
  if (has("punts")) parts.push(`${n("punts")}p ${n("punt_yds")}y`);
  if (has("kr")) parts.push(`${n("kr")}kr ${n("kr_yds")}y`);
  if (has("pr")) parts.push(`${n("pr")}pr ${n("pr_yds")}y`);
  return parts.join(" · ");
}

function table(header: string[], body: string[][]): string {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...body.map((row) => row[column].length)),
  );
  const line = (row: string[]) =>
    row
      .map((value, column) => value.padEnd(widths[column]))
      .join("  ")
      .trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...body.map(line),
  ].join("\n");
}

/** "  3:05" from the start of the game. */
function stamp(offsetMs: number): string {
  const seconds = Math.max(0, Math.round(offsetMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(3, " ")}:${String(seconds % 60).padStart(2, "0")}`;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}
