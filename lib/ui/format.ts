// =============================================================================
// How the dashboard writes dates, ages and durations (docs/UI_STYLE.md). Pure,
// so each shape is tested. Dates with a time are formatted in the browser,
// because the server does not know the announcer's time zone.
// =============================================================================

/** "Oct 3, 9:12 PM", in the browser's time zone unless one is given. Empty for a bad date. */
export function shortDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })
    .replace(/[  ]/g, " ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A calendar date, "YYYY-MM-DD", as "Sep 24". Read from the string, so no time
 * zone can move it a day. The string itself when it is not a date.
 */
export function dayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
  if (!match) return date;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}` : date;
}

/** How old a team's stats are, for its badge: "9 d old". */
export function ageLabel(days: number): string {
  return `${days} d old`;
}

/** How long a game has been running: "1 h 48 min", "12 min". */
export function runningLabel(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/** "1 player", "52 players". */
export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}
