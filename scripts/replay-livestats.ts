// Replays a downloaded V3 browser log through live stats, the way a game would
// have run it, and prints every play, what it did to each player, a per-player
// totals table, and what it cost.
//
//   npm run replay:stats -- ~/Downloads/spotter-log-20261001-1715-ab12cd34.json
//   npm run replay:stats -- <log.json> --model anthropic/claude-haiku-5.5 --effort medium
//   npm run replay:stats -- <log.json> --compare
//   npm run replay:stats -- <log.json> --dry
//   npm run replay:stats -- <log.json> --recorded
//   npm run replay:stats -- <log.json> --recorded --replies ~/SpotterTestSet/runs/x/<log>.plays.json
//   npm run replay:stats -- <log.json> --plays-json ~/SpotterTestSet/plays.json
//
// The log is the .json from Download on Past games. --dry makes no calls: it
// prints when the live loop would have asked and how big each window was,
// which costs nothing and says whether the timing is right before any money
// is spent. --recorded makes no calls either: it takes the plays the model
// returned that night (the log's stats_reply records), runs them through
// today's check (lib/livestats/check.ts) and stat rules, and prints the
// per-player totals the game counted beside what the same replies count now,
// and every event the code matched, filled in or dropped, with its rule.
// --recorded --replies <a v6 run's plays file> (Oct 22) makes no calls: it
// re-runs that run's recorded replies through today's whole loop, each
// request answered with the reply the run got for the same look and lines,
// on the run's own clock, and says how many requests the record did not have.
// Without either it needs OPENROUTER_API_KEY, which npm run replay:stats reads
// from .env.local, and reads with --model and --effort (an allowed setting,
// lib/livestats/settings.ts; Gemini 3.8 Flash at minimal when left out). --compare runs
// the log once per allowed setting, one after another, after saying roughly
// what it will spend and asking for "y", and prints them side by side.
// --plays-json <path> (a live replay, or a dry one under --pipeline v7) also
// writes every play as the loop left it, after updates, dedupe, the check and
// the stat rules, to that one file (lib/livestats/playsJson.ts), and a run
// manifest beside it, refusing a path inside this repository. Under v7 the
// file also has every segment and every request as it was sent and answered.
// Ctrl-C, a kill or --max-cost (v7: the dollars at which a live replay stops)
// writes what there is so far, marked partial, and exits non-zero.
//
// It uses the same timing (lib/plays/window.ts), the same call
// (extractStatsPlaysOpenRouter) and the same readPlays as the live loop
// (lib/livestats/liveReplay.ts), so what it prints is what the live screen
// would have counted with every play OK'd.
//
// PRIVACY: the log is a recording of somebody naming minors. This reads it from
// disk, sends windows of it to OpenRouter exactly as a live game would, prints to
// this terminal, and writes nothing anywhere, unless --plays-json names a file
// outside this repository, which then gets the plays and nothing else.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { formatCost } from "@/lib/livestats/cost";
import { buildManifest, manifestPathFor, summarizeLatency } from "@/lib/livestats/manifest";
import { describeLoggedDrop, playerLabel } from "@/lib/livestats/describe";
import {
  estimateCost,
  everyoneIn,
  isVoid,
  REPLAY_VOID_SHARE,
  loggedTokens,
  median,
  playerTable,
  runComparison,
  runLiveReplay,
  summaryTable,
  type LiveReplayResult,
  type ReplayExtract,
} from "@/lib/livestats/liveReplay";
import { extractSegmentOpenRouter, extractStatsPlaysWithRetries, extractTwoReaders } from "@/lib/livestats/openrouter";
import { parseReplayArgs, ReplayArgsError } from "@/lib/livestats/replayArgs";
import { recordedReplies, recordedSegmentExtract, replayRecorded } from "@/lib/livestats/recorded";
import { playsJsonPathProblem, replayPlaysFile, type PartialRun } from "@/lib/livestats/playsJson";
import { readReplayLog, ReplayLogError, type ReplayGame } from "@/lib/livestats/replayLog";
import { replayableLog } from "@/lib/log/sharedReplay";
import { arbiterSetting, DEFAULT_V7_MODEL_B, guessBackSetting, parseSetting, readerBSetting, settingLabel, twoReaderRules, v7Settings, type V7Settings } from "@/lib/livestats/settings";
import { NO_USAGE, type StatsRosterPlayer, type StatsUsage } from "@/lib/livestats/types";
import type { FootballStatKey } from "@/lib/cards/statKeys";
import type { TonightTally } from "@/lib/cards/tonight";

/** Between OpenRouter calls in a replay. */
const PACE_MS = 2_500;

const REPO_ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "..");

/** The columns the NFL comparison reads (docs/BUILD_LIST.md item 15), in box score order. */
const COLUMNS: Array<{ title: string; keys: FootballStatKey[]; join?: string }> = [
  { title: "C/ATT", keys: ["pass_cmp", "pass_att"], join: "/" },
  { title: "PASS YDS", keys: ["pass_yds"] },
  { title: "PASS TD", keys: ["pass_td"] },
  { title: "INT THR", keys: ["pass_int"] },
  { title: "CAR", keys: ["rush_att"] },
  { title: "RUSH YDS", keys: ["rush_yds"] },
  { title: "RUSH TD", keys: ["rush_td"] },
  { title: "REC", keys: ["rec"] },
  { title: "REC YDS", keys: ["rec_yds"] },
  { title: "REC TD", keys: ["rec_td"] },
  { title: "TKL", keys: ["tkl"] },
  { title: "SACK", keys: ["sacks"] },
  { title: "PBU", keys: ["pbu"] },
  { title: "INT", keys: ["def_int"] },
  { title: "FF", keys: ["ff"] },
  { title: "FR", keys: ["fr"] },
  { title: "FUM", keys: ["fum"] },
  { title: "KR YDS", keys: ["kr_yds"] },
  { title: "PR YDS", keys: ["pr_yds"] },
  { title: "RET TD", keys: ["kr_td", "pr_td", "int_td", "fr_td"], join: "+" },
  { title: "FG", keys: ["fgm", "fga"], join: "/" },
  { title: "XP", keys: ["xpm", "xpa"], join: "/" },
  { title: "PUNT YDS", keys: ["punt_yds"] },
];

async function main() {
  let args;
  try {
    args = parseReplayArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ReplayArgsError) fail(error.message);
    throw error;
  }
  // Checked before anything is read or spent, so a refused path costs nothing.
  const playsPath = args.playsJson === null ? null : playsJsonTarget(args.playsJson);

  const raw = readFile(args.path);
  const game = parse(args.path, raw);
  if (args.mode === "recorded" && args.pipeline !== "v7" && args.replies === null) {
    replayFromRecord(raw, game);
    return;
  }

  const everyone = everyoneIn(game);
  // Two readers (Oct 26): LIVE_STATS_READER_B, off unless set; the arbiter's effort from LIVE_STATS_ARBITER_EFFORT.
  const readerB = args.pipeline === "v6" ? readerBSetting(process.env) : null;
  const arbiter = arbiterSetting(process.env);
  const rules = twoReaderRules(process.env);
  if (readerB && (rules.disagree !== "arbiter" || rules.swap)) console.log(`Two readers' rules: disagreements go to ${rules.disagree === "arbiter" ? "the arbiter" : `reader ${rules.disagree.toUpperCase()}`}${rules.swap ? ", with reader B treated as A" : ""}.`);
  // R51 (v6): LIVE_STATS_GUESS_RB, off unless set.
  const guessBack = args.pipeline === "v6" && guessBackSetting(process.env);
  if (guessBack) console.log("LIVE_STATS_GUESS_RB is on: a run nobody was named for goes to tonight's leading rusher (R51).");
  const minutes = Math.max(1, (game.utterances.at(-1)?.offsetMs ?? 0) / 60_000);
  console.log(
    `${game.away || "Away"} at ${game.home || "Home"}: ${game.utterances.length} utterances, ` +
      `${everyone.size} players, ${Math.round(minutes)} minutes, ${game.rosters.length} roster load(s).`,
  );
  if (game.sport && game.sport !== "football") console.log(`Sport is ${game.sport}. Live stats are football only; replaying anyway.`);
  if (game.rosters.some((roster) => !roster.fullRoster)) {
    console.log(
      "This log only has the players who were spotted, so offensive linemen and anyone else with spotting off\n" +
        "are not on the roster here and cannot be credited. Logs from item 13 on carry both full rosters.",
    );
  }
  console.log("");

  // v7's settings: the server's environment, with the flags laid over it.
  const v7: V7Settings | null =
    args.pipeline === "v7"
      ? {
          ...v7Settings(process.env),
          modelA: args.setting,
          ...(args.modelB !== undefined ? { modelB: args.modelB } : args.reconcile === "a" ? { modelB: null } : {}),
          reconcile: args.reconcile,
          allowInferredRb: args.inferRb,
          ...(args.maxCostUsd !== null ? { maxCostUsd: args.maxCostUsd } : {}),
        }
      : null;
  if (v7 && v7.reconcile !== "a" && v7.modelB === undefined) v7.modelB = DEFAULT_V7_MODEL_B;

  /** The plays file and the manifest beside it, for the result as it stands; partial when the run stopped short. */
  const writeOutputs = (result: LiveReplayResult, partial: PartialRun | null, recordedFrom: string | null = null) => {
    if (playsPath === null) return;
    const file = replayPlaysFile(result, game, partial);
    writeFileSync(playsPath, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`\nWrote ${file.plays.length} plays${file.segmentDetail ? ` and ${file.segmentDetail.length} segment reads` : ""} to ${playsPath}${partial ? ` (partial: ${partial.stoppedBy})` : ""}.`);
    const manifest = buildManifest({
      runId: args.runId,
      gitSha: gitSha(),
      now: new Date(),
      game,
      logName: nodePath.basename(args.path),
      pipeline: args.pipeline,
      setting: result.setting,
      modelB: v7?.modelB ?? readerB,
      tieBreak: v7 && v7.reconcile !== "ab-no-tiebreak" && v7.reconcile !== "a" ? v7.tieBreak : null,
      reconcile: v7?.reconcile ?? null,
      inferRb: v7?.allowInferredRb ?? guessBack,
      maxCostUsd: v7?.maxCostUsd ?? args.maxCostUsd,
      halftime: false,
      calls: result.callRecords,
      latencies: result.latencies,
      plays: {
        returned: result.playsReturned,
        read: result.plays.length,
        applied: result.plays.filter((play) => play.status === "applied").length,
        discarded: result.plays.filter((play) => play.status === "discarded").length,
      },
      counts: result.counts,
      partial,
      recordedFrom,
      void: isVoid(result),
      arbiter: result.arbiter,
    });
    const manifestPath = manifestPathFor(playsPath);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Wrote the run manifest to ${manifestPath}.`);
  };

  /** Ctrl-C or a kill mid-run: whatever the loop has so far is written, marked partial, before the process goes. */
  let peek: (() => LiveReplayResult) | null = null;
  const onSignal = (signal: NodeJS.Signals) => {
    console.log(`\n${signal}: stopping.`);
    if (peek) writeOutputs(peek(), { stoppedBy: "signal" });
    process.exit(130);
  };
  if (playsPath !== null) {
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  }

  // v6 --recorded --replies (Oct 22): a run's recorded replies through today's whole loop, with no network.
  if (args.mode === "recorded" && args.replies !== null) {
    let repliesPath: string;
    try {
      repliesPath = realpathSync(expandHome(args.replies));
    } catch {
      return fail(`--replies: ${args.replies} does not exist.`);
    }
    if (playsPath !== null && repliesPath === playsPath) fail("--plays-json would overwrite the run --replies reads from; write it somewhere else.");
    const recordedRun = readFile(repliesPath) as { calls?: unknown[] };
    if (!Array.isArray(recordedRun.calls)) fail(`${repliesPath} has no calls: it was written by v7 or before Oct 22, so its replies cannot be re-run.`);
    // The run's own setting and cap, from its manifest, unless the flags say otherwise.
    const manifestPath = manifestPathFor(repliesPath);
    const flags = existsSync(manifestPath) ? ((readFile(manifestPath) as { flags?: { model?: unknown; effort?: unknown; maxCostUsd?: unknown } }).flags ?? {}) : {};
    const ran = typeof flags.model === "string" && typeof flags.effort === "string" ? parseSetting(flags.model, flags.effort) : null;
    const setting = args.settingGiven ? args.setting : (ran ?? args.setting);
    const maxCostUsd = args.maxCostUsd ?? (typeof flags.maxCostUsd === "number" ? flags.maxCostUsd : null);
    const recorded = recordedReplies(recordedRun.calls as never, undefined, { readerB: readerB !== null, rules });
    if ((recordedRun.calls as Array<{ readers?: unknown }>).some((call) => call.readers)) console.log(readerB ? "Two readers: the merge is decided again by today's rules, the arbiter answered from the record." : "Reader B is off: reader A's recorded replies alone.");
    console.log(`Re-running the replies recorded in ${nodePath.basename(repliesPath)} (${settingLabel(setting)}) through today's code. Nothing is sent.`);
    const result = await runLiveReplay(game, {
      setting,
      extract: recorded.extract,
      rateLimitPauseMs: 0,
      guessBack,
      ...(maxCostUsd !== null ? { maxCostUsd } : {}),
      log: (line) => console.log(line),
      onStart: (snapshot) => (peek = snapshot),
    });
    printSummary(result, minutes);
    printTotals(result.totals, result.everyone);
    printCost(result.usage, result.calls, minutes);
    const misses = recorded.misses();
    const missed = Object.values(misses.byLook).reduce((sum, count) => sum + count, 0);
    const share = result.calls > 0 ? (100 * missed) / result.calls : 0;
    const byLook = Object.entries(misses.byLook).map(([look, count]) => `${count} ${look}`).join(", ");
    console.log(`Answered from the record: ${misses.answered}. Not in the record: ${missed} (${share.toFixed(1)}% of ${result.calls} calls${byLook ? `: ${byLook}` : ""}), each read as no plays.`);
    if (misses.arbiter > 0) console.log(`Arbiter decisions not in the record: ${misses.arbiter} (reader A stood for each).`);
    if (share > 5) console.log("Over 5% of today's requests were never made by the recorded run: this re-run cannot vouch for the change. Use a paid run.");
    writeOutputs(result, null, nodePath.basename(repliesPath));
    return;
  }

  // v7 --recorded (fix 1, Part 6): a run's recorded answers through today's code, with no network.
  if (args.mode === "recorded" && v7) {
    const answersPath = realpathSync(expandHome(args.answers!));
    if (playsPath !== null && answersPath === playsPath) fail("--plays-json would overwrite the run --answers reads from; write it somewhere else.");
    const recordedRun = readFile(answersPath) as { segmentDetail?: unknown[] };
    if (!Array.isArray(recordedRun.segmentDetail)) fail(`${answersPath} has no segmentDetail: it was written before fix 1 (Oct 20), so its answers cannot be re-run.`);
    const manifestPath = manifestPathFor(answersPath);
    const manifest = existsSync(manifestPath) ? (readFile(manifestPath) as { calls?: unknown[] }) : null;
    const recorded = recordedSegmentExtract({ segmentDetail: recordedRun.segmentDetail as never, ...(manifest && Array.isArray(manifest.calls) ? { calls: manifest.calls as never } : {}) });
    console.log(`Re-running the answers recorded in ${nodePath.basename(answersPath)} through today's code. Nothing is sent.`);
    const result = await runLiveReplay(game, {
      setting: args.setting,
      extract: async () => ({ plays: [], usage: NO_USAGE }),
      pipeline: "v7",
      extractSegment: recorded.extract,
      now: recorded.now,
      maxCostUsd: v7.maxCostUsd,
      allowInferredRb: v7.allowInferredRb,
      log: (line) => console.log(line),
      onStart: (snapshot) => (peek = snapshot),
    });
    printSummary(result, minutes);
    printCost(result.usage, result.calls, minutes);
    const misses = recorded.misses();
    const missed = Object.entries(misses.byLook).map(([look, count]) => `${count} ${look}`).join(", ");
    console.log(`Answered from the record: ${misses.answered}. Not in the record: ${missed || "none"} (a re-read keeps its answer; anything else is not a play).`);
    writeOutputs(result, null, nodePath.basename(answersPath));
    return;
  }

  if (args.mode === "dry") {
    const result = await runLiveReplay(game, {
      setting: args.setting,
      extract: async () => ({ plays: [], usage: NO_USAGE }),
      ...(v7 ? { pipeline: "v7" as const, extractSegment: async () => ({ ok: true as const, answer: { playType: "not_a_play" as const, carrierIdx: null, passerIdx: null, receiverIdx: null, tacklerIdx: null, yardsSaid: null, touchdown: false, penalty: "none" as const, confidence: "high" as const }, agreement: "dry", calls: [], usedB: false }) } : {}),
      log: (line) => console.log(line),
      onStart: (snapshot) => (peek = snapshot),
    });
    console.log(`\n${v7 ? `${result.calls} segment reads (${result.segments.length} segments${result.segmenter ? `, ${result.segmenter.joined} recaps joined to the play before, ${result.segmenter.joinedAfterSend} of them after it was sent` : ""})` : `${result.calls} calls`} would have been made. Nothing was sent.`);
    writeOutputs(result, null);
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) fail("OPENROUTER_API_KEY is not set. Run it through npm run replay:stats, which reads .env.local, or use --dry to make no calls.");
  // Two readers and an arbiter (Oct 26) when LIVE_STATS_READER_B names a second reader; else one, as always.
  const extract: ReplayExtract = readerB
    ? (request, setting) => extractTwoReaders(apiKey, request, { a: setting, b: readerB, arbiter, rules })
    : (request, setting) => extractStatsPlaysWithRetries(apiKey, request, { setting });

  if (args.mode === "compare") {
    const tokens = loggedTokens((raw as { records: Array<{ kind: string }> }).records);
    const estimates = args.settings.map((setting) => ({ setting, usd: estimateCost(tokens, setting) }));
    const total = estimates.reduce((sum, each) => sum + each.usd, 0);
    console.log(`This replays the log ${args.settings.length} times, once per setting, one after another, through OpenRouter. It spends money.`);
    if (tokens.calls > 0) {
      console.log(`The game itself made ${tokens.calls} calls: ${tokens.tokensIn} tokens in (${tokens.tokensCached} cached), ${tokens.tokensOut} out. At those counts:`);
      for (const { setting, usd } of estimates) console.log(`  ${settingLabel(setting)}: about ${formatCost(usd)}`);
      console.log(`  In all: about ${formatCost(total)}. Medium effort is guessed at twice the output; the real figure may differ.`);
    } else {
      console.log("The log carries no token counts to estimate from. Expect well under a dollar a setting for a full game.");
    }
    console.log(`Each call waits ${PACE_MS / 1000} s after the last, so a full game takes a while per setting.`);
    if (!args.yes && !(await confirm('Type "y" to start: '))) {
      console.log("Nothing was sent.");
      return;
    }
    const results = await runComparison(game, args.settings, { extract, paceMs: PACE_MS, log: (line) => console.log(line) });
    console.log("\n" + summaryTable(results) + "\n");
    console.log(playerTable(results) + "\n");
    return;
  }

  const extractSegment = v7 ? (request: Parameters<typeof extractSegmentOpenRouter>[1]) => extractSegmentOpenRouter(apiKey, request, v7, fetch) : undefined;
  console.log(
    v7
      ? `Reading with v7: reader A ${settingLabel(args.setting)}${v7.modelB ? `, reader B ${settingLabel(v7.modelB)}, tie-break ${settingLabel(v7.tieBreak)}` : ", reader A alone"} (${v7.reconcile}${v7.allowInferredRb ? ", RB prior on" : ""}, cap ${formatCost(v7.maxCostUsd)}) through OpenRouter.`
      : `Reading with ${settingLabel(args.setting)}${readerB ? `, reader B ${settingLabel(readerB)} and the arbiter at ${settingLabel(arbiter)}` : ""} through OpenRouter.`,
  );
  const result = await runLiveReplay(game, {
    setting: args.setting,
    extract,
    ...(v7 && extractSegment ? { pipeline: "v7" as const, extractSegment, maxCostUsd: v7.maxCostUsd, allowInferredRb: v7.allowInferredRb, hardCapUsd: args.maxCostUsd } : { guessBack, ...(args.maxCostUsd !== null ? { maxCostUsd: args.maxCostUsd } : {}) }),
    paceMs: PACE_MS,
    log: (line) => console.log(line),
    onStart: (snapshot) => (peek = snapshot),
  });
  printSummary(result, minutes);
  printTotals(result.totals, result.everyone);
  printCost(result.usage, result.calls, minutes);
  const latency = summarizeLatency(result.latencies);
  if (latency.count > 0) console.log(`Seconds from a play's last line to its stats: p50 ${latency.p50}, p95 ${latency.p95} (${latency.count} plays).`);
  if (result.stoppedBy === "max_cost") console.log(`\nStopped at the cost cap (${formatCost(args.maxCostUsd ?? 0)}) before the end of the log.`);
  if (playsPath !== null) writeOutputs(result, result.stoppedBy ? { stoppedBy: result.stoppedBy } : null);
  else if (args.runId !== null) console.log(`\n--run-id ${args.runId}: the manifest is written beside --plays-json; add --plays-json <path> to keep it.`);
  // A run that stopped at the cap is not a finished game: v7_one.sh keeps only a run that exits 0.
  if (result.stoppedBy === "max_cost") process.exit(3);
}

/** "~/x" as the home folder's x, whatever the shell did with it. */
function expandHome(typed: string): string {
  return typed === "~" || typed.startsWith("~/") ? os.homedir() + typed.slice(1) : typed;
}

/** The commit this run came from, for the manifest; "unknown" outside a checkout. */
function gitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

/**
 * The plays file's absolute path, links resolved, or a refusal: its folder
 * must exist, and it may not be inside this repository (the plays name
 * players). "~/" is the home folder even when the shell left it alone.
 */
function playsJsonTarget(typed: string): string {
  const expanded = typed === "~" || typed.startsWith("~/") ? os.homedir() + typed.slice(1) : typed;
  const target = nodePath.resolve(expanded);
  let folder: string;
  try {
    folder = realpathSync(nodePath.dirname(target));
  } catch {
    return fail(`--plays-json: the folder ${nodePath.dirname(target)} does not exist.`);
  }
  const real = existsSync(target) ? realpathSync(target) : nodePath.join(folder, nodePath.basename(target));
  if (existsSync(real) && statSync(real).isDirectory()) fail(`--plays-json: ${real} is a folder; give a file name, like ${nodePath.join(real, "plays.json")}.`);
  const problem = playsJsonPathProblem(real, realpathSync(REPO_ROOT));
  if (problem) fail(problem);
  return real;
}

function printSummary(result: LiveReplayResult, minutes: number) {
  console.log(
    `\n${result.playsReturned} plays returned (${result.plays.length} after updates and dedupe) from ${result.calls} calls ` +
      `over ${Math.round(minutes)} minutes, ${result.failures} failed${result.retries > 0 ? ` after their retries (${result.retries} retries in all)` : ""}.`,
  );
  if (result.arbiter.calls > 0) {
    const picks = result.arbiter.picks;
    console.log(`Arbiter: ${result.arbiter.calls} calls, ${formatCost(result.arbiter.costUsd)}; picked A ${picks.a}, B ${picks.b}, the shared parts ${picks.parts}, neither ${picks.neither}, failed ${picks.failed}.`);
  }
  if (result.rateLimitPauses > 0) console.log(`Paused ${result.rateLimitPauses} time${result.rateLimitPauses === 1 ? "" : "s"} for a burst of rate limits.`);
  if (isVoid(result)) console.log(`VOID: ${((100 * result.failures) / result.calls).toFixed(1)}% of calls failed after their retries (over ${REPLAY_VOID_SHARE * 100}%). Score it, but never judge a part on it.`);
  console.log(`Calls that returned no plays: ${result.emptyCalls} of ${result.calls - result.failures}.`);
  console.log(`Total cost: ${formatCost(result.usage.costUsd)}. Median ${median(result.seconds).toFixed(1)} s a call.\n`);
}

/** One row per player who did anything, home first, then by jersey. Only the columns anyone has. */
function printTotals(totals: Map<string, TonightTally>, everyone: Map<string, StatsRosterPlayer>) {
  if (totals.size === 0) {
    console.log("Nobody was credited with anything.\n");
    return;
  }
  const rows = [...totals.entries()].sort(([a], [b]) => {
    const pa = everyone.get(a);
    const pb = everyone.get(b);
    if (pa?.side !== pb?.side) return pa?.side === "home" ? -1 : 1;
    return Number(pa?.jersey ?? 999) - Number(pb?.jersey ?? 999) || a.localeCompare(b);
  });
  const columns = COLUMNS.filter((column) => rows.some(([, tally]) => column.keys.some((key) => tally.stats[key])));

  const cell = (tally: TonightTally, column: (typeof COLUMNS)[number]) => {
    if (!column.keys.some((key) => tally.stats[key])) return "";
    const estimated = column.keys.some((key) => tally.estimated.includes(key));
    const values = column.keys.map((key) => num(tally.stats[key] ?? 0));
    const text = column.join === "+" ? num(column.keys.reduce((sum, key) => sum + (tally.stats[key] ?? 0), 0)) : values.join(column.join ?? "");
    return `${estimated ? "~" : ""}${text}`;
  };

  const header = ["PLAYER", "SIDE", ...columns.map((column) => column.title)];
  const body = rows.map(([playerId, tally]) => [
    playerLabel(playerId, everyone.get(playerId)),
    everyone.get(playerId)?.side ?? "?",
    ...columns.map((column) => cell(tally, column)),
  ]);
  const widths = header.map((title, index) => Math.max(title.length, ...body.map((row) => row[index].length)));
  const line = (row: string[]) => row.map((value, index) => (index < 2 ? value.padEnd(widths[index]) : value.padStart(widths[index]))).join("  ");
  console.log(line(header));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of body) console.log(line(row));
  console.log("~ means some of those yards were worked out from yard lines or phrasing, not said.\n");
}

function printCost(total: StatsUsage, calls: number, minutes: number) {
  const perCall = calls > 0 ? total.costUsd / calls : 0;
  console.log(
    `Tokens: ${total.inputTokens} in, ${total.cacheWriteTokens} cache write, ` +
      `${total.cacheReadTokens} cache read, ${total.outputTokens} out.`,
  );
  console.log(`Cache: ${total.cacheReadTokens > 0 ? "hitting" : "NOT HITTING, check the prefix is byte identical"}.`);
  console.log(`Cost: ${formatCost(total.costUsd)} for this replay, $${perCall.toFixed(4)} a call.`);
  console.log(
    `At ${(calls / minutes).toFixed(1)} calls a minute, a 150 minute game costs about ` +
      `${formatCost(perCall * (calls / minutes) * 150)}.`,
  );
  if (minutes < 20) console.log("That projection is from a short sample and will read high. The per-call figure is the real one.");
}

/**
 * --recorded: the replies the game got that night, through today's code. The
 * roster is every player the game ever had loaded, the latest version of each
 * winning, the same as the live replay uses.
 */
function replayFromRecord(raw: unknown, game: ReplayGame) {
  const records = (raw as { records: Array<{ kind: string }> }).records;
  const everyone = everyoneIn(game);
  const roster = [...everyone.values()];
  const result = replayRecorded(records, roster, { teams: game.teams });

  console.log(`${game.away || "Away"} at ${game.home || "Home"}: ${everyone.size} players.`);
  if (result.replies === 0) {
    console.log("This log has no recorded replies (no stats_reply records with plays), so there is nothing to replay. Nothing was sent.");
    return;
  }
  console.log(
    `${result.replies} recorded replies. The game read ${result.readByGame} plays from them; today's code reads ${result.plays.length}.\n` +
      "No call was made. The reader's newer fields are absent on a log written before them, so only the code's own checks apply here.\n",
  );

  console.log("BEFORE: what the game counted that night.\n");
  printTotals(result.before, everyone);
  console.log("AFTER: the same replies through today's check and the stat rules.\n");
  printTotals(result.after, everyone);

  if (result.notes.length === 0) {
    console.log("Nothing was moved, filled in or dropped.");
    return;
  }
  console.log("Matched, moved, filled in and dropped, with the rule:\n");
  let lastPlay = "";
  for (const { playId, summary, note } of result.notes) {
    if (playId !== lastPlay) {
      console.log(`  ${playId}  ${summary}`);
      lastPlay = playId;
    }
    console.log(`        ${note.kind ?? "dropped"}: ${describeLoggedDrop(note, roster)}`);
  }
  const counts = new Map<string, number>();
  for (const { note } of result.notes) counts.set(note.rule, (counts.get(note.rule) ?? 0) + 1);
  console.log(`\nBy rule: ${[...counts].sort().map(([rule, count]) => `${rule} ${count}`).join(", ")}.`);
}

async function confirm(question: string): Promise<boolean> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question(question)).trim().toLowerCase() === "y";
  } finally {
    prompt.close();
  }
}

function readFile(path: string): unknown {
  try {
    // A log pulled from shared_game_logs reads as a downloaded one (lib/log/sharedReplay.ts).
    return replayableLog(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    fail(`Could not read ${path}: ${describe(error)}`);
  }
}

function parse(path: string, parsed: unknown): ReplayGame {
  try {
    return readReplayLog(parsed);
  } catch (error) {
    if (error instanceof ReplayLogError) fail(`${path}: ${error.message}`);
    throw error;
  }
}

function num(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await main();
