import type { TonightTally } from "@/lib/cards/tonight";
import type { FootballStatKey } from "@/lib/cards/statKeys";
import type { Utterance } from "@/lib/plays/storage";
import { advanceWatermark, isPlayBoundary, NO_WATERMARK, shouldAsk, windowFor } from "@/lib/plays/window";
import { addUsage, costOf } from "./cost";
import { isPlayTalk, rosterNames } from "./playTalk";
import type { ReplayGame } from "./replayLog";
import { EMPTY_SESSION, freshReads, okPlay, readPlays, recentPlays, talliesOf, type SessionPlay, type StatsSession } from "./session";
import { ratesFor, settingLabel, type LiveStatsSetting } from "./settings";
import { NO_USAGE, type ExtractStatsRequest, type ExtractStatsResponse, type StatsRosterPlayer, type StatsUsage } from "./types";

// =============================================================================
// Replaying a downloaded log through the reader, live (Oct 10): the same
// timing as the live loop (lib/plays/window.ts, the play-talk filter), the
// request it would send, and the reply read in through readPlays, so the
// check and the stat rules apply exactly as on the live screen, every play
// counted as autoOk counts it. The call is handed in, so a test can run it
// with a fake wire and the harness (scripts/replay-livestats.ts) with the real
// one at any allowed setting. Writes nothing anywhere; the harness prints.
// =============================================================================

/** How many applied plays go into the next call, as the live loop sends (spec 8.1). */
const RECENT_PLAYS = 5;

/** One call, at one setting. Throws on a failure, which counts as a failed call. */
export type ReplayExtract = (request: ExtractStatsRequest, setting: LiveStatsSetting) => Promise<ExtractStatsResponse>;

export interface LiveReplayOptions {
  setting: LiveStatsSetting;
  extract: ReplayExtract;
  /** Between calls, to keep OpenRouter's rate limit out of what is measured. */
  paceMs?: number;
  /** Each line of progress, for the harness to print. */
  log?: (line: string) => void;
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

/** One replay of the log at one setting. */
export async function runLiveReplay(game: ReplayGame, options: LiveReplayOptions): Promise<LiveReplayResult> {
  const { setting, extract } = options;
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pace = options.paceMs ?? 0;

  // window.ts takes the play feed's utterance shape; the extra fields are unused.
  const said: Utterance[] = game.utterances.map((utterance) => ({
    seq: utterance.seq,
    text: utterance.text,
    offsetMs: utterance.offsetMs,
    at: new Date(utterance.at).toISOString(),
    connectionId: 1,
  }));
  const everyone = everyoneIn(game);
  const rosterList = [...everyone.values()];

  let session: StatsSession = EMPTY_SESSION;
  let watermark = NO_WATERMARK;
  let lastCallAt = Number.NEGATIVE_INFINITY;
  let boundarySeen = false;
  let playTalkSeen = false;
  const namesByRoster = new Map<number, Set<string>>();
  const result: LiveReplayResult = {
    setting,
    calls: 0,
    failures: 0,
    emptyCalls: 0,
    playsReturned: 0,
    plays: [],
    usage: NO_USAGE,
    seconds: [],
    totals: new Map(),
    everyone,
  };

  for (let index = 0; index < said.length; index++) {
    const utterance = said[index];
    if (isPlayBoundary(utterance.text)) boundarySeen = true;
    const rosterIndex = game.utterances[index].roster;
    const roster = game.rosters[rosterIndex].players;
    if (!namesByRoster.has(rosterIndex)) namesByRoster.set(rosterIndex, rosterNames(roster));
    if (isPlayTalk(utterance.text, namesByRoster.get(rosterIndex)!)) playTalkSeen = true;

    // The log's own clock, so the calls land where they would have live.
    const at = utterance.offsetMs;
    if (!shouldAsk({ now: at, lastCallAt, boundarySeen, worthReading: playTalkSeen })) continue;

    const window = windowFor(said.slice(0, index + 1), watermark);
    const request: ExtractStatsRequest = {
      utterances: window,
      // As the live loop sends them: who can be credited, not their season numbers.
      rosters: roster.map((player) => ({
        playerId: player.playerId,
        side: player.side,
        jersey: player.jersey,
        first: player.first,
        last: player.last,
        position: player.position,
        ...(player.aliases?.length ? { aliases: player.aliases } : {}),
      })),
      recentPlays: recentPlays(session, RECENT_PLAYS),
    };
    result.calls += 1;
    lastCallAt = at;
    const why = boundarySeen ? "down and distance" : "cadence";
    boundarySeen = false;
    playTalkSeen = false;

    let reply: ExtractStatsResponse;
    const started = now();
    try {
      reply = await extract(request, setting);
    } catch (error) {
      result.failures += 1;
      log(`${clock(at)}  call ${result.calls} (${why}): FAILED, ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    result.seconds.push((now() - started) / 1000);
    if (pace > 0) await sleep(pace);

    result.usage = addUsage(result.usage, reply.usage);
    result.playsReturned += reply.plays.length;
    if (reply.plays.length === 0) result.emptyCalls += 1;

    // Read in as the live loop reads a reply: updates by id or by lines come
    // through below the watermark, and every new play is counted at once.
    const recentIds = new Set(request.recentPlays.map((play) => play.playId));
    const fresh = freshReads(reply.plays, session, watermark, recentIds);
    watermark = advanceWatermark(watermark, reply.plays);
    const read = readPlays(session, fresh, rosterList, at, {
      utterances: said.slice(0, index + 1).map(({ seq, text, offsetMs }) => ({ seq, text, offsetMs })),
      readThrough: window.at(-1)?.seq ?? utterance.seq,
    });
    session = read.session;
    for (const play of read.added) session = okPlay(session, at, play.playId).session;

    log(
      `${clock(at)}  call ${result.calls} (${why}): ${window.length} in, ${read.added.length} new and ` +
        `${read.updated.length} updated of ${reply.plays.length}, ${reply.usage.outputTokens} out`,
    );
    for (const play of read.added) log(`            ${Math.round(play.play.confidence * 100)}%  ${play.play.summary}`);
  }

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

function clock(offsetMs: number): string {
  const seconds = Math.round(offsetMs / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(3, " ")}:${String(seconds % 60).padStart(2, "0")}`;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
