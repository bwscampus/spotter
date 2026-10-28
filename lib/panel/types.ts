import type { ScheduleGame } from "@/lib/schedule/types";
import type { TonightBoard } from "./leaders";

// =============================================================================
// What the team panel knows about live stats, and nothing more. The panel is
// not on the card path and not in live stats either: components/livestats/
// LiveGame.tsx, where the two meet, hands it this, built from the stats
// controller (the same session the cards' tonight lines come from, and the
// same change notices the cards rebuild on).
// =============================================================================

export interface TonightSource {
  /** Every player's totals tonight, and when each leader stat took its value. */
  board(): TonightBoard;
  /** Listens for changes to tonight's numbers. Returns the way to stop. */
  subscribe(listener: () => void): () => void;
}

/**
 * One side as the panel draws it: the snapshot's GameTeam fits as it is, so
 * the composition root hands it straight over and the panel never imports the
 * snapshot (which is the engine's business).
 */
export interface PanelTeam {
  name: string;
  /** "#rrggbb", or none: the side's default band, as its slab has. */
  color?: string | null;
  schedule?: readonly ScheduleGame[];
}
