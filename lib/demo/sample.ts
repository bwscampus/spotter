import { toCardPlayer } from "@/lib/cards/cardPlayer";
import type { WatchlistPlayer } from "@/lib/watchlist";
import { DEMO_AWAY, DEMO_HOME, DEMO_PLAYER_ROWS } from "./footballDemo";

// =============================================================================
// The demo's players as cards, for the dashboard's mini cards (empty states,
// the landing page): the made-up teams through the real toCardPlayer, so a
// mini card says what a real one would. Pure; no engine.
// =============================================================================

export interface SampleCard {
  player: WatchlistPlayer;
  school: string;
  color: string | null;
}

/** The demo's player with this surname as a card, or null. */
export function sampleCard(lastName: string): SampleCard | null {
  const row = DEMO_PLAYER_ROWS.find((candidate) => candidate.last_name === lastName);
  if (!row) return null;
  const team = row.roster_id === DEMO_HOME.id ? DEMO_HOME : DEMO_AWAY;
  const side = team === DEMO_HOME ? "H" : "A";
  return {
    player: toCardPlayer(row, "football", side),
    school: team.school,
    color: team.primary_color ?? null,
  };
}
