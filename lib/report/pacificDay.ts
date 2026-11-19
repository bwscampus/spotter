// The daily usage email's calendar (Nov 19). Pure: no clock, no database.
//
// A report covers one day in Pacific time, midnight to midnight, which is 23
// hours on the spring-forward Sunday and 25 on the fall-back one. Dates are
// 'YYYY-MM-DD' strings, the way the database's `date` columns arrive
// (lib/server/db.ts), so no time zone can move them.

export const REPORT_TIME_ZONE = "America/Los_Angeles";
/** The report for yesterday goes out at the first check after this hour, Pacific. */
export const REPORT_HOUR = 6;

const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type Fields = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function fields(instant: Date): Fields {
  const out: Record<string, number> = {};
  for (const part of clock.formatToParts(instant)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateOf = (f: { year: number; month: number; day: number }) => `${f.year}-${pad(f.month)}-${pad(f.day)}`;

/** Pacific wall-clock time minus UTC at this instant, in ms (-8 h in winter, -7 h in summer). */
function offsetMs(instant: Date): number {
  const f = fields(instant);
  const wholeSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - wholeSeconds;
}

/** The Pacific date and time of day at an instant. */
export function pacificClock(instant: Date): { date: string; hour: number; minute: number } {
  const f = fields(instant);
  return { date: dateOf(f), hour: f.hour, minute: f.minute };
}

/** Whether a string is a real calendar date written 'YYYY-MM-DD'. */
export function isReportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The date `days` after (or before) a date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return dateOf({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

/** The instant a Pacific date starts. DST changes at 2 AM, so midnight always exists and is never doubled. */
export function pacificMidnight(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  // Two passes: the offset at a first guess, then at the answer it gives.
  const first = wall - offsetMs(new Date(wall));
  return new Date(wall - offsetMs(new Date(first)));
}

/** The day a report covers: [start, end) as instants. */
export function pacificDayWindow(date: string): { start: Date; end: Date } {
  return { start: pacificMidnight(date), end: pacificMidnight(addDays(date, 1)) };
}

/** The date whose report is due at this instant: yesterday, once it is past REPORT_HOUR Pacific; else null. */
export function reportDue(now: Date): string | null {
  const today = pacificClock(now);
  if (today.hour < REPORT_HOUR) return null;
  return addDays(today.date, -1);
}

const dayName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** "Wed, Nov 18, 2026" for a date. */
export function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return dayName.format(new Date(Date.UTC(y, m - 1, d, 12)));
}

const timeOfDay = new Intl.DateTimeFormat("en-US", { timeZone: REPORT_TIME_ZONE, hour: "numeric", minute: "2-digit" });
const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: REPORT_TIME_ZONE, month: "short", day: "numeric" });

/** "7:05 PM" Pacific, with "Nov 19 " in front when the instant is not on `date`. */
export function pacificTime(instant: Date, date: string): string {
  const time = timeOfDay.format(instant);
  return pacificClock(instant).date === date ? time : `${monthDay.format(instant)} ${time}`;
}
