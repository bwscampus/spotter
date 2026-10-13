import { keyedRoster, type KeyedSource } from "@/lib/cards/playerKey";
import { buildTeamCues } from "@/lib/game/teamCues";
import { withoutSuffix } from "@/lib/rosters/suffix";
import { parseCsv } from "@/lib/rosters/tableText";
import type { TestTeam } from "./espn";
import type { TranscriptLine } from "./transcript";

// =============================================================================
// A browser log made from a transcript and two rosters (Oct 13, `npm run
// make:game`), so `npm run score:stats` and `npm run replay:stats` can run a
// game nobody called live.
//
// It holds exactly what the replay reads (lib/livestats/replayLog.ts): one game
// record, whose snapshot carries the team names, the team cues and both full
// rosters as statsRoster (the shape buildGame writes), then one utterance
// record per line, on a wall clock from kickoff. The watchlist is empty: the
// card path is not what these games test, and `check:cards` needs a real log.
// `madeFrom` says the log was made, not downloaded.
//
// Pure: the script writes the file.
// =============================================================================

export interface TestLogInput {
  gameId: string;
  /** Wall clock of the first line, ms. */
  startAt: number;
  home: TestTeam;
  away: TestTeam;
  lines: readonly TranscriptLine[];
  /** What the transcript was, for `madeFrom`. */
  source: string;
}

export function buildTestLog(input: TestLogInput): Record<string, unknown> {
  const clean = (players: readonly KeyedSource[]) =>
    players.map((player) => ({ ...player, ...withoutSuffix(player.first_name, player.last_name) }));
  const builtAt = input.startAt - 1_000;
  const snapshot = {
    version: 1,
    builtAt: new Date(builtAt).toISOString(),
    gameId: input.gameId,
    recorded: false,
    home: { id: "home", name: input.home.school, wearing: null },
    away: { id: "away", name: input.away.school, wearing: null },
    watchlist: [],
    keyterms: [],
    sport: "football",
    teamCues: buildTeamCues(
      { school: input.home.school, mascot: input.home.mascot, wearing: null },
      { school: input.away.school, mascot: input.away.mascot, wearing: null },
    ),
    statsEnabled: true,
    statsAuto: true,
    statsRoster: keyedRoster(clean(input.home.players), clean(input.away.players)),
  };
  const records: Record<string, unknown>[] = [{ kind: "game", gameId: input.gameId, at: builtAt, snapshot }];
  for (const line of input.lines) {
    records.push({
      kind: "utterance",
      gameId: input.gameId,
      at: input.startAt + line.startMs,
      connectionId: 1,
      text: line.text,
      offsetMs: line.startMs + 1_000,
    });
  }
  return {
    format: "spotter-v3-log",
    version: 1,
    gameId: input.gameId,
    exportedAt: new Date(input.startAt).toISOString(),
    madeFrom: input.source,
    records,
  };
}

/**
 * The file name for a made game, "spotter-log-georgia-at-alabama-401856712".
 * It starts "spotter-log-" so .gitignore keeps it out of git even if it lands
 * in the repo by mistake; the truth file beside it is the same name plus
 * ".truth.json".
 */
export function testGameName(away: string, home: string, tag: string): string {
  const slug = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return ["spotter-log", slug(away) || "away", "at", slug(home) || "home", slug(tag)].filter(Boolean).join("-");
}

// -----------------------------------------------------------------------------
// A roster from a spreadsheet, for a game ESPN does not have.
// -----------------------------------------------------------------------------

/** Why a roster file cannot be read, in words for the terminal. */
export class RosterFileError extends Error {}

const HEADERS = {
  jersey: /^(#|no\.?|num(ber)?|jersey|uniform)$/i,
  first_name: /^first( ?name)?$/i,
  last_name: /^(last( ?name)?|surname)$/i,
  name: /^(name|player|full ?name|player name)$/i,
  position: /^(pos(ition)?)$/i,
};

/**
 * A roster from a CSV (or tab or semicolon separated) file with a header row:
 * a number column, and either first and last name columns or one name column
 * ("Sam Langan", or "Langan, Sam"), and a position column if there is one.
 */
export function rosterFromCsv(text: string): KeyedSource[] {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length < 2) throw new RosterFileError("The roster file needs a header row and at least one player.");
  const header = rows[0].map((cell) => cell.trim());
  const column = (key: keyof typeof HEADERS) => header.findIndex((cell) => HEADERS[key].test(cell));
  const jersey = column("jersey");
  const first = column("first_name");
  const last = column("last_name");
  const name = column("name");
  const position = column("position");
  if (last < 0 && name < 0) {
    throw new RosterFileError('The roster file\'s first row must name its columns, with a "Last name" or a "Name" column (and "Number" and "Position" if you have them).');
  }

  const players: KeyedSource[] = [];
  for (const row of rows.slice(1)) {
    const cell = (index: number) => (index >= 0 ? (row[index] ?? "").trim() : "");
    let firstName = cell(first) || null;
    let lastName = cell(last);
    if (!lastName && cell(name)) {
      const full = cell(name);
      if (full.includes(",")) {
        const [surname, given] = full.split(",", 2);
        lastName = surname.trim();
        firstName ??= given.trim() || null;
      } else {
        const words = full.split(/\s+/);
        lastName = words.pop() ?? "";
        firstName ??= words.join(" ") || null;
      }
    }
    if (!lastName) continue;
    const fixed = withoutSuffix(firstName, lastName);
    players.push({ jersey: cell(jersey).replace(/^#/, "") || null, ...fixed, position: cell(position).toUpperCase() || null });
  }
  if (players.length === 0) throw new RosterFileError("No players were found in the roster file.");
  return players;
}
