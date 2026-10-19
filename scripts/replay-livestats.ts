// Replays a downloaded V3 browser log through live stats, the way a game would
// have run it, and prints every play, what it did to each player, a per-player
// totals table, and what it cost.
//
//   npm run replay:stats -- ~/Downloads/spotter-log-20261001-1715-ab12cd34.json
//   npm run replay:stats -- <log.json> --model anthropic/claude-haiku-5.5 --effort medium
//   npm run replay:stats -- <log.json> --compare
//   npm run replay:stats -- <log.json> --dry
//   npm run replay:stats -- <log.json> --recorded
//
// The log is the .json from Download on Past games. --dry makes no calls: it
// prints when the live loop would have asked and how big each window was,
// which costs nothing and says whether the timing is right before any money
// is spent. --recorded makes no calls either: it takes the plays the model
// returned that night (the log's stats_reply records), runs them through
// today's check (lib/livestats/check.ts) and stat rules, and prints the
// per-player totals the game counted beside what the same replies count now,
// and every event the code matched, filled in or dropped, with its rule.
// Without either it needs OPENROUTER_API_KEY, which npm run replay:stats reads
// from .env.local, and reads with --model and --effort (an allowed setting,
// lib/livestats/settings.ts; Gemini 3.8 Flash at minimal when left out). --compare runs
// the log once per allowed setting, one after another, after saying roughly
// what it will spend and asking for "y", and prints them side by side.
//
// It uses the same timing (lib/plays/window.ts), the same call
// (extractStatsPlaysOpenRouter) and the same readPlays as the live loop
// (lib/livestats/liveReplay.ts), so what it prints is what the live screen
// would have counted with every play OK'd.
//
// PRIVACY: the log is a recording of somebody naming minors. This reads it from
// disk, sends windows of it to OpenRouter exactly as a live game would, prints to
// this terminal, and writes nothing anywhere.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { formatCost } from "@/lib/livestats/cost";
import { describeLoggedDrop, playerLabel } from "@/lib/livestats/describe";
import {
  estimateCost,
  everyoneIn,
  loggedTokens,
  median,
  playerTable,
  runComparison,
  runLiveReplay,
  summaryTable,
  type LiveReplayResult,
  type ReplayExtract,
} from "@/lib/livestats/liveReplay";
import { extractStatsPlaysOpenRouter, OPENROUTER_TIMEOUT_MS } from "@/lib/livestats/openrouter";
import { parseReplayArgs, ReplayArgsError } from "@/lib/livestats/replayArgs";
import { replayRecorded } from "@/lib/livestats/recorded";
import { readReplayLog, ReplayLogError, type ReplayGame } from "@/lib/livestats/replayLog";
import { replayableLog } from "@/lib/log/sharedReplay";
import { settingLabel } from "@/lib/livestats/settings";
import { NO_USAGE, type StatsRosterPlayer, type StatsUsage } from "@/lib/livestats/types";
import type { FootballStatKey } from "@/lib/cards/statKeys";
import type { TonightTally } from "@/lib/cards/tonight";

/** Between OpenRouter calls in a replay. */
const PACE_MS = 2_500;

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

  const raw = readFile(args.path);
  const game = parse(args.path, raw);
  if (args.mode === "recorded") {
    replayFromRecord(raw, game);
    return;
  }

  const everyone = everyoneIn(game);
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

  if (args.mode === "dry") {
    const result = await runLiveReplay(game, {
      setting: args.setting,
      extract: async () => ({ plays: [], usage: NO_USAGE }),
      log: (line) => console.log(line),
    });
    console.log(`\n${result.calls} calls would have been made. Nothing was sent.`);
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) fail("OPENROUTER_API_KEY is not set. Run it through npm run replay:stats, which reads .env.local, or use --dry to make no calls.");
  const extract: ReplayExtract = (request, setting) =>
    extractStatsPlaysOpenRouter(apiKey, request, AbortSignal.timeout(OPENROUTER_TIMEOUT_MS), fetch, setting);

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

  console.log(`Reading with ${settingLabel(args.setting)} through OpenRouter.`);
  const result = await runLiveReplay(game, { setting: args.setting, extract, paceMs: PACE_MS, log: (line) => console.log(line) });
  printSummary(result, minutes);
  printTotals(result.totals, result.everyone);
  printCost(result.usage, result.calls, minutes);
}

function printSummary(result: LiveReplayResult, minutes: number) {
  console.log(
    `\n${result.playsReturned} plays returned (${result.plays.length} after updates and dedupe) from ${result.calls} calls ` +
      `over ${Math.round(minutes)} minutes, ${result.failures} failed.`,
  );
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
