import { cleanFootballStats, type FootballStats } from "./statKeys";

// =============================================================================
// Who a player is, in one short string: "H22-LANGAN".
//
// It is the playerId live stats hands Claude and gets back, so it has to be
// something Claude copies exactly and a person reading the browser log can
// follow. It lives in lib/cards/ because both sides need to work it out: live
// stats keys tonight's numbers by it, and the live screen has to find those
// numbers again from the card it is putting up, without importing live stats.
//
// Built from the saved roster, so the same player has the same key for the
// whole game. Every player gets one, including offensive linemen whose
// spotting is off: they never put a card up, but they can recover a fumble.
// =============================================================================

/** What a key is made of: the fields a card's WatchlistPlayer carries too. */
export interface KeySource {
  side: "H" | "A";
  jersey: string | null;
  last_name: string;
}

/** Side, jersey, surname: "H22-LANGAN", or "A-SMITH" with no jersey. */
export function playerKey(player: KeySource): string {
  const jersey = (player.jersey ?? "").trim().replace(/^#/, "").replace(/\s+/g, "");
  const surname = player.last_name.trim().toUpperCase().replace(/\s+/g, "_");
  return `${player.side}${jersey}-${surname}`;
}

// -----------------------------------------------------------------------------
// Both rosters with keys, every player included. Game setup builds this into
// the game (lib/game/buildGame.ts) and live stats reads it, so it lives here
// where both may import it.
// -----------------------------------------------------------------------------

/** One player on the keyed roster: who live stats can credit, and what their card's season numbers are. */
export interface KeyedPlayer {
  playerId: string;
  side: "home" | "away";
  jersey: string | null;
  first: string | null;
  last: string;
  position: string | null;
  /** The uploaded season numbers, so SEASON can be season plus tonight. Null when none were uploaded. */
  season?: FootballStats | null;
  /** "Heard as" forms: words Deepgram writes for this surname, for the reader and the check (Oct 4). Only when there are some. */
  aliases?: string[];
}

/** A saved player, as roster_players holds them. spot_mode is deliberately not read. */
export interface KeyedSource {
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  position: string | null;
  season_stats?: unknown;
  heard_as?: unknown;
}

/**
 * Both rosters, home first, with ids from playerKey ("H22-LANGAN"). Every
 * saved player, spotting off included: a lineman never puts a card up but can
 * recover a fumble (spec rule R9). Two players who would share an id (same
 * side, number and surname, which a real roster never has) are told apart by
 * a suffix, "-2".
 */
export function keyedRoster(home: readonly KeyedSource[], away: readonly KeyedSource[]): KeyedPlayer[] {
  const roster: KeyedPlayer[] = [];
  const taken = new Map<string, number>();
  const add = (player: KeyedSource, side: "home" | "away") => {
    // Read from storage or a file at times, so nothing about its shape is taken on trust.
    const last = typeof player?.last_name === "string" ? player.last_name.trim() : "";
    if (last.length === 0) return;
    const base = playerKey({ side: side === "home" ? "H" : "A", jersey: text(player.jersey), last_name: last });
    const seen = (taken.get(base) ?? 0) + 1;
    taken.set(base, seen);
    const entry: KeyedPlayer = {
      playerId: seen === 1 ? base : `${base}-${seen}`,
      side,
      jersey: text(player.jersey),
      first: text(player.first_name),
      last,
      position: text(player.position),
    };
    if (player.season_stats !== undefined) entry.season = cleanFootballStats(player.season_stats);
    const aliases = Array.isArray(player.heard_as) ? player.heard_as.map(text).filter((form): form is string => form !== null) : [];
    if (aliases.length > 0) entry.aliases = aliases;
    roster.push(entry);
  };
  for (const player of home) add(player, "home");
  for (const player of away) add(player, "away");
  return roster;
}

function text(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}
