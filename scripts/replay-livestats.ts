// Replays a downloaded V3 browser log through live stats, the way a game would
// have run it, and prints every play, what it did to each player, a per-player
// totals table, and what it cost.
//
//   npm run replay:stats -- ~/Downloads/spotter-log-20261001-1715-ab12cd34.json
//   npm run replay:stats -- <log.json> --dry
//   npm run replay:stats -- <log.json> --recorded
//
// The log is the .json from Download in the live screen's Log panel or on Past
// games. --dry makes no calls: it prints when the live loop would have asked
// and how big each window was, which costs nothing and says whether the timing
// is right before any money is spent. --recorded makes no calls either: it
// takes the plays the model returned that night (the log's stats_reply records),
// runs them through today's check (lib/livestats/check.ts) and stat rules, and
// prints the per-player totals the game counted beside what the same replies
// count now, and every event the code moved, filled in or dropped, with its
// rule. Without either flag it needs OPENROUTER_API_KEY, which npm run
// replay:stats reads from .env.local.
//
// It calls the same shouldAsk, windowFor, newPlays and advanceWatermark
// (lib/plays/window.ts) and the same extractStatsPlaysOpenRouter (lib/livestats/openrouter.ts)
// that the live loop does, and applies the same rules (lib/livestats/apply.ts),
// so what it prints is what the change strip would have shown.
//
// PRIVACY: the log is a recording of somebody naming minors. This reads it from
// disk, sends windows of it to OpenRouter exactly as a live game would, prints to
// this terminal, and writes nothing anywhere.

import { readFileSync } from "node:fs";
import { applyPlay, tonightTotals, type AppliedPlay } from "@/lib/livestats/apply";
import { formatCost, sumUsage } from "@/lib/livestats/cost";
import { describeDrop, describeLoggedDrop, describePlay, playerLabel } from "@/lib/livestats/describe";
import { replayRecorded } from "@/lib/livestats/recorded";
import { readReplayLog, ReplayLogError, type ReplayGame } from "@/lib/livestats/replayLog";
import type { ExtractStatsRequest, StatsPlay, StatsRosterPlayer, StatsUsage } from "@/lib/livestats/types";
import type { FootballStatKey } from "@/lib/cards/statKeys";
import type { TonightTally } from "@/lib/cards/tonight";
import type { Utterance } from "@/lib/plays/storage";
import { isPlayTalk, rosterNames } from "@/lib/livestats/playTalk";
import { extractStatsPlaysOpenRouter, OPENROUTER_TIMEOUT_MS } from "@/lib/livestats/openrouter";
import { advanceWatermark, isPlayBoundary, newPlays, NO_WATERMARK, shouldAsk, windowFor } from "@/lib/plays/window";

/** Between OpenRouter calls in a replay. */
const PACE_MS = 2_500;

/** How many applied plays go into the next call, as the live loop sends (spec 8.1). */
const RECENT_PLAYS = 5;

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
  const [path, ...flags] = process.argv.slice(2);
  if (!path) fail("Usage: npm run replay:stats -- <spotter-log.json> [--dry | --recorded]");
  const dry = flags.includes("--dry");
  const recorded = flags.includes("--recorded");

  const raw = readFile(path);
  const game = parse(path, raw);
  if (recorded) {
    replayFromRecord(raw, game);
    return;
  }
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!dry && !apiKey) {
    fail(`OPENROUTER_API_KEY is not set. Run it through npm run replay:stats, which reads .env.local, or use --dry to make no calls.`);
  }

  // window.ts takes the play feed's utterance shape; the extra fields are unused.
  const said: Utterance[] = game.utterances.map((utterance) => ({
    seq: utterance.seq,
    text: utterance.text,
    offsetMs: utterance.offsetMs,
    at: new Date(utterance.at).toISOString(),
    connectionId: 1,
  }));
  // Everyone the game ever had loaded, the latest version of each player winning,
  // so a play read before a Refresh rosters still finds its players.
  const everyone = new Map<string, StatsRosterPlayer>();
  for (const roster of game.rosters) for (const player of roster.players) everyone.set(player.playerId, player);

  const minutes = Math.max(1, (said.at(-1)?.offsetMs ?? 0) / 60_000);
  console.log(
    `${game.away || "Away"} at ${game.home || "Home"}: ${said.length} utterances, ` +
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

  if (!dry) console.log("Reading with Claude Haiku 5.5 through OpenRouter.");
  const plays: StatsPlay[] = [];
  const applied: AppliedPlay[] = [];
  const spend: StatsUsage[] = [];
  let watermark = NO_WATERMARK;
  let lastCallAt = Number.NEGATIVE_INFINITY;
  let boundarySeen = false;
  let playTalkSeen = false;
  const namesByRoster = new Map<number, Set<string>>();
  let calls = 0;
  let failures = 0;

  for (let index = 0; index < said.length; index++) {
    const utterance = said[index];
    if (isPlayBoundary(utterance.text)) boundarySeen = true;
    const rosterIndex = game.utterances[index].roster;
    const roster = game.rosters[rosterIndex].players;
    if (!namesByRoster.has(rosterIndex)) namesByRoster.set(rosterIndex, rosterNames(roster));
    if (isPlayTalk(utterance.text, namesByRoster.get(rosterIndex)!)) playTalkSeen = true;

    // The log's own clock, so the calls land where they would have live.
    const now = utterance.offsetMs;
    if (!shouldAsk({ now, lastCallAt, boundarySeen, worthReading: playTalkSeen })) continue;

    const request: ExtractStatsRequest = {
      utterances: windowFor(said.slice(0, index + 1), watermark),
      rosters: roster,
      recentPlays: plays.slice(-RECENT_PLAYS).map((play) => ({ playId: `${play.seqStart}-${play.seqEnd}`, summary: play.summary })),
    };

    calls++;
    lastCallAt = now;
    const why = boundarySeen ? "down and distance" : "cadence";
    boundarySeen = false;
    playTalkSeen = false;

    if (dry) {
      console.log(
        `${clock(now)}  call ${calls} (${why}): ${request.utterances.length} utterances, ` +
          `seq ${request.utterances[0]?.seq}-${request.utterances.at(-1)?.seq}`,
      );
      continue;
    }

    let result;
    try {
      result = await extractStatsPlaysOpenRouter(apiKey!, request, AbortSignal.timeout(OPENROUTER_TIMEOUT_MS));
    } catch (error) {
      failures++;
      console.log(`${clock(now)}  call ${calls} (${why}): FAILED, ${describe(error)}`);
      continue;
    }

    // A replay asks as fast as it can, and a live game asks about once a minute:
    // a short pause keeps OpenRouter's rate limit out of what is being measured.
    await new Promise((resolve) => setTimeout(resolve, PACE_MS));

    spend.push(result.usage);
    const fresh = newPlays(result.plays, watermark);
    watermark = advanceWatermark(watermark, result.plays);

    const cached = result.usage.cacheReadTokens > 0 ? "cached" : "cold";
    console.log(
      `${clock(now)}  call ${calls} (${why}): ${request.utterances.length} in, ` +
        `${fresh.length} new of ${result.plays.length}, ${result.usage.outputTokens} out, ${cached}`,
    );
    for (const play of fresh) {
      const one = applyPlay(play, everyone);
      plays.push(play);
      applied.push(one);
      const sure = Math.round(play.confidence * 100);
      const flags = [play.playType, play.nullified ? "nullified" : null, play.touchdown ? "TD" : null].filter(Boolean);
      console.log(`            ${sure}%  ${play.summary}`);
      console.log(`                  seq ${play.seqStart}-${play.seqEnd} · ${flags.join(" · ")} · "${play.evidence}"`);
      console.log(`                  ${describePlay(one, [...everyone.values()]) || "(no stats)"}`);
      for (const drop of one.dropped) console.log(`                  ! ${describeDrop(drop, [...everyone.values()])}`);
    }
  }

  if (dry) {
    console.log(`\n${calls} calls would have been made. Nothing was sent.`);
    return;
  }

  console.log(`\n${plays.length} plays from ${calls} calls over ${Math.round(minutes)} minutes, ${failures} failed.\n`);
  printTotals(tonightTotals(plays, everyone), everyone);
  printDrops(applied);
  printCost(sumUsage(spend), calls, minutes);
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

function printDrops(applied: AppliedPlay[]) {
  const counts = new Map<string, number>();
  for (const one of applied) for (const drop of one.dropped) counts.set(drop.rule, (counts.get(drop.rule) ?? 0) + 1);
  const unknown = applied.filter((one) => one.yardsUnknown).length;
  if (counts.size === 0) console.log("No events dropped by a rule.");
  else console.log(`Dropped by rule: ${[...counts].map(([rule, count]) => `${rule} ${count}`).join(", ")}.`);
  console.log(`Plays with YDS ?: ${unknown} of ${applied.length}.\n`);
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
  const everyone = new Map<string, StatsRosterPlayer>();
  for (const roster of game.rosters) for (const player of roster.players) everyone.set(player.playerId, player);
  const roster = [...everyone.values()];
  const result = replayRecorded(records, roster);

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
  console.log("Moved, filled in and dropped, with the rule:\n");
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

function readFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
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

function clock(offsetMs: number): string {
  const seconds = Math.round(offsetMs / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(3, " ")}:${String(seconds % 60).padStart(2, "0")}`;
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
