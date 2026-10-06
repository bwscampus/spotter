// =============================================================================
// How a game went, counted while it is called, for called_games and for the
// game.ended event.
//
// PRIVACY: counts and milliseconds only. Nothing here says who was spotted.
//
// The counting is pure (every function takes counts and returns new counts), so
// the numbers End game writes can be tested without a microphone. The live
// screen keeps the current counts in a ref, updates them after paint, and
// mirrors them to localStorage so a reload mid-game, or a game ended from the
// menu, still has them.
// =============================================================================

import { REMOVAL_KEYS, type RemovalKey } from "@/lib/keys";
import type { LogRow } from "@/lib/matching/matchLog";

// =============================================================================
// TUNING
// =============================================================================

/** Card latencies kept for p50 and p95. A game puts up a few hundred cards; this is far past it. */
export const MAX_LATENCY_SAMPLES = 2000;

// =============================================================================

export interface LiveCounts {
  /** Seconds the mic was open, across every start and stop. Excludes a stretch still open. */
  micSeconds: number;
  /** Drops into reconnecting. */
  reconnects: number;
  /** Match rows: every time a card went up or was narrowed to one player. V2 counted matches the same way. */
  cardsShown: number;
  /** Cards taken down, by the key that did it. */
  removedByKey: Record<RemovalKey, number>;
  /** Refresh rosters that rebuilt the game. */
  refreshes: number;
  /** Result arrival to card painted, per card that was painted. */
  latenciesMs: number[];
}

export const EMPTY_COUNTS: LiveCounts = {
  micSeconds: 0,
  reconnects: 0,
  cardsShown: 0,
  removedByKey: { x: 0, "1": 0, "2": 0, "3": 0 },
  refreshes: 0,
  latenciesMs: [],
};

/** What one Deepgram result did to the counts, after paint. latencyMs is null when nothing was painted. */
export function countResult(counts: LiveCounts, rows: LogRow[], latencyMs: number | null): LiveCounts {
  const shown = rows.filter((row) => row.type === "match").length;
  if (shown === 0) return counts;
  const latenciesMs =
    latencyMs === null || counts.latenciesMs.length >= MAX_LATENCY_SAMPLES
      ? counts.latenciesMs
      : [...counts.latenciesMs, latencyMs];
  return { ...counts, cardsShown: counts.cardsShown + shown, latenciesMs };
}

export function countRemoval(counts: LiveCounts, key: RemovalKey): LiveCounts {
  return { ...counts, removedByKey: { ...counts.removedByKey, [key]: counts.removedByKey[key] + 1 } };
}

export function countMicStretch(counts: LiveCounts, seconds: number): LiveCounts {
  return { ...counts, micSeconds: counts.micSeconds + Math.max(0, Math.round(seconds)) };
}

export function countReconnect(counts: LiveCounts): LiveCounts {
  return { ...counts, reconnects: counts.reconnects + 1 };
}

export function countRefresh(counts: LiveCounts): LiveCounts {
  return { ...counts, refreshes: counts.refreshes + 1 };
}

export function cardsRemoved(counts: LiveCounts): number {
  return REMOVAL_KEYS.reduce((sum, key) => sum + counts.removedByKey[key], 0);
}

/** The value below which `fraction` of the samples fall, nearest rank. Null with no samples. */
export function percentile(samples: number[], fraction: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[rank]);
}

/**
 * The counts section 9.1 puts on called_games at End game. Stat plays are zero
 * until live stats exist (item 13).
 */
export function endedRow(counts: LiveCounts, endedAt: Date) {
  return {
    ended_at: endedAt.toISOString(),
    mic_seconds: counts.micSeconds,
    reconnects: counts.reconnects,
    cards_shown: counts.cardsShown,
    cards_removed: cardsRemoved(counts),
    stat_plays_added: 0,
    stat_plays_undone: 0,
  };
}

/** The game.ended props (docs/V3_DEFINITION.md 10.2). Counts only. */
export function endedEventProps(counts: LiveCounts, startedAt: Date, endedAt: Date) {
  return {
    minutes: Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000)),
    mic_seconds: counts.micSeconds,
    reconnects: counts.reconnects,
    cards_shown: counts.cardsShown,
    cards_removed: cardsRemoved(counts),
    cards_removed_x: counts.removedByKey.x,
    cards_removed_1: counts.removedByKey["1"],
    cards_removed_2: counts.removedByKey["2"],
    cards_removed_3: counts.removedByKey["3"],
    refreshes: counts.refreshes,
    plays_applied: 0,
    plays_undone: 0,
    stats_off_mid_game: false,
    card_latency_p50_ms: percentile(counts.latenciesMs, 0.5),
    card_latency_p95_ms: percentile(counts.latenciesMs, 0.95),
  };
}

// -----------------------------------------------------------------------------
// The mirror in localStorage. Never read or written in the hot path: the live
// screen writes after paint and on button presses.
// -----------------------------------------------------------------------------

const KEY_PREFIX = "spotter.v3.counts.";

export function readLiveCounts(gameId: string): LiveCounts {
  try {
    return parseCounts(localStorage.getItem(KEY_PREFIX + gameId)) ?? EMPTY_COUNTS;
  } catch {
    return EMPTY_COUNTS;
  }
}

export function writeLiveCounts(gameId: string, counts: LiveCounts) {
  try {
    localStorage.setItem(KEY_PREFIX + gameId, JSON.stringify(counts));
  } catch {
    // The counts are still in memory. Only a reload would lose them.
  }
}

export function clearLiveCounts(gameId: string) {
  try {
    localStorage.removeItem(KEY_PREFIX + gameId);
  } catch {
    // Nothing to do.
  }
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Checked rather than trusted, because it survives deploys. */
export function parseCounts(raw: string | null): LiveCounts | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LiveCounts>;
    const removed = value.removedByKey as Partial<Record<RemovalKey, unknown>> | undefined;
    if (
      !isCount(value.micSeconds) ||
      !isCount(value.reconnects) ||
      !isCount(value.cardsShown) ||
      !isCount(value.refreshes) ||
      !removed ||
      !REMOVAL_KEYS.every((key) => isCount(removed[key])) ||
      !Array.isArray(value.latenciesMs) ||
      !value.latenciesMs.every(isCount)
    ) {
      return null;
    }
    return value as LiveCounts;
  } catch {
    return null;
  }
}
