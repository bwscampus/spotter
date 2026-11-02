import type { NumberSport, SeasonNumbers, StatKey } from "./sportStats";
import type { FootballStatKey, FootballStats } from "./statKeys";

// =============================================================================
// How often the announcer says a player's name in a game, from their season
// stats (Jed, Oct 3): the players who are called most do the most. It decides
// who keeps Deepgram's name boost when both rosters are over its limit, which
// teammate goes up when a shared surname or a shared jersey number is heard
// alone, and who counts as a bench player at setup.
//
// Every stat below is a play the player was named on: a carry, a catch, a
// pass, a tackle, a kick. Their sum over games played is how many times a game
// the name comes up. Built before the game and carried on the card's player,
// so the live screen only ever reads a number.
//
// In lib/cards/ because setup builds it and the card path reads it, and both
// may import from here.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Each one is a play the player's name was said on. */
export const CALLED_ON: readonly FootballStatKey[] = [
  "rush_att",
  "pass_att",
  "rec",
  "tkl",
  "sacks",
  "def_int",
  "pbu",
  "ff",
  "fr",
  "kr",
  "pr",
  "fga",
  "xpa",
  "punts",
];

// =============================================================================

/**
 * Times a game the player's name comes up, to one decimal. Zero for a player
 * with no season stats. `teamGames` stands in when the sheet gave no games
 * played for this player, so a season total is never set against a per-game
 * one.
 */
export function callRate(stats: FootballStats | null, teamGames: number | null = null): number {
  if (!stats) return 0;
  let plays = 0;
  for (const key of CALLED_ON) {
    const value = stats[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) plays += value;
  }
  if (plays === 0) return 0;
  const games = positive(stats.gp) ?? positive(teamGames) ?? 1;
  return Math.round((plays / games) * 10) / 10;
}

/** The most games anyone on the sheet played: what a player without a GP of their own is divided by. */
export function teamGamesPlayed(sheets: ReadonlyArray<FootballStats | null>): number | null {
  let most: number | null = null;
  for (const stats of sheets) {
    const games = positive(stats?.gp);
    if (games !== null && (most === null || games > most)) most = games;
  }
  return most;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

// =============================================================================
// Basketball and volleyball (Nov 2): the same idea on their own numbers. Each
// entry is a stat and how many times the player's name is said per one of it.
// TUNING.
// =============================================================================

/** A shot, a rebound, an assist, a steal, a block or a turnover each gets the name said; two free throws are one trip to the line. */
export const CALLED_ON_BASKETBALL: ReadonlyArray<readonly [StatKey, number]> = [
  ["fg_att", 1],
  ["ft_att", 0.5],
  ["reb", 1],
  ["ast", 1],
  ["stl", 1],
  ["blk", 1],
  ["tov", 1],
];

/** A kill, an ace, a dig or a block gets the name said; a setter's assist only sometimes ("set by"). */
export const CALLED_ON_VOLLEYBALL: ReadonlyArray<readonly [StatKey, number]> = [
  ["kills", 1],
  ["aces", 1],
  ["digs", 1],
  ["blocks", 1],
  ["assists", 0.5],
];

/**
 * Times a game the player's name comes up, for any sport whose stats are
 * numbers: football's callRate, or the weighted plays above over games
 * played. Basketball counts a missing total rebounds as offensive plus
 * defensive, and volleyball a missing total blocks as solos plus half the
 * assisted ones, as the sheets themselves add them.
 */
export function callRateFor(sport: NumberSport, stats: SeasonNumbers | null, teamGames: number | null = null): number {
  if (sport === "football") return callRate(stats as FootballStats | null, teamGames);
  if (!stats) return 0;
  const filled: SeasonNumbers = { ...stats };
  if (sport === "basketball" && filled.reb === undefined) filled.reb = (stats.oreb ?? 0) + (stats.dreb ?? 0);
  if (sport === "volleyball" && filled.blocks === undefined) filled.blocks = (stats.solo_blocks ?? 0) + (stats.block_assists ?? 0) / 2;
  const weights = sport === "basketball" ? CALLED_ON_BASKETBALL : CALLED_ON_VOLLEYBALL;
  let plays = 0;
  for (const [key, weight] of weights) {
    const value = filled[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) plays += value * weight;
  }
  if (plays === 0) return 0;
  const games = positive(stats.gp) ?? positive(teamGames) ?? 1;
  return Math.round((plays / games) * 10) / 10;
}
