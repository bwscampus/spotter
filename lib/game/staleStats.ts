import type { SetupSide } from "./setupReturn";

// =============================================================================
// Season stats that have gone stale (docs/V3_DEFINITION.md 6.4 and 7.1).
//
// Cards read season numbers on air as fact, and a team plays about once a
// week, so a stats sheet a week old is missing at least a game. Game setup
// warns about either team whose stats are that old, with a way to import this
// week's sheet and come straight back. It never stops the game from starting.
//
// Old is counted from the stats' "as of" date, which is the day of the import
// unless the announcer set it to the sheet's own date. That is the date the
// card stamps, and the only one the database keeps.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Stats this many days old, or older, get the warning. */
export const STALE_STATS_DAYS = 7;

// =============================================================================

export interface StaleStats {
  side: SetupSide;
  rosterId: string;
  school: string;
  /** "YYYY-MM-DD". */
  asOf: string;
  days: number;
}

/** What setup knows about each side's stats. */
interface SideStats {
  id: string;
  school: string;
  /** The newest "as of" date on any of the team's players, or null when it has no season stats. */
  statsAsOf: string | null;
}

/** Whole calendar days from one "YYYY-MM-DD" date to another, or null when either is not a date. */
export function daysBetween(from: string, to: string): number | null {
  const start = calendarDay(from);
  const end = calendarDay(to);
  if (start === null || end === null) return null;
  return Math.round((end - start) / 86_400_000);
}

/** Either team whose stats are STALE_STATS_DAYS old or older on `today`, away first. */
export function staleStats(sides: { away: SideStats; home: SideStats }, today: string): StaleStats[] {
  const stale: StaleStats[] = [];
  for (const side of ["away", "home"] as const) {
    const team = sides[side];
    if (!team.statsAsOf) continue;
    const days = daysBetween(team.statsAsOf, today);
    if (days === null || days < STALE_STATS_DAYS) continue;
    stale.push({ side, rosterId: team.id, school: team.school, asOf: team.statsAsOf, days });
  }
  return stale;
}

/** The newest of a team's "as of" dates. One import stamps every player alike, so this is that import's. */
export function newestAsOf(dates: ReadonlyArray<string | null>): string | null {
  let newest: string | null = null;
  for (const date of dates) {
    if (date && calendarDay(date) !== null && (newest === null || date > newest)) newest = date;
  }
  return newest;
}

/**
 * Days since the epoch for a "YYYY-MM-DD" date, read from the string through
 * UTC so a time zone or a daylight saving change can never move it.
 */
function calendarDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? time : null;
}
