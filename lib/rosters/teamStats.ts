import { daysBetween, STALE_STATS_DAYS } from "@/lib/game/staleStats";

/**
 * How old a team's season stats are on `today`, and whether that is old enough
 * to warn about: the same rule game setup warns by (lib/game/staleStats.ts).
 * Null when the team has no stats.
 */
export function statsAge(statsAsOf: string | null, today: string): { days: number; stale: boolean } | null {
  if (!statsAsOf) return null;
  const days = daysBetween(statsAsOf, today);
  if (days === null) return null;
  return { days, stale: days >= STALE_STATS_DAYS };
}
