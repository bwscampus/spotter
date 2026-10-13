// Makes a test game from a transcript, so live stats can be scored on games
// nobody called live (Oct 13). Writes a browser log that `npm run score:stats`
// and `npm run replay:stats` read exactly like one downloaded from Past games,
// and, for a college or NFL game, the truth file beside it that points the
// scorer at ESPN's box score.
//
//   npm run make:game
//       asks for everything, one question at a time
//   npm run make:game -- game.json --espn https://www.espn.com/college-football/game/_/gameId/401856712
//   npm run make:game -- game.txt --home "Harborview" --home-roster home.csv --away "Millbrook" --away-roster away.csv
//
// The transcript can be Deepgram's JSON, captions (.srt or .vtt) or plain text
// (lib/testGames/transcript.ts). Rosters come from ESPN (lib/testGames/espn.ts)
// or from a CSV for each team (rosterFromCsv in lib/testGames/buildLog.ts).
//
// PRIVACY: a high school roster and transcript name minors. This reads them
// from disk, fetches ESPN's public JSON when given an ESPN game, and writes
// the made game only into a folder outside this repository (~/SpotterTestSet
// unless told otherwise), the same rule the scorer keeps.

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { readReplayLog } from "@/lib/livestats/replayLog";
import { isInside } from "@/lib/livestats/score";
import { cleanDraggedPath, MakeArgsError, parseMakeArgs, type MakeArgs } from "@/lib/testGames/args";
import { buildTestLog, RosterFileError, rosterFromCsv, testGameName } from "@/lib/testGames/buildLog";
import {
  espnGameSummaryUrl,
  EspnError,
  espnTeamIds,
  espnTeamRosterUrl,
  gameFromEspn,
  parseEspnLink,
  type EspnLeague,
  type TestTeam,
} from "@/lib/testGames/espn";
import { readTranscript, TranscriptError, type Transcript } from "@/lib/testGames/transcript";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = path.join(os.homedir(), "SpotterTestSet");
const FETCH_TIMEOUT_MS = 20_000;

/** Something the person can fix and try again; the message says how. */
class Problem extends Error {}

let prompt: Interface | null = null;
const interactive = process.stdin.isTTY === true;

async function ask(question: string): Promise<string> {
  if (!interactive) throw new Problem("This needs an answer, but the terminal cannot ask. Give every option on the command line (npm run make:game -- --help).");
  prompt ??= createInterface({ input: process.stdin, output: process.stdout });
  return (await prompt.question(question)).trim();
}

async function main() {
  let args: MakeArgs;
  try {
    args = parseMakeArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof MakeArgsError) fail(error.message);
    throw error;
  }

  console.log("\nSpotter: make a test game from a transcript\n");
  for (;;) {
    try {
      await makeOne(args);
    } catch (error) {
      if (!(error instanceof Problem || error instanceof TranscriptError || error instanceof EspnError || error instanceof RosterFileError)) throw error;
      console.log(`\n${error.message}\n`);
      if (!interactive) process.exit(1);
      if ((await ask("Try again? Type y and press Enter (or just Enter to stop): ")).toLowerCase() !== "y") break;
      args = { ...args, transcript: null, espn: null, homeRoster: null, awayRoster: null, home: null, away: null };
      continue;
    }
    if (!interactive || args.transcript !== null) break;
    if ((await ask("\nMake another game? Type y and press Enter (or just Enter to stop): ")).toLowerCase() !== "y") break;
  }
  prompt?.close();
}

async function makeOne(args: MakeArgs) {
  // 1. The transcript.
  const transcriptPath = args.transcript
    ? cleanDraggedPath(args.transcript)
    : cleanDraggedPath(await ask("Step 1. Drag the transcript file into this window, then press Enter:\n> "));
  const transcript = readTranscript(readText(transcriptPath, "transcript"));
  console.log(`  Read ${transcript.lines.length.toLocaleString()} lines (${describeFormat(transcript)}).`);

  // 2. The teams and rosters.
  const usingCsv = args.homeRoster !== null || args.awayRoster !== null;
  let espnLink = args.espn;
  if (espnLink === null && !usingCsv) {
    espnLink = await ask(
      "\nStep 2. Paste the ESPN link to this game (the page with the box score), then press Enter.\n" +
        "        If the game is not on ESPN (a high school game), type none and press Enter.\n> ",
    );
  }

  let home: TestTeam;
  let away: TestTeam;
  let tag: string;
  let truth: Record<string, unknown> | null = null;
  let startAt = Date.parse("2026-01-01T19:00:00Z");
  if (espnLink !== null && espnLink.toLowerCase() !== "none" && espnLink !== "") {
    const link = parseEspnLink(espnLink);
    if (!link) throw new Problem(`That doesn't look like an ESPN game link. It should look like https://www.espn.com/college-football/game/_/gameId/401856712 (or just the number at the end).`);
    console.log("  Getting the teams and rosters from ESPN...");
    const game = await fromEspn(link.gameId, link.league);
    home = game.home;
    away = game.away;
    tag = game.gameId;
    truth = { source: "espn", league: game.league, gameId: game.gameId };
    if (game.date !== null) startAt = game.date;
  } else {
    console.log("\n  No ESPN game, so the rosters come from a spreadsheet for each team (a .csv file with a header row:");
    console.log('  "Number", "First name", "Last name", "Position", or one "Name" column instead of the two name columns).\n');
    const homeName = args.home ?? (await ask("Step 2a. Type the HOME team's name, then press Enter:\n> "));
    const homeRoster = args.homeRoster ?? (await ask("Step 2b. Drag the HOME team's roster file here, then press Enter:\n> "));
    const awayName = args.away ?? (await ask("Step 2c. Type the AWAY team's name, then press Enter:\n> "));
    const awayRoster = args.awayRoster ?? (await ask("Step 2d. Drag the AWAY team's roster file here, then press Enter:\n> "));
    if (!homeName || !awayName) throw new Problem("Both teams need a name.");
    home = { school: homeName, mascot: null, players: rosterFromCsv(readText(cleanDraggedPath(homeRoster), "home roster")) };
    away = { school: awayName, mascot: null, players: rosterFromCsv(readText(cleanDraggedPath(awayRoster), "away roster")) };
    tag = path.basename(transcriptPath).replace(/\.[^.]+$/, "");
  }

  // 3. Where it goes.
  let outTyped = args.out;
  if (outTyped === null && interactive && args.transcript === null) {
    outTyped = await ask(`\nStep 3. Press Enter to save it in ${tildeOf(DEFAULT_OUT)} (or drag a different folder here, then press Enter):\n> `);
  }
  const outDir = path.resolve(outTyped ? cleanDraggedPath(outTyped) : DEFAULT_OUT);
  if (isInside(outDir, REPO_ROOT) || (existsSync(outDir) && isInside(realpathSync(outDir), realpathSync(REPO_ROOT)))) {
    throw new Problem(`${outDir} is inside the Spotter code folder. Test games name real players and must never be uploaded with the code, so pick a folder outside it, like ${tildeOf(DEFAULT_OUT)}.`);
  }
  mkdirSync(outDir, { recursive: true });

  // 4. Build it, check the replay reads it, write it.
  const gameId = randomUUID();
  const log = buildTestLog({ gameId, startAt, home, away, lines: transcript.lines, source: `transcript:${transcript.format}` });
  const json = JSON.stringify(log);
  const replay = readReplayLog(JSON.parse(json));

  const name = testGameName(away.school, home.school, tag);
  const logPath = path.join(outDir, `${name}.json`);
  const truthPath = path.join(outDir, `${name}.truth.json`);
  if (existsSync(logPath) && !args.force) {
    if (!interactive) throw new Problem(`${logPath} already exists. Add --force to replace it.`);
    const answer = await ask(`\n  ${path.basename(logPath)} is already there. Replace it? Type y and press Enter (or just Enter to keep the old one): `);
    if (answer.toLowerCase() !== "y") {
      console.log("  Kept the old one. Nothing was written.");
      return;
    }
  }
  writeFileSync(logPath, json);
  if (truth) writeFileSync(truthPath, `${JSON.stringify(truth, null, 2)}\n`);

  // 5. Say what was made and what to do next.
  const roster = replay.rosters[0].players;
  const count = (side: "home" | "away") => roster.filter((player) => player.side === side);
  const withPosition = (side: "home" | "away", positions: RegExp) => count(side).filter((player) => positions.test(player.position ?? "")).length;
  const minutes = Math.round((replay.utterances[replay.utterances.length - 1].offsetMs - replay.utterances[0].offsetMs) / 60_000);
  console.log(`\nDone. Made ${path.basename(logPath)}`);
  console.log(`  in ${tildeOf(outDir)}`);
  console.log(`  ${away.school} at ${home.school}: ${replay.utterances.length.toLocaleString()} lines over ${formatMinutes(minutes)}.`);
  for (const side of ["home", "away"] as const) {
    const team = side === "home" ? home : away;
    console.log(
      `  ${team.school} roster: ${count(side).length} players, ${withPosition(side, /^QB$/i)} quarterbacks, ${withPosition(side, /^(K|PK)$/i)} kickers, ${withPosition(side, /^P$/i)} punters.`,
    );
  }
  if (count("home").length === 0 || count("away").length === 0) console.log("  Warning: one team has no players, so nothing can be credited to it.");
  if (roster.every((player) => !player.position)) {
    console.log("  Warning: no player has a position, so the stats checks can't tell who the quarterback, kicker or punter is.");
  }
  if (!transcript.timed) {
    console.log("  Note: the transcript had no times, so the lines are spaced at an even talking pace. Plays and stats score fine;");
    console.log("        the 'seconds to stats' number won't mean anything for this game.");
  }
  if (transcript.numbersConverted) console.log("  Note: the transcript had no digits, so number words were written as digits (\"third and eight\" became \"3rd and 8\").");
  if (truth) {
    console.log(`  The box score comes from ESPN when it's scored (${path.basename(truthPath)}).`);
    console.log(`\nTo score every game in that folder:  npm run score:stats -- ${tildeOf(outDir)}`);
  } else {
    console.log(`\n  This game has no box score yet, so score:stats will skip it until a file named`);
    console.log(`  ${path.basename(truthPath)} sits beside it (see docs/TEST_GAMES.md, "High school games").`);
    console.log(`  You can still watch it read plays:  npm run replay:stats -- ${tildeOf(logPath)}`);
  }
}

async function fromEspn(gameId: string, league: EspnLeague | null) {
  const leagues: EspnLeague[] = league ? [league] : ["college-football", "nfl"];
  let summary: unknown = null;
  let found: EspnLeague | null = null;
  for (const candidate of leagues) {
    const answer = await getJson(espnGameSummaryUrl(candidate, gameId));
    if (answer !== null && isGame(answer)) {
      summary = answer;
      found = candidate;
      break;
    }
  }
  if (found === null) throw new Problem(`ESPN has no game ${gameId}, or couldn't be reached. Check the link and your internet connection.`);

  const ids = espnTeamIds(summary);
  const rosters = new Map<string, unknown>();
  for (const id of [ids.home, ids.away]) {
    const roster = await getJson(espnTeamRosterUrl(found, id));
    if (roster !== null) rosters.set(id, roster);
    else console.log(`  Warning: couldn't get one team's roster from ESPN; only the players in the box score are on it, with no positions.`);
  }
  return gameFromEspn(summary, found, gameId, rosters);
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function isGame(summary: unknown): boolean {
  try {
    espnTeamIds(summary);
    return true;
  } catch {
    return false;
  }
}

function readText(file: string, what: string): string {
  if (!file) throw new Problem(`No ${what} file was given.`);
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Problem(`Couldn't open the ${what} file at ${file}. Try dragging it into the window again.`);
  }
}

function describeFormat(transcript: Transcript): string {
  const kind = { deepgram: "Deepgram JSON", captions: "captions", text: "plain text" }[transcript.format];
  return transcript.timed ? `${kind}, with times` : `${kind}, no times`;
}

function formatMinutes(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function tildeOf(file: string): string {
  const home = os.homedir();
  return file === home || file.startsWith(`${home}${path.sep}`) ? `~${file.slice(home.length)}` : file;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await main();
