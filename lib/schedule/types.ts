// =============================================================================
// A team's season schedule, as the app holds it: one entry a game. Saved in
// schedule_games (db/migrations/0020_team_schedule.sql), imported on the Team
// page's Schedule screen, carried into the game on each side of the snapshot,
// and shown in the live screen's team panel (docs/PANEL_SPEC.md).
// =============================================================================

/** Where the game is played, from this team's side: home, away, or a neutral site. */
export type Site = "H" | "A" | "N";

export const SITES: readonly Site[] = ["H", "A", "N"];

/** The most games one schedule can hold. set_schedule refuses more. */
export const MAX_GAMES = 80;

/** The longest opponent name the table takes. */
export const MAX_OPPONENT_CHARS = 100;

/** The highest score either side can have. */
export const MAX_SCORE = 999;

export interface ScheduleGame {
  /** A calendar date, "YYYY-MM-DD". Read from the string, never through a time zone. */
  date: string;
  opponent: string;
  site: Site;
  /** This team's score, or null when the game has not been played. */
  teamScore: number | null;
  /** The opponent's score: null exactly when teamScore is. */
  opponentScore: number | null;
  /** A league (conference) game, which counts toward the league record. */
  league: boolean;
}

/** One saved game as the database sends it (the columns of schedule_games). */
export interface ScheduleRow {
  team_id: string;
  game_date: string;
  opponent: string;
  site: string;
  team_score: number | null;
  opponent_score: number | null;
  is_league: boolean;
}

/** One game as PUT /api/rosters/[id]/schedule takes it, and set_schedule after it. */
export interface ScheduleSaveGame {
  game_date: string;
  opponent: string;
  site: Site;
  team_score: number | null;
  opponent_score: number | null;
  is_league: boolean;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written "YYYY-MM-DD": no February 30th. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isSite(value: unknown): value is Site {
  return value === "H" || value === "A" || value === "N";
}

function isScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SCORE;
}

/** Exactly what a saved game must look like: the table's own checks, in the browser. */
export function isScheduleGame(value: unknown): value is ScheduleGame {
  if (typeof value !== "object" || value === null) return false;
  const game = value as Partial<ScheduleGame>;
  const scored = isScore(game.teamScore) && isScore(game.opponentScore);
  const unplayed = game.teamScore === null && game.opponentScore === null;
  return (
    isCalendarDate(game.date) &&
    typeof game.opponent === "string" &&
    game.opponent.trim().length > 0 &&
    game.opponent.length <= MAX_OPPONENT_CHARS &&
    isSite(game.site) &&
    (scored || unplayed) &&
    typeof game.league === "boolean"
  );
}

/** A saved row as the game holds it. Null for a row that is not a game, which is then left out. */
export function fromRow(row: ScheduleRow): ScheduleGame | null {
  const game: ScheduleGame = {
    date: String(row.game_date).slice(0, 10),
    opponent: String(row.opponent ?? "").trim(),
    site: row.site as Site,
    teamScore: row.team_score ?? null,
    opponentScore: row.opponent_score ?? null,
    league: row.is_league === true,
  };
  return isScheduleGame(game) ? game : null;
}

/** One team's games out of the rows read for a game, in date order. */
export function scheduleFor(rows: readonly ScheduleRow[] | undefined, teamId: string): ScheduleGame[] {
  return (rows ?? [])
    .filter((row) => row.team_id === teamId)
    .map(fromRow)
    .filter((game): game is ScheduleGame => game !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** A game as the save sends it. */
export function toSaveGame(game: ScheduleGame): ScheduleSaveGame {
  return {
    game_date: game.date,
    opponent: game.opponent.trim(),
    site: game.site,
    team_score: game.teamScore,
    opponent_score: game.opponentScore,
    is_league: game.league,
  };
}
