import type { ScheduleDraft } from "./normalize";
import { isCalendarDate, isSite, MAX_GAMES, MAX_OPPONENT_CHARS, MAX_SCORE, type ScheduleGame, type ScheduleSaveGame } from "./types";

// =============================================================================
// The Schedule screen's review table, as pure rules: what each row needs
// before Save, and exactly what Save sends to PUT /api/rosters/[id]/schedule
// (and set_schedule after it). The table edits drafts; nothing here touches
// the page.
// =============================================================================

/** What the extract route answers (app/api/schedule/extract/route.ts). */
export interface ScheduleExtractResponse {
  games: ScheduleDraft[];
  warnings: string[];
  format: string;
  route: "text" | "vision";
  pages?: number;
}

export function isScheduleExtractResponse(body: unknown): body is ScheduleExtractResponse {
  if (typeof body !== "object" || body === null) return false;
  const reply = body as Partial<ScheduleExtractResponse>;
  return (
    Array.isArray(reply.games) &&
    reply.games.every(
      (game) =>
        typeof game === "object" &&
        game !== null &&
        typeof game.key === "string" &&
        typeof game.date === "string" &&
        typeof game.opponent === "string" &&
        isSite(game.site) &&
        typeof game.teamScore === "string" &&
        typeof game.opponentScore === "string" &&
        typeof game.league === "boolean" &&
        Array.isArray(game.flags),
    ) &&
    Array.isArray(reply.warnings) &&
    typeof reply.format === "string" &&
    (reply.route === "text" || reply.route === "vision")
  );
}

let drafted = 0;

/** A saved game as a row of the table. */
export function draftOf(game: ScheduleGame): ScheduleDraft {
  drafted += 1;
  return {
    key: `saved-${drafted}`,
    date: game.date,
    opponent: game.opponent,
    site: game.site,
    teamScore: game.teamScore === null ? "" : String(game.teamScore),
    opponentScore: game.opponentScore === null ? "" : String(game.opponentScore),
    league: game.league,
    flags: [],
  };
}

/** A row typed by hand: "+ Add a game". */
export function emptyDraft(): ScheduleDraft {
  drafted += 1;
  return { key: `new-${drafted}`, date: "", opponent: "", site: "H", teamScore: "", opponentScore: "", league: false, flags: [] };
}

/** A typed score: a whole number from 0 to 999, null for a blank, NaN for anything else. */
export function typedScore(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d{1,3}$/.test(trimmed)) return Number.NaN;
  const value = Number(trimmed);
  return value <= MAX_SCORE ? value : Number.NaN;
}

/** Why this row cannot be saved yet, in words for the announcer, or null when it can. */
export function rowProblem(row: ScheduleDraft): string | null {
  if (!isCalendarDate(row.date)) return "Needs a date.";
  if (!row.opponent.trim()) return "Needs an opponent.";
  if (row.opponent.trim().length > MAX_OPPONENT_CHARS) return `The opponent is over ${MAX_OPPONENT_CHARS} characters.`;
  const team = typedScore(row.teamScore);
  const opponent = typedScore(row.opponentScore);
  if (Number.isNaN(team) || Number.isNaN(opponent)) return "A score is a whole number from 0 to 999.";
  if ((team === null) !== (opponent === null)) return "Type both scores, or neither for a game not played yet.";
  return null;
}

/** The first row that cannot be saved, numbered from 1 as the table shows it, or null. */
export function scheduleProblem(rows: readonly ScheduleDraft[]): string | null {
  if (rows.length > MAX_GAMES) return `A schedule has at most ${MAX_GAMES} games.`;
  for (const [index, row] of rows.entries()) {
    const problem = rowProblem(row);
    if (problem) return `Game ${index + 1}: ${problem}`;
  }
  return null;
}

/** Exactly what Save sends, oldest first. Only call it once scheduleProblem says nothing. */
export function toScheduleSaveBody(rows: readonly ScheduleDraft[]): { games: ScheduleSaveGame[] } {
  const games = rows.map((row) => ({
    game_date: row.date,
    opponent: row.opponent.trim(),
    site: row.site,
    team_score: typedScore(row.teamScore),
    opponent_score: typedScore(row.opponentScore),
    is_league: row.league,
  }));
  games.sort((a, b) => (a.game_date < b.game_date ? -1 : a.game_date > b.game_date ? 1 : 0));
  return { games };
}

/** Counts only, for the import's analytics: never an opponent or a date. */
export function scheduleImportProps(games: readonly ScheduleDraft[]): { games: number; unsure: number } {
  return { games: games.length, unsure: games.filter((game) => game.flags.length > 0).length };
}
