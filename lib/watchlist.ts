// A watchlist entry is one name Spotter listens for. Entries are built from a
// saved roster by buildGameWatchlist in lib/rosters/buildWatchlist.ts, then
// kept in memory and in localStorage for the whole game.
//
// name:    the unique identity the engine reports a match as. The surname as
//          printed on the roster.
// aliases: spellings the speech engine is likely to return for the name,
//          normalized. Multi-word aliases (e.g. "foo koo gee") are allowed.
// label:   what goes on screen. Two Williamses need telling apart, so the
//          label carries jerseys ("Williams #10 · #23"). Defaults to name.
// keyterm: what is sent to Deepgram to bias recognition. Defaults to name.
// players: who the entry is, in roster order, so the live screen can put their
//          card on screen. More than one when two players share a surname.
// exactOnly: set when a player with this surname is spotted "exact only"
//          (docs/V3_DEFINITION.md 7.3). Carried here, read by the engine from
//          item 7. The setting is about how the surname sounds, and players who
//          share a surname share its sound, so one of them is enough.
export interface WatchlistEntry {
  name: string;
  aliases: string[];
  label?: string;
  keyterm?: string;
  players?: WatchlistPlayer[];
  exactOnly?: boolean;
}

/**
 * The cards for one entry.
 *
 * A game built before cards existed carries no players, so it falls back to a
 * card with just the label on it. That is what the screen showed before, and it
 * means an older saved game still works rather than going blank.
 */
export function cardsFor(entry: WatchlistEntry): WatchlistPlayer[] {
  if (entry.players?.length) return entry.players;
  return [
    {
      jersey: null,
      first_name: null,
      last_name: entry.label || entry.name,
      position: null,
      grade: null,
      height: null,
      weight: null,
      side: "H",
      stat_lines: [],
    },
  ];
}

/**
 * Everything the live screen's card shows, carried in the watchlist so it is
 * in memory before the mic turns on. The hot path reads this and never asks
 * the network for anything.
 *
 * Optional on the entry, not required: a game saved before cards existed still
 * loads, and falls back to the label.
 */
export interface WatchlistPlayer {
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  /**
   * As the roster printed it: "QB", "RB". Nothing on screen uses it; the play
   * feed does, because a quarterback throws and a running back carries.
   */
  position: string | null;
  /** Grade as the roster printed it: "12", "Sr". */
  grade: string | null;
  height: string | null;
  weight: string | null;
  /** Which team, so a surname on both sides can be told apart at a glance. */
  side: "H" | "A";
  /** What to say about them, already phrased. Empty when no stats were imported. */
  stat_lines: string[];
  /**
   * How the announcer says the surname, typed on the review screen. When set,
   * it is the big text on the card and the spelled surname goes small beside
   * it. Optional so a game built before pronunciations were on cards still loads.
   */
  pronunciation?: string | null;
  /** "as of 9/26": when the season numbers were taken. Built before the game, never on a match. */
  as_of?: string | null;
}
