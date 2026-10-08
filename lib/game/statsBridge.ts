import type { CardLines } from "@/lib/cards/lines";

// =============================================================================
// What the live screen knows about live stats, and nothing more.
//
// The live screen is the card path, so it may never import lib/livestats/
// (docs/V3_DEFINITION.md G3, test/cardPathIsolation.test.ts). The stats loop
// is put together outside it, in components/livestats/, and handed in as this
// object. The live screen tells it what was said and which keys were pressed,
// reads the card lines it keeps, and hears when they change. It never learns
// what a play is.
// =============================================================================

/** The counts a game's end needs from live stats: called_games and game.ended (9.1, 10.2). */
export interface StatsCounts {
  /** Plays OK'd, counting a play OK'd again after U. */
  playsApplied: number;
  /** Presses of U that took a play back. */
  playsUndone: number;
  /** Stats were on at the start and turned off during the game. */
  offMidGame: boolean;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
}

export const NO_STATS_COUNTS: StatsCounts = {
  playsApplied: 0,
  playsUndone: 0,
  offMidGame: false,
  tokensIn: 0,
  tokensOut: 0,
  tokensCached: 0,
};

/** What changed, for the cards already up: each player's chip text, by playerKey ("H22-LANGAN"). */
export interface StatsChange {
  chips: ReadonlyMap<string, string>;
}

export interface LiveStatsBridge {
  /**
   * Something was said: a final, with its text and when it arrived. Called
   * after paint, never from the hot path.
   */
  heard(text: string, at: number): void;
  /** Each player's card lines with tonight in them, by playerKey. Players with nothing tonight are absent. */
  lines(): ReadonlyMap<string, CardLines>;
  /** Listens for changes to the lines. Returns the way to stop. */
  subscribe(listener: (change: StatsChange) => void): () => void;
  /** Enter, Backspace or U on the live screen. */
  key(action: "ok" | "discard" | "undo"): void;
  /** Whether Enter, Backspace and U belong to stats on this game. */
  keysLive(): boolean;
  /** So far this game, for End game. */
  counts(): StatsCounts;
  /**
   * End game: one last read of what was said since the last one, applied
   * before the game closes. Resolves when it is done, or failed, or took too
   * long; never throws. Called on End game's click, nowhere near the hot path.
   */
  finish(): Promise<void>;
}
