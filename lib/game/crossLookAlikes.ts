import { STAR_KEEP_RATIO } from "@/lib/matching/stars";
import type { Collision } from "@/lib/rosters/buildWatchlist";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// A bench name that sounds like a star's (Oct 4). Deepgram was told to listen
// for every name on both rosters, and wrote Lafitaga, Faupusa and Funa, three
// Arizona reserves, in place of Fifita, the quarterback, forty times. The
// look-alike check already finds the pair at setup; this says which of the
// two is the bench name, drops its keyterm so Deepgram is no longer told to
// listen for it, and offers one click to turn its spotting off.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A player called at least this often a game is a star another name can be mistaken for. */
export const HIGH_PRIORITY = 1;

// =============================================================================

export interface LookAlikePlayer {
  side: "H" | "A";
  jersey: string | null;
  last_name: string;
  /** The saved row, so setup can turn spotting off with one click. Null when the game was built without ids. */
  id: string | null;
}

export interface LookAlikeDrop {
  /** The bench entry, as the setup screen names it. */
  low: string;
  lowRate: number;
  /** The star it sounds like. */
  high: string;
  highRate: number;
  score: number;
  /** The bench entry's players. */
  players: LookAlikePlayer[];
}

/**
 * Among the look-alike pairs, the ones where one name belongs to a player
 * called HIGH_PRIORITY times a game or more and the other to a player called
 * no more than STAR_KEEP_RATIO of that: the second is the bench name.
 * `rowId` finds a player's saved row, for the one-click spotting off.
 */
export function lookAlikeDrops(
  entries: readonly WatchlistEntry[],
  collisions: readonly Collision[],
  rowId: (player: WatchlistPlayer) => string | null = () => null,
): LookAlikeDrop[] {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const rate = (entry: WatchlistEntry) => Math.max(0, ...(entry.players ?? []).map((player) => player.priority ?? 0));
  const drops = new Map<string, LookAlikeDrop>();

  for (const collision of collisions) {
    const a = byName.get(collision.a);
    const b = byName.get(collision.b);
    if (!a || !b) continue;
    const ra = rate(a);
    const rb = rate(b);
    const [high, low, highRate, lowRate] = ra >= rb ? [a, b, ra, rb] : [b, a, rb, ra];
    if (highRate < HIGH_PRIORITY || lowRate > highRate * STAR_KEEP_RATIO) continue;
    const already = drops.get(low.name);
    if (already && already.highRate >= highRate) continue;
    drops.set(low.name, {
      low: low.label || low.name,
      lowRate,
      high: high.label || high.name,
      highRate,
      score: collision.score,
      players: (low.players ?? []).map((player) => ({
        side: player.side,
        jersey: player.jersey,
        last_name: player.last_name,
        id: rowId(player),
      })),
    });
  }
  return [...drops.values()];
}

/** The keyterms the drops take out: the bench entries' keyterms. */
export function droppedKeyterms(entries: readonly WatchlistEntry[], drops: readonly LookAlikeDrop[]): Set<string> {
  const lowNames = new Set(drops.map((drop) => drop.low));
  const terms = new Set<string>();
  for (const entry of entries) {
    if (lowNames.has(entry.label || entry.name)) terms.add((entry.keyterm ?? entry.name).trim().toLowerCase());
  }
  return terms;
}
