import { teamKeyterms, type TeamSource } from "@/lib/game/teamSounds";
import type { WatchlistEntry } from "@/lib/watchlist";

// =============================================================================
// Who keeps Deepgram's name boost when both rosters are over its limit (Jed,
// Oct 3). Deepgram takes about 500 tokens of keyterms, which two college
// rosters pass; past it, the whole boost used to be dropped, and every name
// was heard cold.
//
// Instead the names go in the order of how often each player is called
// (lib/cards/callRate.ts), the two teams taking turns so neither loses its
// boost to the other, and Deepgram keeps the longest front of that list it
// accepts (POST /api/deepgram/check-keyterms finds it). Everyone is still
// listened for; only the boost is shared out.
// =============================================================================

/**
 * Every entry's keyterm, most called first, alternating teams. A surname
 * shared by teammates counts at its most called player's rate and goes with
 * that player's team. Ties keep roster order.
 */
export function keytermsByPriority(entries: readonly WatchlistEntry[]): string[] {
  const sides: Record<"H" | "A", Array<{ term: string; rate: number; order: number }>> = { H: [], A: [] };
  const seen = new Set<string>();

  entries.forEach((entry, order) => {
    const term = (entry.keyterm ?? entry.name).trim();
    if (!term || seen.has(term.toLowerCase())) return;
    seen.add(term.toLowerCase());
    // An entry from a game saved before cards has no players: it keeps roster order.
    const players = entry.players ?? [];
    let best = players[0];
    for (const player of players) if ((player.priority ?? 0) > (best?.priority ?? 0)) best = player;
    sides[best?.side ?? "H"].push({ term, rate: best?.priority ?? 0, order });
  });

  for (const list of Object.values(sides)) list.sort((a, b) => b.rate - a.rate || a.order - b.order);

  const ordered: string[] = [];
  for (let i = 0; i < Math.max(sides.H.length, sides.A.length); i++) {
    if (sides.H[i]) ordered.push(sides.H[i].term);
    if (sides.A[i]) ordered.push(sides.A[i].term);
  }
  return ordered;
}

// -----------------------------------------------------------------------------
// Which names get the boost at all (Oct 4). Every player on both rosters went
// to Deepgram as a keyterm, 156 names in the Oct 3 game, and Deepgram wrote
// bench players' names in place of the starters' ("Fifita" came back as
// Lafitaga sixteen times and Faupusa eight). So the boost goes only to players
// who are likely to be named: anyone with a priority number or season stats,
// plus both schools and both mascots, which are said all game and otherwise
// land on whichever surname sounds nearest ("Rutgers" became Wortman).
// A roster with no stats for anyone keeps every name, as before.
// -----------------------------------------------------------------------------

export interface KeytermChoice {
  /** Whether each side has season stats for anyone. A side with none keeps every name. */
  rated: Record<"H" | "A", boolean>;
  /** Keyterms to leave out whatever their rating: low-priority names that sound like a star's (lib/game/crossLookAlikes.ts). */
  dropped?: ReadonlySet<string>;
}

/**
 * The keyterms a game sends: both teams' words first, then the names most
 * called first (keytermsByPriority), keeping only the entries with a player
 * who has a priority number or season stats, or who plays for a side with no
 * stats at all.
 */
export function selectKeyterms(entries: readonly WatchlistEntry[], teams: TeamSource[], choice: KeytermChoice): string[] {
  const keep = new Set<string>();
  for (const entry of entries) {
    const players = entry.players ?? [];
    const qualifies =
      players.length === 0 ||
      players.some((player) => (player.priority ?? 0) > 0 || player.hasStats === true || !choice.rated[player.side]);
    if (qualifies) keep.add((entry.keyterm ?? entry.name).trim().toLowerCase());
  }
  const dropped = new Set([...(choice.dropped ?? [])].map((term) => term.trim().toLowerCase()));

  const chosen: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const key = term.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    chosen.push(term.trim());
  };
  for (const word of teamKeyterms(teams)) add(word);
  for (const term of keytermsByPriority(entries)) {
    const key = term.toLowerCase();
    if (keep.has(key) && !dropped.has(key)) add(term);
  }
  return chosen;
}
