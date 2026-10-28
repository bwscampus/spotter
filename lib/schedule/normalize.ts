import { isCalendarDate, isSite, MAX_GAMES, MAX_OPPONENT_CHARS, MAX_SCORE, type Site } from "./types";

// =============================================================================
// What the model read off a schedule, turned into rows for the review table
// (docs/V3_DEFINITION.md 6.7). The schema (lib/schedule/schedulePrompt.ts)
// guarantees the shape; this re-checks the content, works out any year the
// source left off, and flags the rows to look at. Pure, so it is tested.
// =============================================================================

/** One game as the model returns it. */
export interface ExtractedGame {
  month: number;
  day: number;
  /** Only when the source shows it. */
  year: number | null;
  opponent: string;
  site: Site;
  team_score: number | null;
  opponent_score: number | null;
  is_league: boolean;
  /** The model is not sure about something on this row. */
  unsure: boolean;
  /** What it is not sure about, in a few words. */
  note: string;
}

export interface ExtractedSchedule {
  games: ExtractedGame[];
  warnings: string[];
}

/**
 * One row of the review table. Scores are text while they are being typed, so
 * a cleared box is a blank rather than a zero; review.ts turns them back into
 * numbers for the save.
 */
export interface ScheduleDraft {
  /** Stable for React, and for nothing else. */
  key: string;
  /** "YYYY-MM-DD", or "" when no date could be read. */
  date: string;
  opponent: string;
  site: Site;
  teamScore: string;
  opponentScore: string;
  league: boolean;
  /** Why to look at this row: shown as an amber badge. Empty for a clean row. */
  flags: string[];
}

export interface NormalizedSchedule {
  games: ScheduleDraft[];
  warnings: string[];
}

export interface ScheduleContext {
  /** The team's season as saved ("26-27", "2026", "Fall 2026"), or null. */
  season: string | null;
  /** Today in the announcer's time zone, "YYYY-MM-DD". */
  today: string;
}

export const UNSURE_NOTE = "StatCast wasn't sure about this row.";
export const ONE_SCORE_NOTE = "Only one score was read. Type both, or clear both for a game not played yet.";
export const FUTURE_SCORE_NOTE = "This game has a score but is dated after today.";
export const NO_DATE_NOTE = "The date could not be read. Type it in.";
export const NO_OPPONENT_NOTE = "No opponent was read. Type it in.";
export const TOO_MANY_NOTE = `Only the first ${MAX_GAMES} games were kept.`;

// -----------------------------------------------------------------------------
// The year (Jed, Oct 28: "When the year is missing, infer it from the season")
// -----------------------------------------------------------------------------

/** A season's years: "26-27" is 2026 and 2027, "2026" or "Fall 2026" is 2026 alone. Null when it names none. */
export function seasonYears(season: string | null | undefined): { first: number; second: number | null } | null {
  const found = (season ?? "").match(/\d{4}|\d{2}/g);
  if (!found) return null;
  const years = found.map((text) => (text.length === 2 ? 2000 + Number(text) : Number(text)));
  const first = years[0]!;
  if (first < 1990 || first > 2100) return null;
  const second = years[1] === first + 1 ? first + 1 : null;
  return { first, second };
}

function dayNumber(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function dateText(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Of a few years, the one that puts month and day nearest the target day. */
function nearest(month: number, day: number, years: number[], target: number): number {
  let best = years[0]!;
  for (const year of years) {
    if (Math.abs(dayNumber(year, month, day) - target) < Math.abs(dayNumber(best, month, day) - target)) best = year;
  }
  return best;
}

/**
 * The year for each game, in the order given. A year the source shows is kept.
 * Otherwise, in order:
 *  1. other games' shown years: the year that puts this game nearest one of them;
 *  2. the season: with two years ("26-27"), July to December is the first and
 *     January to June the second; with one, that year, except that a schedule
 *     running from the autumn into the new year puts January to June in the next;
 *  3. neither: the year that puts the game nearest today.
 */
export function inferYears(
  games: ReadonlyArray<Pick<ExtractedGame, "month" | "day" | "year">>,
  context: ScheduleContext,
): number[] {
  const shown = games
    .filter((game) => game.year !== null && isCalendarDate(dateText(game.year, game.month, game.day)))
    .map((game) => dayNumber(game.year!, game.month, game.day));
  const season = seasonYears(context.season);
  const autumn = games.some((game) => game.month >= 7);
  const spring = games.some((game) => game.month <= 6);
  const todayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(context.today);
  const todayYear = todayMatch ? Number(todayMatch[1]) : new Date().getUTCFullYear();
  const todayDay = todayMatch ? dayNumber(todayYear, Number(todayMatch[2]), Number(todayMatch[3])) : 0;

  return games.map((game) => {
    if (game.year !== null && game.year >= 1990 && game.year <= 2100) return game.year;
    if (shown.length > 0) {
      let best: number | null = null;
      let bestGap = Infinity;
      for (const anchor of shown) {
        const anchorYear = new Date(anchor * 86_400_000).getUTCFullYear();
        const year = nearest(game.month, game.day, [anchorYear - 1, anchorYear, anchorYear + 1], anchor);
        const gap = Math.abs(dayNumber(year, game.month, game.day) - anchor);
        if (gap < bestGap) {
          bestGap = gap;
          best = year;
        }
      }
      return best!;
    }
    if (season?.second) return game.month >= 7 ? season.first : season.second;
    if (season) return autumn && spring && game.month <= 6 ? season.first + 1 : season.first;
    return nearest(game.month, game.day, [todayYear - 1, todayYear, todayYear + 1], todayDay);
  });
}

// -----------------------------------------------------------------------------
// The rows
// -----------------------------------------------------------------------------

/** The opponent as the table keeps it: no "vs"/"@" in front, no record after, one space between words. */
export function cleanOpponent(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(vs\.?|versus|@|at)\s+/i, "")
    .replace(/\s*\(\s*\d+\s*-\s*\d+(\s*-\s*\d+)?\s*\)\s*$/, "")
    .replace(/[\s*]+$/, "")
    .trim()
    .slice(0, MAX_OPPONENT_CHARS);
}

function score(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SCORE ? value : null;
}

function asText(value: number | null): string {
  return value === null ? "" : String(value);
}

/** The reply, as rows for the review table, oldest first, with any year worked out and anything doubtful flagged. */
export function normalizeSchedule(reply: ExtractedSchedule, context: ScheduleContext): NormalizedSchedule {
  const warnings = (reply.warnings ?? []).map((warning) => String(warning).trim()).filter(Boolean);
  const read = (reply.games ?? []).filter(
    (game) => Number.isInteger(game.month) && Number.isInteger(game.day) && game.month >= 1 && game.month <= 12 && game.day >= 1 && game.day <= 31,
  );
  const unread = (reply.games ?? []).length - read.length;
  const years = inferYears(read, context);

  const seen = new Set<string>();
  const rows: ScheduleDraft[] = [];
  read.forEach((game, index) => {
    const date = dateText(years[index]!, game.month, game.day);
    const valid = isCalendarDate(date);
    const teamScore = score(game.team_score);
    const opponentScore = score(game.opponent_score);
    const opponent = cleanOpponent(String(game.opponent ?? ""));
    const site: Site = isSite(game.site) ? game.site : "H";

    const flags: string[] = [];
    if (game.unsure) flags.push(game.note?.trim() || UNSURE_NOTE);
    if (!valid) flags.push(NO_DATE_NOTE);
    if (!opponent) flags.push(NO_OPPONENT_NOTE);
    if ((teamScore === null) !== (opponentScore === null)) flags.push(ONE_SCORE_NOTE);
    if (valid && teamScore !== null && opponentScore !== null && date > context.today) flags.push(FUTURE_SCORE_NOTE);

    // The same game listed twice (a page that repeats its table) is one game.
    const identity = [valid ? date : "", opponent.toLowerCase(), site, teamScore, opponentScore].join("|");
    if (seen.has(identity)) return;
    seen.add(identity);

    rows.push({
      key: `read-${index}`,
      date: valid ? date : "",
      opponent,
      site,
      teamScore: asText(teamScore),
      opponentScore: asText(opponentScore),
      league: game.is_league === true,
      flags,
    });
  });

  // Oldest first; a row with no date goes last, where it is easy to find.
  rows.sort((a, b) => (a.date === b.date ? 0 : !a.date ? 1 : !b.date ? -1 : a.date < b.date ? -1 : 1));
  if (unread > 0) warnings.push(unread === 1 ? "1 row had no readable date and was left out." : `${unread} rows had no readable date and were left out.`);
  if (rows.length > MAX_GAMES) warnings.push(TOO_MANY_NOTE);
  return { games: rows.slice(0, MAX_GAMES), warnings };
}
