import type { Side } from "./types";

// =============================================================================
// The truth a scored game is held to (scripts/score-livestats.ts): the box
// score, as a *.truth.json file next to the game's log says it. Two kinds:
//   - {"source":"espn","league":"nfl"|"college-football","gameId":"..."}: the
//     box score is read out of ESPN's public summary JSON, fetched by the
//     scorer into memory;
//   - {"source":"manual","players":[{side, jersey, name, stats}]}: typed by
//     hand from a printed box score, on Spotter's own stat keys.
// Only the stats a truth file lists are scored: a key nobody in the file has is
// not held against anyone.
//
// PRIVACY: a manual truth file names high school players. The scorer reads it
// from disk and writes nothing; the file and the folder it sits in are in
// .gitignore and must never be committed (test/testSetNotTracked.test.ts).
// Pure: the fetch is the scorer's.
// =============================================================================

/** The stats a truth file may score, Spotter's keys for the columns a box score prints. */
export const TRUTH_KEYS = [
  "pass_cmp",
  "pass_att",
  "pass_yds",
  "pass_td",
  "pass_int",
  "rush_att",
  "rush_yds",
  "rush_td",
  "rec",
  "rec_yds",
  "rec_td",
  "kr",
  "kr_yds",
  "xpm",
  "xpa",
  "fgm",
  "fga",
  "def_int",
  "fum",
] as const;
export type TruthKey = (typeof TRUTH_KEYS)[number];

export type TruthStats = Partial<Record<TruthKey, number>>;

/** One player in the box score. `last` is the surname on its own, for the fallback match when the jersey is missing. */
export interface TruthPlayer {
  side: Side;
  jersey: string | null;
  name: string;
  last: string;
  stats: TruthStats;
}

export interface Truth {
  source: "espn" | "manual";
  players: TruthPlayer[];
  /** A line from the truth file, printed with the score ("home kicker's long FG not in the box"). */
  note?: string;
  /**
   * Which league's counting rules the box follows (fix 6, Part 5): the NFL
   * box counts a sack as neither a carry nor rushing yards; college and high
   * school boxes (and Spotter) count it as a carry for a loss. A manual truth
   * is on Spotter's own keys and needs no adjustment.
   */
  league?: "nfl" | "college-football";
}

export type TruthFile =
  | { source: "espn"; league: "nfl" | "college-football"; gameId: string; note?: string }
  | { source: "manual"; players: TruthPlayer[]; note?: string };

/** Why a truth file cannot be used, in words for the terminal. */
export class TruthError extends Error {}

export function isTruthKey(value: unknown): value is TruthKey {
  return typeof value === "string" && (TRUTH_KEYS as readonly string[]).includes(value);
}

/** A truth file, checked field by field. Throws TruthError with the reason. */
export function parseTruthFile(raw: unknown): TruthFile {
  if (!isRecord(raw)) throw new TruthError("a truth file is a JSON object");
  const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim() : undefined;
  if (raw.source === "espn") {
    if (raw.league !== "nfl" && raw.league !== "college-football") throw new TruthError('"league" must be "nfl" or "college-football"');
    if (typeof raw.gameId !== "string" || !/^\d+$/.test(raw.gameId.trim())) throw new TruthError('"gameId" must be ESPN\'s numeric game id');
    return { source: "espn", league: raw.league, gameId: raw.gameId.trim(), ...(note ? { note } : {}) };
  }
  if (raw.source === "manual") {
    if (!Array.isArray(raw.players)) throw new TruthError('"players" must be a list');
    const players = raw.players.map((entry, index) => {
      if (!isRecord(entry)) throw new TruthError(`players[${index}] is not an object`);
      const side: Side | null = entry.side === "home" || entry.side === "away" ? entry.side : null;
      if (side === null) throw new TruthError(`players[${index}].side must be "home" or "away"`);
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const jersey = jerseyText(entry.jersey);
      if (!name && jersey === null) throw new TruthError(`players[${index}] needs a name or a jersey`);
      if (!isRecord(entry.stats)) throw new TruthError(`players[${index}].stats must be an object`);
      const stats: TruthStats = {};
      for (const [key, value] of Object.entries(entry.stats)) {
        if (!isTruthKey(key)) throw new TruthError(`players[${index}].stats has an unknown key "${key}"`);
        if (typeof value !== "number" || !Number.isFinite(value)) throw new TruthError(`players[${index}].stats.${key} must be a number`);
        stats[key] = value;
      }
      const player: TruthPlayer = { side, jersey, name, last: typeof entry.last === "string" && entry.last.trim() ? entry.last.trim() : lastWord(name), stats };
      return player;
    });
    return { source: "manual", players, ...(note ? { note } : {}) };
  }
  throw new TruthError('"source" must be "espn" or "manual"');
}

export function truthFromManual(file: Extract<TruthFile, { source: "manual" }>): Truth {
  return { source: "manual", players: file.players, ...(file.note ? { note: file.note } : {}) };
}

/** ESPN's public summary endpoint for a game. */
export function espnSummaryUrl(file: Extract<TruthFile, { source: "espn" }>): string {
  return `https://site.api.espn.com/apis/site/v2/sports/football/${file.league}/summary?event=${encodeURIComponent(file.gameId)}`;
}

// -----------------------------------------------------------------------------
// ESPN's box score.
// -----------------------------------------------------------------------------

/**
 * ESPN's column keys, as each statistics section's `keys` lists them, to
 * Spotter's. A slash key ("completions/passingAttempts") is two numbers in one
 * cell, "14/18".
 */
const ESPN_KEYS: Record<string, TruthKey | readonly [TruthKey, TruthKey]> = {
  "completions/passingAttempts": ["pass_cmp", "pass_att"],
  passingYards: "pass_yds",
  passingTouchdowns: "pass_td",
  interceptions: "pass_int", // in the passing section; the interceptions section is handled below
  rushingAttempts: "rush_att",
  rushingYards: "rush_yds",
  rushingTouchdowns: "rush_td",
  receptions: "rec",
  receivingYards: "rec_yds",
  receivingTouchdowns: "rec_td",
  kickReturns: "kr",
  kickReturnYards: "kr_yds",
  "fieldGoalsMade/fieldGoalAttempts": ["fgm", "fga"],
  "extraPointsMade/extraPointAttempts": ["xpm", "xpa"],
  fumbles: "fum",
};

/** The same column key means a different stat in the defensive interceptions section. */
const ESPN_SECTION_KEYS: Record<string, Record<string, TruthKey>> = {
  interceptions: { interceptions: "def_int" },
};

/**
 * The box score out of ESPN's summary JSON. Sides come from the header's
 * competitors (homeAway by team id). A player appearing in several sections is
 * one player, by athlete id. Rows with no jersey (the fumbles section prints
 * none) keep jersey null and match by surname.
 */
export function truthFromEspn(summary: unknown, note?: string, league?: "nfl" | "college-football"): Truth {
  if (!isRecord(summary)) throw new TruthError("ESPN's summary is not a JSON object");
  const header = isRecord(summary.header) ? summary.header : null;
  const competitions = header && Array.isArray(header.competitions) ? header.competitions : [];
  const competition = isRecord(competitions[0]) ? competitions[0] : null;
  const competitors = competition && Array.isArray(competition.competitors) ? competition.competitors : [];
  const sideOfTeam = new Map<string, Side>();
  for (const competitor of competitors) {
    if (!isRecord(competitor) || !isRecord(competitor.team)) continue;
    const id = String(competitor.team.id ?? "");
    if (competitor.homeAway === "home" || competitor.homeAway === "away") sideOfTeam.set(id, competitor.homeAway);
  }
  if (sideOfTeam.size !== 2) throw new TruthError("ESPN's summary does not say which team is home");

  const boxscore = isRecord(summary.boxscore) ? summary.boxscore : null;
  const teams = boxscore && Array.isArray(boxscore.players) ? boxscore.players : [];
  if (teams.length === 0) throw new TruthError("ESPN's summary has no box score yet");

  const players = new Map<string, TruthPlayer>();
  for (const team of teams) {
    if (!isRecord(team) || !isRecord(team.team)) continue;
    const side = sideOfTeam.get(String(team.team.id ?? ""));
    if (!side) continue;
    const sections = Array.isArray(team.statistics) ? team.statistics : [];
    for (const section of sections) {
      if (!isRecord(section) || !Array.isArray(section.keys) || !Array.isArray(section.athletes)) continue;
      const sectionName = typeof section.name === "string" ? section.name : "";
      const keys: string[] = section.keys.map((key) => (typeof key === "string" ? key : ""));
      for (const row of section.athletes) {
        if (!isRecord(row) || !isRecord(row.athlete) || !Array.isArray(row.stats)) continue;
        const athlete = row.athlete;
        const cells: unknown[] = row.stats;
        const name = typeof athlete.displayName === "string" ? athlete.displayName.trim() : "";
        // ESPN's own "Team" row (a team fumble, a team rush) is nobody.
        if (name.toLowerCase() === "team") continue;
        const id = typeof athlete.id === "string" || typeof athlete.id === "number" ? `${side}:${athlete.id}` : `${side}:${name}`;
        let player = players.get(id);
        if (!player) {
          player = {
            side,
            jersey: jerseyText(athlete.jersey),
            name,
            last: typeof athlete.lastName === "string" && athlete.lastName.trim() ? athlete.lastName.trim() : lastWord(name),
            stats: {},
          };
          players.set(id, player);
        } else if (player.jersey === null) player.jersey = jerseyText(athlete.jersey);
        const into: TruthStats = player.stats;
        keys.forEach((key, column) => {
          const target: TruthKey | readonly [TruthKey, TruthKey] | undefined = ESPN_SECTION_KEYS[sectionName]?.[key] ?? ESPN_KEYS[key];
          if (!target) return;
          const cell = cells[column];
          if (typeof target === "string") {
            const value = numberCell(cell);
            if (value !== null) into[target] = value;
            return;
          }
          const [first, second]: readonly [TruthKey, TruthKey] = target;
          const [made, tried] = String(cell ?? "").split("/");
          const a = numberCell(made);
          const b = numberCell(tried);
          if (a !== null) into[first] = a;
          if (b !== null) into[second] = b;
        });
      }
    }
  }
  return { source: "espn", players: [...players.values()].filter((player) => Object.keys(player.stats).length > 0), ...(note ? { note } : {}), ...(league ? { league } : {}) };
}

/** A jersey as text with no "#", or null when the box score has none. */
export function jerseyText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^#/, "");
  return trimmed.length > 0 ? trimmed : null;
}

function numberCell(cell: unknown): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== "string") return null;
  const text = cell.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

function lastWord(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  // "Smith Jr." is Smith.
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  while (words.length > 1 && suffix.test(words[words.length - 1])) words.pop();
  return words[words.length - 1] ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
