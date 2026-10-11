import type { TonightTally } from "@/lib/cards/tonight";
import type { FootballStatKey } from "@/lib/cards/statKeys";
import type { StatsRecord } from "@/lib/log/statsLog";
import { addUsage, costOf } from "./cost";
import { StatsController, type ExtractReply } from "./controller";
import type { ReplayGame } from "./replayLog";
import { talliesOf, type SessionPlay } from "./session";
import { ratesFor, settingLabel, type LiveStatsSetting } from "./settings";
import { NO_USAGE, type ExtractStatsRequest, type ExtractStatsResponse, type StatsRosterPlayer, type StatsUsage } from "./types";

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

/** One call, at one setting. Throws on a failure, which counts as a failed call. */
export type ReplayExtract = (request: ExtractStatsRequest, setting: LiveStatsSetting) => Promise<ExtractStatsResponse>;

export interface LiveReplayOptions {
  setting: LiveStatsSetting;
  extract: ReplayExtract;
  /** Between calls, to keep OpenRouter's rate limit out of what is measured. */
  paceMs?: number;
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
}

/** Everyone the game ever had loaded, the latest version of each player winning. */
export function everyoneIn(game: ReplayGame): Map<string, StatsRosterPlayer> {
  const everyone = new Map<string, StatsRosterPlayer>();
  for (const roster of game.rosters) for (const player of roster.players) everyone.set(player.playerId, player);
  return everyone;
}

/** The middle value, 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One replay of the log at one setting, through the real loop. */
export async function runLiveReplay(game: ReplayGame, options: LiveReplayOptions): Promise<LiveReplayResult> {
  const { setting, extract } = options;
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pace = options.paceMs ?? 0;

  const everyone = everyoneIn(game);
  const atOfSeq = new Map(game.utterances.map((utterance) => [utterance.seq, utterance.at]));
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
  };

  // The replay's clock: the log's wall clock, moved on by each call's real duration.
  let clock = game.utterances[0]?.at ?? 0;
  const first = clock;

  const controller = new StatsController({
    gameId: game.gameId || "replay",
    startedAt: first,
    roster: [],
    autoOk: true,
    retryAfterStopMs: REPLAY_RETRY_AFTER_STOP_MS,
    teams: game.teams,
    deps: {
      extract: async (request): Promise<ExtractReply> => {
        result.calls += 1;
        const call = result.calls;
        const started = now();
        const askedAt = clock;
        let reply: ExtractStatsResponse;
        try {
          reply = await extract(request, setting);
        } catch (error) {
          result.failures += 1;
          clock = Math.max(clock, askedAt + (now() - started));
          log(`${stamp(askedAt - first)}  call ${call}: FAILED, ${error instanceof Error ? error.message : String(error)}`);
          return { ok: false, code: error instanceof Error ? error.message : "unknown" };
        }
        const took = now() - started;
        result.seconds.push(took / 1000);
        clock = Math.max(clock, askedAt + took);
        result.usage = addUsage(result.usage, reply.usage);
        result.playsReturned += reply.plays.length;
        if (reply.plays.length === 0) result.emptyCalls += 1;
        log(`${stamp(askedAt - first)}  call ${call}: ${request.utterances.length} in, ${reply.plays.length} returned, ${reply.usage.outputTokens} out`);
        if (pace > 0) await sleep(pace);
        return { ok: true, plays: reply.plays, usage: reply.usage };
      },
      log: (record: StatsRecord) => {
        if (record.kind !== "stats_play") return;
        const said = atOfSeq.get(record.play.seqEnd);
        if (said !== undefined) result.latencies.push(Math.max(0, (record.at - said) / 1000));
        log(`            ${Math.round(record.play.confidence * 100)}%  ${record.play.summary}`);
      },
      readLog: async () => [],
      track: () => undefined,
      now: () => clock,
    },
  });
  await controller.start();

  let rosterIndex = -1;
  for (let index = 0; index < game.utterances.length; index++) {
    const utterance = game.utterances[index];
    if (utterance.roster !== rosterIndex) {
      rosterIndex = utterance.roster;
      controller.setRoster(game.rosters[rosterIndex].players);
    }
    // The live screen's timer, across the gap since the last line.
    while (clock + REPLAY_TICK_MS < utterance.at) {
      clock += REPLAY_TICK_MS;
      controller.tick();
      await controller.idle();
    }
    clock = Math.max(clock, utterance.at);
    controller.heard(utterance.text, utterance.at);
    await controller.idle();
  }
  // End game's last read, as the live screen does it.
  await controller.finish();
  await controller.idle();
  const session = controller.getView().session;
  controller.dispose();

  result.plays = session.plays;
  result.totals = talliesOf(session);
  return result;
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
export function loggedTokens(records: readonly { kind: string }[]): LoggedTokens {
  const total: LoggedTokens = { calls: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0 };
  for (const record of records) {
    const reply = record as { kind: string; ok?: unknown; tokensIn?: unknown; tokensOut?: unknown; tokensCached?: unknown };
    if (reply.kind !== "stats_reply" || reply.ok !== true) continue;
    total.calls += 1;
    total.tokensIn += count(reply.tokensIn);
    total.tokensOut += count(reply.tokensOut);
    total.tokensCached += count(reply.tokensCached);
  }
  return total;
}

/** Roughly what one replay at this setting costs, from the game's own token counts. */
export function estimateCost(tokens: LoggedTokens, setting: LiveStatsSetting): number {
  const rates = ratesFor(setting.model);
  const cached = Math.min(tokens.tokensCached, tokens.tokensIn);
  const output = tokens.tokensOut * (setting.effort === "medium" ? MEDIUM_OUTPUT_FACTOR : 1);
  return costOf({ inputTokens: tokens.tokensIn - cached, outputTokens: output, cacheWriteTokens: 0, cacheReadTokens: cached, costUsd: 0 }, rates);
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
  for (const result of results) for (const [id, player] of result.everyone) everyone.set(id, player);
  const ids = new Set<string>();
  for (const result of results) for (const id of result.totals.keys()) ids.add(id);
  if (ids.size === 0) return "Nobody was credited with anything.";
  const sorted = [...ids].sort((a, b) => {
    const pa = everyone.get(a);
    const pb = everyone.get(b);
    if (pa?.side !== pb?.side) return pa?.side === "home" ? -1 : 1;
    return Number(pa?.jersey ?? 999) - Number(pb?.jersey ?? 999) || a.localeCompare(b);
  });
  return table(
    ["PLAYER", ...results.map((result) => settingLabel(result.setting))],
    sorted.map((id) => {
      const player = everyone.get(id);
      const name = player ? `${player.last.toUpperCase()}${player.jersey ? ` #${player.jersey}` : ""} (${player.side === "home" ? "H" : "A"})` : id;
      return [name, ...results.map((result) => compactLine(result.totals.get(id)))];
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
    [base, ...extra.filter(([key]) => n(key) !== 0).map(([key, label]) => `${n(key)}${label}`)].join(" ");
  if (has("pass_att", "pass_cmp")) parts.push(with_(`${n("pass_cmp")}/${n("pass_att")} ${n("pass_yds")}py`, [["pass_td", "ptd"], ["pass_int", "int"]]));
  if (has("rush_att")) parts.push(with_(`${n("rush_att")}car ${n("rush_yds")}ry`, [["rush_td", "rtd"]]));
  if (has("rec")) parts.push(with_(`${n("rec")}rec ${n("rec_yds")}y`, [["rec_td", "td"]]));
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
  if (defense.length > 0) parts.push(defense.map(([key, label]) => `${n(key)}${label}`).join(" "));
  if (has("fum")) parts.push(`${n("fum")}fum`);
  if (has("fga")) parts.push(`${n("fgm")}/${n("fga")}fg`);
  if (has("xpa")) parts.push(`${n("xpm")}/${n("xpa")}xp`);
  if (has("punts")) parts.push(`${n("punts")}p ${n("punt_yds")}y`);
  if (has("kr")) parts.push(`${n("kr")}kr ${n("kr_yds")}y`);
  if (has("pr")) parts.push(`${n("pr")}pr ${n("pr_yds")}y`);
  return parts.join(" · ");
}

function table(header: string[], body: string[][]): string {
  const widths = header.map((title, column) => Math.max(title.length, ...body.map((row) => row[column].length)));
  const line = (row: string[]) => row.map((value, column) => value.padEnd(widths[column])).join("  ").trimEnd();
  return [line(header), widths.map((width) => "-".repeat(width)).join("  "), ...body.map(line)].join("\n");
}

/** "  3:05" from the start of the game. */
function stamp(offsetMs: number): string {
  const seconds = Math.max(0, Math.round(offsetMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(3, " ")}:${String(seconds % 60).padStart(2, "0")}`;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
