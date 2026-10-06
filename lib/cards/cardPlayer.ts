import type { WatchlistPlayer } from "@/lib/watchlist";
import { seasonLines } from "./lines";
import { cleanFootballStats } from "./statKeys";

// =============================================================================
// A saved player as their card shows them. The one place that decides what a
// card says, so the cards preview and the live screen cannot drift apart: both
// build their cards through toCardPlayer.
//
// Everything is worked out here, before a game starts. The card path only
// copies these strings into the DOM; it never formats a date or builds a line
// while a name is being spotted.
// =============================================================================

/** A player as saved in roster_players, with the fields a card needs. */
export interface CardSource {
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  position: string | null;
  grade: string | null;
  height: string | null;
  weight: string | null;
  pronunciations: string[];
  /** Football numbers keyed by the 9.2 stat keys. Anything else in it is ignored. */
  season_stats: unknown;
  /** Other sports: the lines as written. */
  season_lines: string[];
  /** "YYYY-MM-DD", as Postgres returns a date. */
  stats_as_of: string | null;
}

export function toCardPlayer(player: CardSource, sport: string | null, side: "H" | "A"): WatchlistPlayer {
  const lines =
    sport === "football"
      ? seasonLines(cleanFootballStats(player.season_stats))
      : player.season_lines.map((line) => line.trim()).filter((line) => line.length > 0);

  return {
    jersey: player.jersey,
    first_name: player.first_name,
    last_name: player.last_name,
    position: player.position,
    grade: player.grade,
    height: player.height,
    weight: player.weight,
    side,
    stat_lines: lines,
    pronunciation: player.pronunciations.map((note) => note.trim()).find((note) => note.length > 0) ?? null,
    // A date with no stats under it would only raise the question "as of what".
    as_of: lines.length > 0 ? asOfLabel(player.stats_as_of) : null,
  };
}

/**
 * "as of 9/26" from "2026-09-26". Read from the string, not through Date, which
 * would take midnight UTC and show the day before anywhere west of Greenwich.
 */
export function asOfLabel(date: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date?.trim() ?? "");
  if (!match) return null;
  return `as of ${Number(match[2])}/${Number(match[3])}`;
}

/**
 * Jersey order for lists of cards: by number, "0" before "00" before "1", and
 * players with no number (or a non-numeric one) last, by surname.
 */
export function byJersey<T extends { jersey: string | null; last_name: string }>(a: T, b: T): number {
  const key = (jersey: string | null) => {
    const trimmed = (jersey ?? "").trim().replace(/^#/, "");
    return /^\d+$/.test(trimmed) ? { n: Number(trimmed), len: trimmed.length } : null;
  };
  const ka = key(a.jersey);
  const kb = key(b.jersey);
  if (ka && kb) return ka.n - kb.n || ka.len - kb.len || a.last_name.localeCompare(b.last_name);
  if (ka) return -1;
  if (kb) return 1;
  return a.last_name.localeCompare(b.last_name);
}
