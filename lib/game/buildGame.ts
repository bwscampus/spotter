import { toCardPlayer } from "@/lib/cards/cardPlayer";
import type { GameSnapshot } from "@/lib/game/snapshot";
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
import { CLOSE_RATIO } from "@/lib/rosters/commonWordHits";
import { findSimilarJerseys, type SimilarPair } from "@/lib/rosters/similarJerseys";
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
}

/** One saved player as the game reads them. */
export interface GamePlayerRow {
  roster_id: string;
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  position: string | null;
  grade: string | null;
  height: string | null;
  weight: string | null;
  pronunciations: string[];
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
  watchlist: GameWatchlist;
  collisions: Collision[];
  similarJerseys: SimilarPair[];
  /** Names that sound like either school or mascot. docs/V3_DEFINITION.md 6.3 and 7.3. */
  teamSounds: TeamSoundWarning[];
  keyterm: KeytermState;
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
  const pick = (roster: GameRosterRow, side: "H" | "A"): GamePlayer[] =>
    players
      .filter((row) => row.roster_id === roster.id)
      .map((row) => ({
        // toCardPlayer is the one place that decides what a card says, so the
        // cards preview and the live screen cannot drift apart.
        ...toCardPlayer(row, sport, side),
        spoken_forms: row.spoken_forms,
        spot_mode: isSpotMode(row.spot_mode) ? row.spot_mode : "normal",
      }));

  const homePlayers = pick(home, "H");
  const awayPlayers = pick(away, "A");
  const watchlist = buildGameWatchlist(homePlayers, awayPlayers);
  const spotted = (list: GamePlayer[]) => list.filter((player) => player.spot_mode !== "off");
  const rowsOf = (roster: GameRosterRow) => players.filter((row) => row.roster_id === roster.id);
  const side = (roster: GameRosterRow, list: GamePlayer[]): GameSide => ({
    ...roster,
    playerCount: list.length,
    offCount: list.length - spotted(list).length,
    statsAsOf: newestAsOf(rowsOf(roster).map((row) => row.stats_as_of)),
  });

  return {
    home: side(home, homePlayers),
    away: side(away, awayPlayers),
    sport,
    sportMismatch: Boolean(home.sport && away.sport && home.sport !== away.sport),
    watchlist,
    // At the "close" ratio, the same one the roster review uses: Bargas and
    // Vargas score just under the line, so a fires-only check would miss the
    // pair this warning exists for (docs/V3_DEFINITION.md 6.3).
    collisions: findCrossPlayerCollisions(watchlist.entries, CLOSE_RATIO),
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

/**
 * Reads both rosters and works out everything that follows from them, the
 * keyterm check against Deepgram included.
 */
export async function loadGame(homeId: string, awayId: string): Promise<LoadResult> {
  const result = await api<{ rosters: GameRosterRow[]; players: GamePlayerRow[] }>(
    "GET",
    `/api/rosters/game?ids=${encodeURIComponent(homeId)},${encodeURIComponent(awayId)}`,
  );
  if (!result.ok) {
    return { ok: false, error: "Could not load those rosters. Check the connection and try again." };
  }
  const rostersResult = { data: result.data.rosters };
  const playersResult = { data: result.data.players };

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

  return { ok: true, loaded: { ...assembled, keyterm: await checkKeyterms(assembled.watchlist.keyterms) } };
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
    home: { id: loaded.home.id, name: loaded.home.school, wearing: wearing.home },
    away: { id: loaded.away.id, name: loaded.away.school, wearing: wearing.away },
    watchlist: loaded.watchlist.entries,
    keyterms: keytermsFor(loaded, choices.keytermBoost),
    sport: choices.sport !== undefined ? choices.sport : loaded.sport,
    teamCues: buildTeamCues(
      { school: loaded.home.school, mascot: loaded.home.mascot, wearing: wearing.home },
      { school: loaded.away.school, mascot: loaded.away.mascot, wearing: wearing.away },
    ),
    // Item 13 adds the switch. Until then no game reads plays.
    statsEnabled: false,
  };
}

/** Deepgram gets the names only when they were asked for and it will take them. */
function keytermsFor(loaded: LoadedGame, asked: boolean): string[] {
  if (!asked || loaded.keyterm.kind === "too_many") return [];
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
  });
  return { ok: true, snapshot: { ...snapshot, statsEnabled: game.statsEnabled }, loaded: result.loaded };
}

/** Asks the server to try these keyterms against Deepgram. Never blocks Start. */
export async function checkKeyterms(keyterms: string[]): Promise<KeytermState> {
  if (keyterms.length === 0) return { kind: "ok" };
  try {
    const response = await fetch("/api/deepgram/check-keyterms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyterms }),
    });
    const payload = await response.json();
    if (response.ok && payload?.ok === true) return { kind: "ok" };
    if (response.ok && payload?.ok === false) {
      return { kind: "too_many", reason: typeof payload.reason === "string" ? payload.reason : "" };
    }
    return {
      kind: "unchecked",
      message: "Could not check the names against Deepgram. You can still start; names may not be boosted.",
    };
  } catch {
    return {
      kind: "unchecked",
      message: "Could not reach Spotter's server to check the names. You can still start.",
    };
  }
}
