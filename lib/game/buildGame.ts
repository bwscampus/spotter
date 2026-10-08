import { callRate, teamGamesPlayed } from "@/lib/cards/callRate";
import { toCardPlayer } from "@/lib/cards/cardPlayer";
import { keyedRoster, type KeyedPlayer } from "@/lib/cards/playerKey";
import { cleanFootballStats } from "@/lib/cards/statKeys";
import type { GameSnapshot } from "@/lib/game/snapshot";
import { normalizeHex, resolveGameColors } from "@/lib/game/colors";
import { droppedKeyterms, lookAlikeDrops, type LookAlikeDrop } from "@/lib/game/crossLookAlikes";
import { selectKeyterms } from "@/lib/game/keytermBudget";
import { newestAsOf } from "@/lib/game/staleStats";
import { buildTeamCues } from "@/lib/game/teamCues";
import { teamSoundWarnings, type TeamSoundWarning } from "@/lib/game/teamSounds";
import {
  buildGameWatchlist,
  findCrossPlayerCollisions,
  type Collision,
  type GamePlayer,
  type GameWatchlist,
} from "@/lib/rosters/buildWatchlist";
import { CLOSE_RATIO, commonWordHits } from "@/lib/rosters/commonWordHits";
import { firstNameCollisions, type FirstNameCollision } from "@/lib/rosters/firstNames";
import { findSimilarJerseys, type SimilarPair } from "@/lib/rosters/similarJerseys";
import { spokenForms } from "@/lib/rosters/spokenForms";
import { isSpotMode } from "@/lib/rosters/types";
import { api } from "@/lib/apiClient";

// =============================================================================
// Building a game out of two saved rosters.
//
// The one place that does it: game setup's Start and the live screen's Refresh
// rosters both come through here, so a refresh builds exactly what Start built.
//
// Two steps, because the announcer reads the warnings in the middle: loadGame
// does the work that needs the network, and buildSnapshot turns the result into
// a game once the last choices are made. buildGame is both at once, for the
// refresh, which already knows all of it.
//
// Nothing here runs during a game. A live game is a frozen copy on purpose: the
// hot path reads it and never asks anything for anything.
// =============================================================================

/** What the keyterm check came back with. */
export type KeytermState =
  | { kind: "ok" }
  /**
   * Over Deepgram's limit, so the most called players keep the boost: the
   * front of the list lib/game/keytermBudget.ts ordered, as much as Deepgram
   * took. Everyone is still listened for.
   */
  | { kind: "trimmed"; keyterms: string[]; total: number }
  | { kind: "too_many"; reason: string }
  | { kind: "unchecked"; message: string };

/** What each side is wearing tonight, so "white 5" finds a player. Blank is fine. */
export interface Wearing {
  home: string | null;
  away: string | null;
}

/** The roster fields a game needs. Read fresh, so a renamed school reaches the cues. */
export interface GameRosterRow {
  id: string;
  school: string;
  mascot: string | null;
  sport: string;
  /** The team colour, "#rrggbb", when one is saved. */
  primary_color?: string | null;
}

/** One saved player as the game reads them. */
export interface GamePlayerRow {
  /** The saved row, so setup can change a player's spotting with one click. Absent in older callers. */
  id?: string;
  roster_id: string;
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  position: string | null;
  grade: string | null;
  height: string | null;
  weight: string | null;
  pronunciations: string[];
  /** Words Deepgram writes for the surname (Oct 4). Absent in older callers. */
  heard_as?: string[];
  /** Under the name on the card (Oct 7). Absent in older callers. */
  storyline?: string;
  spoken_forms: string[];
  spot_mode: string;
  season_stats: unknown;
  season_lines: string[];
  stats_as_of: string | null;
}

export interface GameSide extends GameRosterRow {
  /** Everyone saved, including players whose spotting is off. */
  playerCount: number;
  /** Players left out of spotting. */
  offCount: number;
  /** When the team's season stats are as of, "YYYY-MM-DD", or null when it has none. Setup warns when it is old. */
  statsAsOf: string | null;
}

/** Everything two rosters imply, before the announcer's last choices. */
export interface LoadedGame {
  home: GameSide;
  away: GameSide;
  /** Home's sport, or away's if home has none. Two rosters in one game share one. */
  sport: string | null;
  /** The rosters disagree about the sport. Setup says so; the game uses home's. */
  sportMismatch: boolean;
  /** Set when the two teams' colours are too close to tell the halves of the screen apart (lib/game/colors.ts). */
  colorNote: string | null;
  watchlist: GameWatchlist;
  collisions: Collision[];
  similarJerseys: SimilarPair[];
  /** Names that sound like either school or mascot. docs/V3_DEFINITION.md 6.3 and 7.3. */
  teamSounds: TeamSoundWarning[];
  /**
   * Bench players listened for exact-only tonight: no season stats on a team
   * that has them, and a surname that fires on an everyday word. Away first.
   */
  benchExactOnly: Array<{ side: "H" | "A"; name: string }>;
  /**
   * Bench names that sound like a star's (lib/game/crossLookAlikes.ts): their
   * keyterm is left out of the boost, and setup offers spotting off.
   */
  lookAlikeDrops: LookAlikeDrop[];
  /** First names the matcher would hear as another player's surname, on either roster (lib/rosters/firstNames.ts). */
  firstNames: Array<FirstNameCollision & { player: string }>;
  keyterm: KeytermState;
  /**
   * Both rosters with keys and season numbers, every player included, for
   * live stats. Built here because this is the one place that reads every
   * saved player, linemen and all.
   */
  statsRoster: KeyedPlayer[];
}

export interface GameChoices {
  wearing: Wearing;
  keytermBoost: boolean;
  /** The called_games id this game is recorded as, and its log key. */
  gameId: string;
  recorded: boolean;
  /**
   * The sport to keep, rather than reading it off the rosters again. A refresh
   * passes the one the game was built with, so an edit on the teams screen
   * cannot change which vetoes keep a number off the screen mid-game.
   */
  sport?: string | null;
  /** The live stats switch on setup. Only a football game can have it on. */
  statsEnabled?: boolean;
}

export type LoadResult = { ok: true; loaded: LoadedGame } | { ok: false; error: string };
export type BuildResult = { ok: true; snapshot: GameSnapshot; loaded: LoadedGame } | { ok: false; error: string };

/** What the two rosters' players are read with. Everything the cards and the numbers need. */

/**
 * Turns the rows into a game, before the keyterm check. Pure, so what a game is
 * made of can be tested without a database.
 */
export function assembleGame(
  home: GameRosterRow,
  away: GameRosterRow,
  players: GamePlayerRow[],
): Omit<LoadedGame, "keyterm"> {
  const sport = home.sport || away.sport || null;
  const rowsOf = (roster: GameRosterRow) => players.filter((row) => row.roster_id === roster.id);
  const benchExactOnly: LoadedGame["benchExactOnly"] = [];

  const pick = (roster: GameRosterRow, side: "H" | "A"): GamePlayer[] => {
    const rows = rowsOf(roster);
    // Season numbers are football's, so only football has a call rate.
    const sheets = rows.map((row) => (sport === "football" ? cleanFootballStats(row.season_stats) : null));
    const games = teamGamesPlayed(sheets);
    // "No stats" only means a bench player on a team whose stats were imported.
    const teamHasStats = rows.some(hasSeasonStats);
    return rows.map((row, index) => {
      const mode = isSpotMode(row.spot_mode) ? row.spot_mode : "normal";
      const bench = teamHasStats && mode === "normal" && !hasSeasonStats(row) && firesOnAWord(row);
      if (bench) benchExactOnly.push({ side, name: row.last_name });
      return {
        // toCardPlayer is the one place that decides what a card says, so the
        // cards preview and the live screen cannot drift apart.
        ...toCardPlayer(row, sport, side),
        // Built again here rather than read back, so a change to how forms are
        // made reaches every saved roster without a re-save.
        spoken_forms: spokenForms(row.last_name, row.pronunciations, row.heard_as ?? []),
        spot_mode: bench ? "exact_only" : mode,
        priority: callRate(sheets[index], games),
        ...(hasSeasonStats(row) ? { hasStats: true } : {}),
      };
    });
  };

  const homePlayers = pick(home, "H");
  const awayPlayers = pick(away, "A");
  const built = buildGameWatchlist(homePlayers, awayPlayers);
  const collisions = findCrossPlayerCollisions(built.entries, CLOSE_RATIO);

  // Which saved row a card player is, for the one-click spotting off at setup.
  const rowIds = new Map<string, string>();
  for (const row of players) {
    if (row.id) rowIds.set(`${row.roster_id === home.id ? "H" : "A"}|${(row.jersey ?? "").trim()}|${row.last_name.trim()}`, row.id);
  }
  const drops = lookAlikeDrops(built.entries, collisions, (player) => rowIds.get(`${player.side}|${(player.jersey ?? "").trim()}|${player.last_name.trim()}`) ?? null);

  // The boost: both teams' words, then the names most called first, only for
  // players with a rating or stats (a side with no stats keeps everyone), and
  // never a bench name that sounds like a star's.
  const teams = [
    { school: home.school, mascot: home.mascot },
    { school: away.school, mascot: away.mascot },
  ];
  const rated = { H: rowsOf(home).some(hasSeasonStats), A: rowsOf(away).some(hasSeasonStats) };
  const watchlist = { ...built, keyterms: selectKeyterms(built.entries, teams, { rated, dropped: droppedKeyterms(built.entries, drops) }) };

  const allRows = [...rowsOf(home), ...rowsOf(away)];
  const firstNames = firstNameCollisions(
    allRows.map((row) => ({
      first_name: row.first_name,
      last_name: row.last_name,
      jersey: row.jersey,
      side: row.roster_id === home.id ? ("H" as const) : ("A" as const),
      spot_mode: row.spot_mode,
      pronunciations: row.pronunciations,
    })),
  ).map((hit) => {
    const row = allRows[hit.index];
    return { ...hit, player: `${row.first_name ?? ""} ${row.last_name}`.trim() + (row.jersey ? ` #${row.jersey}` : "") };
  });
  const spotted = (list: GamePlayer[]) => list.filter((player) => player.spot_mode !== "off");
  const side = (roster: GameRosterRow, list: GamePlayer[]): GameSide => ({
    ...roster,
    playerCount: list.length,
    offCount: list.length - spotted(list).length,
    statsAsOf: newestAsOf(rowsOf(roster).map((row) => row.stats_as_of)),
  });

  return {
    home: side(home, homePlayers),
    away: side(away, awayPlayers),
    // Season numbers are football's; any other sport's are left off rather than misread.
    statsRoster: keyedRoster(
      rowsOf(home).map((row) => (sport === "football" ? row : { ...row, season_stats: null })),
      rowsOf(away).map((row) => (sport === "football" ? row : { ...row, season_stats: null })),
    ),
    benchExactOnly: [...benchExactOnly.filter((b) => b.side === "A"), ...benchExactOnly.filter((b) => b.side === "H")],
    sport,
    sportMismatch: Boolean(home.sport && away.sport && home.sport !== away.sport),
    colorNote: resolveGameColors(home.primary_color ?? null, away.primary_color ?? null).note,
    watchlist,
    // At the "close" ratio, the same one the roster review uses: Bargas and
    // Vargas score just under the line, so a fires-only check would miss the
    // pair this warning exists for (docs/V3_DEFINITION.md 6.3).
    collisions,
    lookAlikeDrops: drops,
    firstNames,
    // Only players who can be spotted: a number nobody listens for cannot be misheard.
    similarJerseys: findSimilarJerseys(spotted(homePlayers), spotted(awayPlayers)),
    teamSounds: teamSoundWarnings(
      [
        { school: home.school, mascot: home.mascot },
        { school: away.school, mascot: away.mascot },
      ],
      watchlist.entries,
    ),
  };
}

/** Season stats of any kind: football's numbers or another sport's lines. */
function hasSeasonStats(row: GamePlayerRow): boolean {
  return cleanFootballStats(row.season_stats) !== null || row.season_lines.some((line) => line.trim().length > 0);
}

/**
 * The surname fires on an everyday word, scored with the real matcher the way
 * the roster review's common-word warning scores it ("Long" on "long").
 */
function firesOnAWord(row: GamePlayerRow): boolean {
  const forms = row.spoken_forms.length > 0 ? row.spoken_forms : spokenForms(row.last_name);
  return commonWordHits(forms).verdict === "would_fire";
}

export type AssembledResult = { ok: true; assembled: Omit<LoadedGame, "keyterm"> } | { ok: false; error: string };

/**
 * Reads both rosters and assembles the game from them, everything but the
 * keyterm check. Setup's Names page reads this, so it lists exactly the names
 * Start would listen for without asking Deepgram anything.
 */
export async function loadAssembled(homeId: string, awayId: string): Promise<AssembledResult> {
  // Both rosters and their players, this account's only (GET /api/rosters/game).
  const read = await api<{ rosters: GameRosterRow[]; players: GamePlayerRow[] }>(
    "GET",
    `/api/rosters/game?ids=${encodeURIComponent(homeId)},${encodeURIComponent(awayId)}`,
  );
  const rostersResult = { data: read.ok ? read.data.rosters : null };
  const playersResult = { data: read.ok ? read.data.players : null };

  if (!rostersResult.data || !playersResult.data) {
    return { ok: false, error: "Could not load those rosters. Check the connection and try again." };
  }

  const home = rostersResult.data.find((roster) => roster.id === homeId);
  const away = rostersResult.data.find((roster) => roster.id === awayId);
  if (!home || !away) {
    // A roster deleted between building a game and refreshing it. Say which,
    // because the announcer is the only one who can decide what to do about it.
    const missing = !home && !away ? "Both teams have" : "One of the teams has";
    return { ok: false, error: `${missing} been deleted. Build a new game from the menu.` };
  }

  const assembled = assembleGame(home, away, playersResult.data);
  if (assembled.watchlist.entries.length === 0) {
    return {
      ok: false,
      error: "Nobody on those rosters can be spotted. Add players, or turn spotting on for some of them.",
    };
  }
  return { ok: true, assembled };
}

/**
 * Reads both rosters and works out everything that follows from them, the
 * keyterm check against Deepgram included.
 */
export async function loadGame(homeId: string, awayId: string): Promise<LoadResult> {
  const result = await loadAssembled(homeId, awayId);
  if (!result.ok) return result;
  const { assembled } = result;

  // Both teams' words, then the most called first, so if Deepgram cannot take
  // them all the front of the list keeps the boost (lib/game/keytermBudget.ts).
  const keyterm = await checkKeyterms(assembled.watchlist.keyterms);
  return { ok: true, loaded: { ...assembled, keyterm } };
}

/**
 * The loaded game as the live screen holds it. Pure, so Start can call it the
 * moment it is pressed without going back to the network.
 *
 * The keyterm boost is asked for, not assumed: a list Deepgram has refused is
 * dropped here rather than being sent and rejected at the socket.
 */
export function buildSnapshot(loaded: LoadedGame, choices: GameChoices): GameSnapshot {
  const wearing: Wearing = { home: trimmed(choices.wearing.home), away: trimmed(choices.wearing.away) };
  return {
    version: 1,
    builtAt: new Date().toISOString(),
    gameId: choices.gameId,
    recorded: choices.recorded,
    home: { id: loaded.home.id, name: loaded.home.school, wearing: wearing.home, color: normalizeHex(loaded.home.primary_color) },
    away: { id: loaded.away.id, name: loaded.away.school, wearing: wearing.away, color: normalizeHex(loaded.away.primary_color) },
    watchlist: loaded.watchlist.entries,
    keyterms: keytermsFor(loaded, choices.keytermBoost),
    sport: choices.sport !== undefined ? choices.sport : loaded.sport,
    teamCues: buildTeamCues(
      { school: loaded.home.school, mascot: loaded.home.mascot, wearing: wearing.home },
      { school: loaded.away.school, mascot: loaded.away.mascot, wearing: wearing.away },
    ),
    // Live stats are football only (docs/V3_DEFINITION.md 2), whatever was asked.
    statsEnabled: Boolean(choices.statsEnabled) && (choices.sport !== undefined ? choices.sport : loaded.sport) === "football",
    statsRoster: loaded.statsRoster,
  };
}

/** Deepgram gets the names only when they were asked for, and only as many as it will take. The sound check listens with the same list. */
export function keytermsFor(loaded: LoadedGame, asked: boolean): string[] {
  if (!asked || loaded.keyterm.kind === "too_many") return [];
  if (loaded.keyterm.kind === "trimmed") return loaded.keyterm.keyterms;
  return loaded.watchlist.keyterms;
}

function trimmed(value: string | null): string | null {
  return value?.trim() ? value.trim() : null;
}

/**
 * Both steps at once, for the live screen's Refresh rosters, which carries
 * over everything settled at setup.
 */
export async function buildGame(game: GameSnapshot): Promise<BuildResult> {
  const result = await loadGame(game.home.id, game.away.id);
  if (!result.ok) return result;
  const snapshot = buildSnapshot(result.loaded, {
    wearing: { home: game.home.wearing, away: game.away.wearing },
    // Asked for again, because a bigger roster can push the list past
    // Deepgram's limit. buildSnapshot drops it if the check now fails.
    keytermBoost: game.keyterms.length > 0,
    // Kept, or a refresh would take the game out of Past games and split its log.
    gameId: game.gameId,
    recorded: game.recorded,
    sport: game.sport,
    statsEnabled: game.statsEnabled,
  });
  return { ok: true, snapshot, loaded: result.loaded };
}

/** Longest wait for a second keyterm check after a 429. A longer one is a daily cap, not worth waiting for. */
const KEYTERM_RETRY_MAX_MS = 6_000;

/** How long a 429 says to wait, when it is short enough to wait for. */
function retryAfterMs(response: Response): number | null {
  if (response.status !== 429) return null;
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const ms = Math.ceil(seconds * 1000);
  return ms <= KEYTERM_RETRY_MAX_MS ? ms : null;
}

/**
 * Asks the server to try these keyterms against Deepgram, most important
 * first, and to say how many from the front fit when they do not all. Never
 * blocks Start.
 */
export async function checkKeyterms(keyterms: string[]): Promise<KeytermState> {
  if (keyterms.length === 0) return { kind: "ok" };
  try {
    const ask = () =>
      fetch("/api/deepgram/check-keyterms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyterms, fit: true }),
      });
    let response = await ask();
    // Too soon after the last check (Refresh rosters pressed twice): wait the
    // few seconds the server names and ask once more, because an unchecked
    // list goes to Deepgram whole and may be too long for it.
    const wait = retryAfterMs(response);
    if (wait !== null) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      response = await ask();
    }
    const payload = await response.json();
    if (response.status === 429 && typeof payload?.error === "string") {
      return { kind: "unchecked", message: `${payload.error} The names were not checked; you can still start.` };
    }
    if (response.ok && payload?.ok === true) return { kind: "ok" };
    if (response.ok && payload?.ok === false) {
      const fits = typeof payload.fits === "number" && Number.isInteger(payload.fits) ? payload.fits : 0;
      if (fits > 0 && fits < keyterms.length) {
        return { kind: "trimmed", keyterms: keyterms.slice(0, fits), total: keyterms.length };
      }
      return { kind: "too_many", reason: typeof payload.reason === "string" ? payload.reason : "" };
    }
    return {
      kind: "unchecked",
      message: "Could not check the names for the name boost. You can still start; names may not be boosted.",
    };
  } catch {
    return {
      kind: "unchecked",
      message: "Could not reach Spotter's server to check the names. You can still start.",
    };
  }
}
