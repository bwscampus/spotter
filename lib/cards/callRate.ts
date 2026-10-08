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
