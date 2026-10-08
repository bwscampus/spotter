import { keyedRoster, type KeyedSource } from "@/lib/cards/playerKey";
import type { WatchlistEntry } from "@/lib/watchlist";
import type { StatsRosterPlayer } from "./types";

// =============================================================================
// The two rosters as live stats sees them: every saved player, with an id
// Claude copies back.
//
// Every player means every player. Spotting set to "off" keeps an offensive
// lineman's name and number from ever putting a card up, but he can still
// recover a fumble, so he is on this roster (spec rule R9). The live screen's
// watchlist drops those players; this does not.
// =============================================================================

/** A saved player, as roster_players holds them. spot_mode is deliberately not read. */
export type SavedPlayer = KeyedSource;

/**
 * Both rosters, home first, with ids from playerKey ("H22-LANGAN"). The
 * builder is keyedRoster in lib/cards/playerKey.ts, shared with game setup.
 */
export function statsRoster(home: readonly SavedPlayer[], away: readonly SavedPlayer[]): StatsRosterPlayer[] {
  return keyedRoster(home, away);
}

/**
 * The best roster a game's watchlist can give, for the replay harness reading
 * a browser log. The watchlist has already dropped every player whose spotting
 * is off, so this roster cannot credit them; the harness says so.
 */
export function rosterFromWatchlist(watchlist: readonly WatchlistEntry[]): StatsRosterPlayer[] {
  const home: SavedPlayer[] = [];
  const away: SavedPlayer[] = [];
  for (const entry of watchlist) {
    for (const player of entry.players ?? []) {
      // Read from a file on disk, so nothing about its shape is taken on trust.
      if (typeof player?.last_name !== "string") continue;
      const saved = {
        jersey: player.jersey,
        first_name: player.first_name,
        last_name: player.last_name,
        position: player.position,
      };
      (player.side === "H" ? home : away).push(saved);
    }
  }
  return statsRoster(home, away);
}

/**
 * The rosters as the prompt reads them, one player per line, as short as it
 * can be (Jed, Oct 4: both rosters ride along on every call, so their size is
 * most of what a game costs). The playerId already says the side, the number
 * and the surname, so a line adds only what it does not: the first name, which
 * tells "Jeremiah Smith" from the other Smiths, and the position, which says
 * who carries and who tackles. "H22-LANGAN Sam RB". A player with "heard as"
 * forms gets them in brackets, because that is how the transcript will spell
 * him: "H7-FIFITA Noah QB (heard as fafitaga, lafitaga)".
 *
 * Sorted by id, so the same two rosters are the same bytes on every call and
 * the prompt cache holds for the whole game.
 */
export function rostersForPrompt(players: readonly StatsRosterPlayer[]): string {
  const lines = [...players]
    .sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0))
    .map((player) => {
      const line = [player.playerId, player.first?.trim(), player.position?.trim()].filter(Boolean).join(" ");
      const heard = (player.aliases ?? []).map((form) => form.trim()).filter(Boolean);
      return heard.length > 0 ? `${line} (heard as ${heard.join(", ")})` : line;
    });
  return `THE TWO ROSTERS
Every playerId you may use, one per line, followed by the player's first name and position when the roster has them. "(heard as ...)" lists ways the transcript has spelled that player's surname before: a word like one of them is that player.
A playerId is the side (H home, A away), the jersey number, a hyphen and the surname in capitals, with underscores for spaces: H22-LANGAN is home #22 Langan, and A-DE_LA_CRUZ is an away De La Cruz with no number.

${lines.join("\n")}`;
}
