import { normalizeWord } from "@/lib/matching/matcher";
import type { Json } from "@/lib/json";
import { defaultSpotMode, type PlayerReview } from "./reviewPlayers";
import { spokenForms } from "./spokenForms";
import type { Gender, Level, PlayerFlag, RosterPlayer, Sport, SpotMode } from "./types";

// =============================================================================
// The roster editor's state and every change to it, as plain functions so the
// rules can be tested without a browser: what a new row starts as, what a
// re-import keeps, and exactly what save_roster is sent.
// =============================================================================

/** The team fields above the table. Empty strings while being typed. */
export interface TeamDraft {
  school: string;
  mascot: string;
  sport: Sport | "";
  gender: Gender | "";
  level: Level | "";
  season: string;
}

export const EMPTY_TEAM: TeamDraft = { school: "", mascot: "", sport: "", gender: "", level: "", season: "" };

/** Season numbers already saved on a player. Item 5 fills them; the editor only carries them through a save. */
export interface SavedSeason {
  season_stats: Json | null;
  season_lines: string[];
  stats_as_of: string | null;
}

/** One row of the table. `key` is a React key and never saved. */
export interface EditorRow {
  key: string;
  player: RosterPlayer;
  /**
   * False while spot_mode is whatever the position implies. Set once the
   * announcer picks a mode by hand, so a later position edit never overrides
   * their choice. A row loaded from a saved roster counts as chosen.
   */
  spotModeChosen: boolean;
  season: SavedSeason | null;
  /** Changed by hand since it arrived. For prep.roster_saved's rows_edited. */
  edited: boolean;
  /** Pronunciations when the row arrived, so a save can count the ones added. */
  pronunciationsAtStart: number;
}

let nextKey = 0;
export function newRowKey(): string {
  nextKey += 1;
  return `row-${nextKey}`;
}

export const BLANK_PLAYER: RosterPlayer = {
  jersey: null,
  first_name: null,
  last_name: "",
  position: null,
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
};

/** A row for a player that has not been saved before: typed in, or just imported. */
export function freshRow(player: RosterPlayer, sport: Sport | null): EditorRow {
  return {
    key: newRowKey(),
    player: { ...player, spot_mode: defaultSpotMode(player.position, sport) },
    spotModeChosen: false,
    season: null,
    edited: false,
    pronunciationsAtStart: player.pronunciations.length,
  };
}

/** A row loaded from a saved roster. Its spotting setting was chosen when it was saved. */
export function savedRow(player: RosterPlayer, season: SavedSeason | null): EditorRow {
  return {
    key: newRowKey(),
    player,
    spotModeChosen: true,
    season,
    edited: false,
    pronunciationsAtStart: player.pronunciations.length,
  };
}

export type PlayerField = "jersey" | "first_name" | "last_name" | "position" | "grade" | "height" | "weight";

/** One field typed into. Blank is null, except the surname, which is always text. */
export function editField(row: EditorRow, field: PlayerField, value: string, sport: Sport | null): EditorRow {
  const player: RosterPlayer = {
    ...row.player,
    [field]: field === "last_name" ? value : value.trim().length > 0 ? value : null,
  };
  // Typing a position into a row nobody has set a mode on moves it with the
  // position: an OL typed in by hand starts off, same as an imported one.
  if (field === "position" && !row.spotModeChosen) player.spot_mode = defaultSpotMode(player.position, sport);
  return { ...row, player, edited: true };
}

export function setSpotMode(row: EditorRow, mode: SpotMode): EditorRow {
  return { ...row, player: { ...row.player, spot_mode: mode }, spotModeChosen: true, edited: true };
}

export function setPronunciations(row: EditorRow, pronunciations: string[]): EditorRow {
  return { ...row, player: { ...row.player, pronunciations }, edited: true };
}

export function setSplit(row: EditorRow, first: string, last: string): EditorRow {
  return { ...row, player: { ...row.player, first_name: first || null, last_name: last }, edited: true };
}

/** The sport changed: rows still on their automatic setting follow it. */
export function applySport(rows: EditorRow[], sport: Sport | null): EditorRow[] {
  return rows.map((row) =>
    row.spotModeChosen
      ? row
      : { ...row, player: { ...row.player, spot_mode: defaultSpotMode(row.player.position, sport) } },
  );
}

/**
 * Puts a row in front of the first one wearing a higher number, so a roster in
 * number order stays that way. A missing or non-numeric jersey goes last.
 */
export function insertByJersey(rows: EditorRow[], row: EditorRow): EditorRow[] {
  const number = (jersey: string | null) => {
    const n = Number.parseInt((jersey ?? "").trim(), 10);
    return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
  };
  const mine = number(row.player.jersey);
  const at = rows.findIndex((other) => number(other.player.jersey) > mine);
  return at === -1 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)];
}

/**
 * A new import replaces the rows. A player who was already here, the same
 * surname and the same jersey, keeps the pronunciation notes and spotting
 * setting the announcer gave them. Season stats start over: a new roster is a
 * new week, and item 5's import brings fresh numbers.
 */
export function replaceWithImport(previous: EditorRow[], imported: RosterPlayer[], sport: Sport | null): EditorRow[] {
  const kept = new Map<string, EditorRow>();
  for (const row of previous) kept.set(identity(row.player), row);

  return imported.map((player) => {
    const row = freshRow(player, sport);
    const before = kept.get(identity(player));
    if (!before) return row;
    return {
      ...row,
      player: { ...row.player, pronunciations: before.player.pronunciations, spot_mode: before.player.spot_mode },
      spotModeChosen: before.spotModeChosen,
      pronunciationsAtStart: before.pronunciationsAtStart,
    };
  });
}

function identity(player: RosterPlayer): string {
  const jersey = (player.jersey ?? "").trim().replace(/^#/, "");
  return `${player.last_name.split(/\s+/).map(normalizeWord).join("")}|${jersey}`;
}

/** Fills only the blanks: what the announcer already typed about the team wins. */
export function mergeTeam(draft: TeamDraft, found: Partial<Record<keyof TeamDraft, string | null>>): TeamDraft {
  const next = { ...draft };
  for (const field of Object.keys(EMPTY_TEAM) as Array<keyof TeamDraft>) {
    const value = found[field];
    if (next[field] === "" && typeof value === "string" && value.trim().length > 0) {
      (next as Record<keyof TeamDraft, string>)[field] = value.trim();
    }
  }
  return next;
}

/** What the table would save. Rows with no surname are drafts, not players. */
export function savableRows(rows: EditorRow[]): EditorRow[] {
  return rows.filter((row) => row.player.last_name.trim().length > 0);
}

export interface SaveArgs {
  p_roster: {
    id?: string;
    school: string;
    mascot: string | null;
    sport: string;
    gender: string | null;
    level: string | null;
    season: string | null;
  };
  p_players: Array<{
    jersey: string | null;
    first_name: string | null;
    last_name: string;
    position: string | null;
    grade: string | null;
    height: string | null;
    weight: string | null;
    pronunciations: string[];
    spoken_forms: string[];
    spot_mode: SpotMode;
    season_stats: Json | null;
    season_lines: string[];
    stats_as_of: string | null;
  }>;
}

/**
 * Exactly what save_roster gets. The spoken forms are built here, from the
 * surname and the pronunciations, so what the live screen listens for is what
 * the review screen showed.
 */
export function toSaveArgs(team: TeamDraft, rows: EditorRow[], rosterId: string | null): SaveArgs {
  const blank = (value: string) => (value.trim().length > 0 ? value.trim() : null);
  return {
    p_roster: {
      ...(rosterId ? { id: rosterId } : {}),
      school: team.school.trim(),
      mascot: blank(team.mascot),
      sport: team.sport,
      gender: blank(team.gender),
      level: blank(team.level),
      season: blank(team.season),
    },
    p_players: savableRows(rows).map(({ player, season }) => ({
      jersey: player.jersey?.trim() || null,
      first_name: player.first_name?.trim() || null,
      last_name: player.last_name.trim(),
      position: player.position?.trim() || null,
      grade: player.grade?.trim() || null,
      height: player.height?.trim() || null,
      weight: player.weight?.trim() || null,
      pronunciations: player.pronunciations,
      spoken_forms: spokenForms(player.last_name, player.pronunciations),
      spot_mode: player.spot_mode,
      season_stats: season?.season_stats ?? null,
      season_lines: season?.season_lines ?? [],
      stats_as_of: season?.stats_as_of ?? null,
    })),
  };
}

/** Why Save is not ready yet, in words, or null when it is. */
export function saveBlocker(team: TeamDraft, rows: EditorRow[]): string | null {
  if (team.school.trim().length === 0) return "Add the school name.";
  if (team.sport === "") return "Pick a sport.";
  if (savableRows(rows).length === 0) return "Add at least one player.";
  return null;
}

/** Warning types as prep.roster_saved counts them. Codes only, never whose. */
const WARNING_KEYS: Partial<Record<PlayerFlag, string>> = {
  common_phrase_fire: "warn_common_phrase",
  common_phrase_close: "warn_common_phrase",
  common_word_fire: "warn_common_word",
  common_word_close: "warn_common_word",
  look_alike: "warn_look_alike",
  similar_jersey: "warn_similar_jersey",
  duplicate_jersey: "warn_duplicate_jersey",
  missing_jersey: "warn_missing_jersey",
  single_digit: "warn_single_digit",
  ambiguous_last_name: "warn_ambiguous_name",
  not_in_source: "warn_not_in_source",
  unreadable: "warn_unreadable",
};

/**
 * The counts prep.roster_saved carries. docs/V3_DEFINITION.md 10.2. Counts
 * only: no name, jersey or position can get in, because nothing here reads one
 * into the result.
 */
export function savedRosterProps(
  rows: EditorRow[],
  reviews: PlayerReview[],
  firstImportAt: number | null,
  now: number,
): Record<string, number> {
  const props: Record<string, number> = {
    players: 0,
    rows_edited: 0,
    exact_only_set: 0,
    spotting_off_set: 0,
    pronunciations_added: 0,
  };
  rows.forEach((row, index) => {
    if (row.player.last_name.trim().length === 0) return;
    props.players += 1;
    if (row.edited) props.rows_edited += 1;
    if (row.player.spot_mode === "exact_only") props.exact_only_set += 1;
    if (row.player.spot_mode === "off") props.spotting_off_set += 1;
    props.pronunciations_added += Math.max(0, row.player.pronunciations.length - row.pronunciationsAtStart);
    for (const flag of reviews[index]?.flags ?? []) {
      const key = WARNING_KEYS[flag];
      if (key) props[key] = (props[key] ?? 0) + 1;
    }
  });
  if (firstImportAt !== null) props.minutes_from_first_import = Math.round((now - firstImportAt) / 6000) / 10;
  return props;
}
