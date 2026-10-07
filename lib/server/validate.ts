import { MAX_STAT_LINE_LENGTH, MAX_STAT_LINES } from "@/lib/cards/limits";
import { FOOTBALL_STAT_KEYS } from "@/lib/cards/statKeys";

// Hand-written validators for what the browser sends (Production Standard API-2),
// in the style of papaspuzzles src/lib/validate.ts. They check shape and size;
// the database's own checks (save_roster, clean_season_stats, constraints) stay
// the last word on meaning.

export const MAX_PLAYERS = 300;
const MAX_FIELD = 120;
const MAX_FORMS = 20;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Obj = Record<string, unknown>;
const isObj = (value: unknown): value is Obj => typeof value === "object" && value !== null && !Array.isArray(value);
const shortText = (value: unknown, max = MAX_FIELD) => value === null || value === undefined || (typeof value === "string" && value.length <= max);
const textList = (value: unknown, maxItems: number, maxLength: number) =>
  value === undefined ||
  (Array.isArray(value) && value.length <= maxItems && value.every((item) => typeof item === "string" && item.length <= maxLength));
const statsObject = (value: unknown) =>
  value === null ||
  value === undefined ||
  (isObj(value) &&
    Object.keys(value).length <= FOOTBALL_STAT_KEYS.length * 2 &&
    Object.values(value).every((n) => typeof n === "number" && Number.isFinite(n)));
const dateOrNull = (value: unknown) => value === null || value === undefined || (typeof value === "string" && DATE.test(value));

/** PUT /api/rosters: { p_roster, p_players } as lib/rosters/editor.ts toSaveArgs builds it. */
export function isSaveRosterBody(body: unknown): body is { p_roster: Obj; p_players: Obj[] } {
  if (!isObj(body) || !isObj(body.p_roster) || !Array.isArray(body.p_players)) return false;
  const team = body.p_roster;
  if (team.id !== undefined && (typeof team.id !== "string" || !/^[0-9a-f-]{36}$/i.test(team.id))) return false;
  if (!["school", "mascot", "sport", "gender", "level", "season"].every((key) => shortText(team[key]))) return false;
  if (body.p_players.length > MAX_PLAYERS) return false;
  return body.p_players.every(
    (player) =>
      isObj(player) &&
      typeof player.last_name === "string" &&
      ["jersey", "first_name", "last_name", "position", "grade", "height", "weight", "spot_mode"].every((key) => shortText(player[key])) &&
      textList(player.pronunciations, MAX_FORMS, MAX_FIELD) &&
      textList(player.spoken_forms, MAX_FORMS * 4, MAX_FIELD) &&
      statsObject(player.season_stats) &&
      textList(player.season_lines, MAX_STAT_LINES, MAX_STAT_LINE_LENGTH) &&
      dateOrNull(player.stats_as_of),
  );
}

/** PUT /api/rosters/[id]/stats: { as_of, players: [{ id, stats, lines }] } as toSetSeasonStatsArgs builds it. */
export function isSeasonStatsBody(body: unknown): body is Obj {
  if (!isObj(body) || !dateOrNull(body.as_of) || !Array.isArray(body.players) || body.players.length > MAX_PLAYERS) return false;
  return body.players.every(
    (entry) =>
      isObj(entry) &&
      typeof entry.id === "string" &&
      /^[0-9a-f-]{36}$/i.test(entry.id) &&
      statsObject(entry.stats) &&
      textList(entry.lines, MAX_STAT_LINES, MAX_STAT_LINE_LENGTH),
  );
}

/** POST /api/games: lib/game/calledGames.ts startedRow. */
export function isStartedGameBody(body: unknown): body is {
  id: string;
  home_roster_id: string;
  away_roster_id: string;
  home_school: string;
  away_school: string;
  sport: string | null;
  stats_enabled: boolean;
} {
  if (!isObj(body)) return false;
  const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
  return (
    uuid(body.id) &&
    uuid(body.home_roster_id) &&
    uuid(body.away_roster_id) &&
    typeof body.home_school === "string" &&
    body.home_school.length <= MAX_FIELD &&
    typeof body.away_school === "string" &&
    body.away_school.length <= MAX_FIELD &&
    shortText(body.sport, 40) &&
    typeof body.stats_enabled === "boolean"
  );
}

/** PATCH /api/games/[id]: lib/game/liveCounts.ts endedRow. */
export function isEndedGameBody(body: unknown): body is {
  ended_at: string;
  mic_seconds: number;
  reconnects: number;
  cards_shown: number;
  cards_removed: number;
  stat_plays_added: number;
  stat_plays_undone: number;
} {
  if (!isObj(body) || typeof body.ended_at !== "string" || Number.isNaN(Date.parse(body.ended_at))) return false;
  const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10_000_000;
  return ["mic_seconds", "reconnects", "cards_shown", "cards_removed", "stat_plays_added", "stat_plays_undone"].every((key) => count(body[key]));
}
