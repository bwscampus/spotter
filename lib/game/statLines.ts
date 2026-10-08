import type { CardLines } from "@/lib/cards/lines";
import { playerKey } from "@/lib/cards/playerKey";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// Live stats speak in playerKeys ("H22-LANGAN"); the cards are put up as the
// WatchlistPlayer objects the engine hands over. These turn one into the
// other, after paint, so the hot path only ever reads a ready map.
//
// Shared by the live screen and the G5 replay (lib/replay/cardEquality.ts), so
// the replay puts tonight's lines on cards exactly the way a game does. Card
// path code: it may not import lib/livestats/ (docs/V3_DEFINITION.md G3).
// =============================================================================

/** Every player the cards can show, by the key live stats uses for them. */
export function playersByKey(watchlist: readonly WatchlistEntry[]): Map<string, WatchlistPlayer> {
  const byKey = new Map<string, WatchlistPlayer>();
  for (const entry of watchlist) for (const player of entry.players ?? []) byKey.set(playerKey(player), player);
  return byKey;
}

/** Each player's card lines, keyed the way the cards are. Players with no card tonight are left out. */
export function linesForCards(
  lines: ReadonlyMap<string, CardLines>,
  byKey: ReadonlyMap<string, WatchlistPlayer>,
): Map<WatchlistPlayer, CardLines> {
  const forCards = new Map<WatchlistPlayer, CardLines>();
  for (const [key, entry] of lines) {
    const player = byKey.get(key);
    if (player) forCards.set(player, entry);
  }
  return forCards;
}

/** The chips a play just added, keyed the way the cards are. */
export function chipsForCards(
  chips: ReadonlyMap<string, string>,
  byKey: ReadonlyMap<string, WatchlistPlayer>,
): Map<WatchlistPlayer, string> {
  const forCards = new Map<WatchlistPlayer, string>();
  for (const [key, chip] of chips) {
    const player = byKey.get(key);
    if (player) forCards.set(player, chip);
  }
  return forCards;
}
