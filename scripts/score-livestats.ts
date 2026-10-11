// Scores live stats against the box score for every game in a folder: replays
// each downloaded log (live, with the current reader, or --recorded with no
// network), matches players to the truth, and prints COUNT, YARDS and WRONG,
// one line per game and one combined line, so two runs compare at a glance.
//
//   npm run score:stats -- ~/SpotterTestSet
//   npm run score:stats -- ~/SpotterTestSet --recorded
//   npm run score:stats -- ~/SpotterTestSet --json
//
// The folder holds the logs (the .json from Download on Past games) and, next
// to each, a <same name>.truth.json (lib/livestats/truth.ts): either ESPN's
// game id, whose box score is fetched into memory, or the box score typed by
// hand on Spotter's stat keys. A log with no truth file beside it is skipped
// and said so.
//
// PRIVACY: the logs and the truth files name high school players. This reads
// them from disk, fetches ESPN's public box score when asked, sends windows of
// the transcript to OpenRouter exactly as a live game would (not with
// --recorded), prints to this terminal, and writes nothing anywhere: no
// copies, no caches, no fixtures. It refuses a folder inside this repository,
// so the test set can never be committed by mistake (.gitignore and
// test/testSetNotTracked.test.ts hold the line from the other side).

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { costOf, formatCost } from "@/lib/livestats/cost";
import { loggedTokens, runLiveReplay, type ReplayExtract } from "@/lib/livestats/liveReplay";
import { extractStatsPlaysOpenRouter, OPENROUTER_TIMEOUT_MS } from "@/lib/livestats/openrouter";
import { replayRecorded } from "@/lib/livestats/recorded";
import { readReplayLog, ReplayLogError, type ReplayGame } from "@/lib/livestats/replayLog";
import { combineScores, isInside, latencySeconds, scoreGame, scoreJson, scoreLine, type GameScore, type PlayerDetail } from "@/lib/livestats/score";
import { parseScoreArgs, ScoreArgsError } from "@/lib/livestats/scoreArgs";
import { ratesFor, settingLabel } from "@/lib/livestats/settings";
import { everyoneIn } from "@/lib/livestats/liveReplay";
import { espnSummaryUrl, parseTruthFile, TRUTH_KEYS, truthFromEspn, truthFromManual, TruthError, type Truth, type TruthKey } from "@/lib/livestats/truth";

/** Between OpenRouter calls in a live run, as the replay harness paces. */
const PACE_MS = 2_500;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  let args;
  try {
    args = parseScoreArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ScoreArgsError) fail(error.message);
    throw error;
  }

  let folder: string;
  try {
    folder = realpathSync(args.folder);
  } catch {
    return fail(`Cannot open ${args.folder}.`);
  }
  if (isInside(folder, realpathSync(REPO_ROOT))) {
    fail(
      `${folder} is inside this repository. The test set names high school players and must never be committed, ` +
        "so the scorer only reads a folder outside the repo (for example ~/SpotterTestSet).",
    );
  }

  const files = readdirSync(folder).filter((name) => name.endsWith(".json") && !name.endsWith(".truth.json")).sort();
  const games: Array<{ name: string; log: string; truth: string }> = [];
  for (const name of files) {
    const truth = path.join(folder, `${name.slice(0, -".json".length)}.truth.json`);
    if (!readdirSync(folder).includes(path.basename(truth))) {
      if (!args.json) console.log(`${name}: no ${path.basename(truth)} beside it, skipped.`);
      continue;
    }
    games.push({ name, log: path.join(folder, name), truth });
  }
  if (games.length === 0) fail(`No log with a truth file beside it in ${folder}.`);

  const apiKey = args.recorded ? null : process.env.OPENROUTER_API_KEY?.trim();
  if (!args.recorded && !apiKey) fail("OPENROUTER_API_KEY is not set. Run it through npm run score:stats, which reads .env.local, or use --recorded to make no calls.");
  const extract: ReplayExtract = (request, setting) =>
    extractStatsPlaysOpenRouter(apiKey!, request, AbortSignal.timeout(OPENROUTER_TIMEOUT_MS), fetch, setting);

  if (!args.json) {
    console.log(
      args.recorded
        ? `Replaying ${games.length} ${games.length === 1 ? "game's" : "games'"} recorded replies through today's code. No call is made.`
        : `Replaying ${games.length} ${games.length === 1 ? "game" : "games"} live with ${settingLabel(args.setting)} through OpenRouter. This spends money.`,
    );
  }

  const scores: GameScore[] = [];
  for (const entry of games) {
    const raw = readJson(entry.log);
    const game = parseLog(entry.log, raw);
    const truth = await readTruth(entry.truth);
    const label = entry.name.replace(/\.json$/, "");
    if (!args.json) {
      console.log(`\n== ${label}: ${game.away || "Away"} at ${game.home || "Home"}, ${game.utterances.length} lines, ${truth.players.length} players in the truth` + (truth.note ? `\n   Note: ${truth.note}` : ""));
    }
    const score = args.recorded ? scoreRecorded(label, raw, game, truth) : await scoreLive(label, game, truth, extract, args.setting, args.json ? () => undefined : (line) => console.log(line));
    scores.push(score);
    if (!args.json) {
      console.log(scoreLine(score));
      printDetail(score.detail);
      if (score.wrong.items.length > 0) {
        const everyone = everyoneIn(game);
        console.log("WRONG credits (player the truth gives none of that stat):");
        for (const item of score.wrong.items) {
          const player = everyone.get(item.playerId);
          console.log(`  ${player ? `${player.last.toUpperCase()} #${player.jersey ?? "?"} (${player.side === "home" ? "H" : "A"})` : item.playerId}  ${item.key} ${item.amount}`);
        }
      }
    }
  }

  const combined = combineScores(scores);
  if (args.json) {
    console.log(JSON.stringify({ games: scores.map(scoreJson), combined: scoreJson(combined) }, null, 2));
    return;
  }
  console.log("\nSUMMARY");
  for (const score of scores) console.log(scoreLine(score));
  console.log(scoreLine(combined));
  console.log("\nNothing was written to disk.");
}

function scoreRecorded(label: string, raw: unknown, game: ReplayGame, truth: Truth): GameScore {
  const records = (raw as { records: Array<{ kind: string }> }).records;
  const roster = [...everyoneIn(game).values()];
  const result = replayRecorded(records, roster);
  const tokens = loggedTokens(records);
  const cached = Math.min(tokens.tokensCached, tokens.tokensIn);
  const costUsd = costOf({ inputTokens: tokens.tokensIn - cached, outputTokens: tokens.tokensOut, cacheWriteTokens: 0, cacheReadTokens: cached, costUsd: 0 }, ratesFor(""));
  const atOf = new Map(game.utterances.map((utterance) => [utterance.seq, utterance.at]));
  return scoreGame(label, truth, result.after, roster, {
    calls: tokens.calls,
    costUsd,
    playsRead: result.plays.length,
    latencies: latencySeconds(result.plays, (seq) => atOf.get(seq)),
  });
}

async function scoreLive(
  label: string,
  game: ReplayGame,
  truth: Truth,
  extract: ReplayExtract,
  setting: Parameters<typeof runLiveReplay>[1]["setting"],
  log: (line: string) => void,
): Promise<GameScore> {
  const result = await runLiveReplay(game, { setting, extract, paceMs: PACE_MS, log });
  log(`${result.calls} calls, ${result.failures} failed, ${result.emptyCalls} with no plays, ${formatCost(result.usage.costUsd)}.`);
  return scoreGame(label, truth, result.totals, [...result.everyone.values()], {
    calls: result.calls,
    costUsd: result.usage.costUsd,
    playsRead: result.plays.length,
    latencies: result.latencies,
  });
}

/** Each truth player beside what Spotter found, on the keys the truth lists. For the terminal only. */
function printDetail(detail: readonly PlayerDetail[]) {
  if (detail.length === 0) return;
  const keys = TRUTH_KEYS.filter((key) => detail.some((row) => row.truth[key] !== undefined || row.found[key] !== undefined));
  const header = ["PLAYER", ...keys.map((key) => key.toUpperCase())];
  const cell = (row: PlayerDetail, key: TruthKey) => {
    const truth = row.truth[key];
    const found = row.found[key];
    if (truth === undefined && found === undefined) return "";
    const same = (truth ?? 0) === (found ?? 0);
    return same ? String(truth ?? found) : `${found ?? 0}/${truth ?? "-"}`;
  };
  const rows = [...detail]
    .sort((a, b) => (a.side !== b.side ? (a.side === "home" ? -1 : 1) : Number(a.jersey ?? 999) - Number(b.jersey ?? 999)))
    .map((row) => [
      `${row.side === "home" ? "H" : "A"}${row.jersey ? `#${row.jersey}` : ""} ${row.name}${row.playerId ? "" : " (not on the roster)"}`,
      ...keys.map((key) => cell(row, key)),
    ]);
  const widths = header.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index].length)));
  const line = (row: string[]) => row.map((value, index) => (index === 0 ? value.padEnd(widths[index]) : value.padStart(widths[index]))).join("  ");
  console.log("found/truth where they differ:");
  console.log(line(header));
  for (const row of rows) console.log(line(row));
}

async function readTruth(file: string): Promise<Truth> {
  let parsed;
  try {
    parsed = parseTruthFile(readJson(file));
  } catch (error) {
    if (error instanceof TruthError) fail(`${file}: ${error.message}`);
    throw error;
  }
  if (parsed.source === "manual") return truthFromManual(parsed);
  const url = espnSummaryUrl(parsed);
  let summary: unknown;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) fail(`ESPN answered HTTP ${response.status} for game ${parsed.gameId}.`);
    summary = await response.json();
  } catch (error) {
    fail(`Could not fetch ESPN's box score for game ${parsed.gameId}: ${describe(error)}`);
  }
  try {
    return truthFromEspn(summary, parsed.note);
  } catch (error) {
    if (error instanceof TruthError) fail(`ESPN game ${parsed.gameId}: ${error.message}`);
    throw error;
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`Could not read ${file}: ${describe(error)}`);
  }
}

function parseLog(file: string, raw: unknown): ReplayGame {
  try {
    return readReplayLog(raw);
  } catch (error) {
    if (error instanceof ReplayLogError) fail(`${file}: ${error.message}`);
    throw error;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await main();
