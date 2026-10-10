import { cleanStoryline } from "@/lib/cards/cardFace";
import { normalizeHex } from "@/lib/game/colors";
import type { Json } from "@/lib/json";
import { reviewHeardAs } from "./heardAs";
import { playerIdentity } from "./identity";
import { defaultSpotMode, type PlayerReview } from "./reviewPlayers";
import { spokenForms } from "./spokenForms";
import { withoutSuffix } from "./suffix";
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
  /** The team colour, "#rrggbb", or "" for none. Saved through save_roster with the players. */
  color: string;
}

export const EMPTY_TEAM: TeamDraft = { school: "", mascot: "", sport: "", gender: "", level: "", season: "", color: "" };

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
  /** "Heard as" forms when the row arrived, for the same count. Absent on rows built before Oct 4. */
  heardAsAtStart?: number;
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
    player: { ...player, spot_mode: defaultSpotMode(player.position, sport, formsOf(player)) },
    spotModeChosen: false,
    season: null,
    edited: false,
    pronunciationsAtStart: player.pronunciations.length,
    heardAsAtStart: (player.heard_as ?? []).length,
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
    heardAsAtStart: (player.heard_as ?? []).length,
  };
}

export type PlayerField = "jersey" | "first_name" | "last_name" | "position" | "grade" | "height" | "weight";

/** One field typed into. Blank is null, except the surname, which is always text. */
export function editField(row: EditorRow, field: PlayerField, value: string, sport: Sport | null): EditorRow {
  const player: RosterPlayer = {
    ...withoutUnreadable(row.player),
    [field]: field === "last_name" ? value : value.trim().length > 0 ? value : null,
  };
  // Typing a position or a surname into a row nobody has set a mode on moves
  // it with them: an OL typed in by hand starts off, same as an imported one,
  // and a surname that is an everyday word starts exact-only.
  if ((field === "position" || field === "last_name") && !row.spotModeChosen) {
    player.spot_mode = defaultSpotMode(player.position, sport, formsOf(player));
  }
  return { ...row, player, edited: true };
}

export function setSpotMode(row: EditorRow, mode: SpotMode): EditorRow {
  return { ...row, player: { ...row.player, spot_mode: mode }, spotModeChosen: true, edited: true };
}

export function setPronunciations(row: EditorRow, pronunciations: string[]): EditorRow {
  return { ...row, player: { ...row.player, pronunciations }, edited: true };
}

/**
 * The "heard as" box: words Deepgram wrote for this surname. Stored as typed;
 * the review (reviewHeardAs) says which of them will not be saved and why.
 */
export function setHeardAs(row: EditorRow, heardAs: string[]): EditorRow {
  return { ...row, player: { ...row.player, heard_as: heardAs }, edited: true };
}

/** The storyline under the player's name on the card (Oct 7), as typed; trimmed and capped when saved. */
export function setStoryline(row: EditorRow, storyline: string): EditorRow {
  return { ...row, player: { ...row.player, storyline }, edited: true };
}

/** Every form a player's surname is listened for: the spelling, the pronunciations and the heard-as forms. */
function formsOf(player: RosterPlayer): string[] {
  return spokenForms(player.last_name, player.pronunciations, player.heard_as ?? []);
}

export function setSplit(row: EditorRow, first: string, last: string): EditorRow {
  return { ...row, player: { ...withoutUnreadable(row.player), first_name: first || null, last_name: last }, edited: true };
}

/**
 * M10: Claude's "hard to read" flag stays on a row until the announcer
 * touches its details, which is them checking it against the original. It is
 * never saved, so it is for this import only.
 */
function withoutUnreadable(player: RosterPlayer): RosterPlayer {
  return player.flags.includes("unreadable") ? { ...player, flags: player.flags.filter((flag) => flag !== "unreadable") } : player;
}

/** The sport changed: rows still on their automatic setting follow it. */
export function applySport(rows: EditorRow[], sport: Sport | null): EditorRow[] {
  return rows.map((row) =>
    row.spotModeChosen
      ? row
      : {
          ...row,
          player: {
            ...row.player,
            spot_mode: defaultSpotMode(row.player.position, sport, formsOf(row.player)),
          },
        },
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
 * Said by both prompts that replace a roster with an import (M13), because
 * replaceWithImport starts every player's season stats over.
 */
export const REIMPORT_STATS_NOTE = "Season stats will need importing again.";

/**
 * Above the review after a photo or a scanned PDF was read (M10). Those are
 * read as page images, so no name can be checked against the file's text the
 * way a text import's are (not_in_source).
 */
export const PHOTO_READ_NOTE = "Read from a photo or scan: check every name against the original.";

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
      player: {
        ...row.player,
        pronunciations: before.player.pronunciations,
        ...(before.player.heard_as?.length ? { heard_as: before.player.heard_as } : {}),
        ...(before.player.storyline ? { storyline: before.player.storyline } : {}),
        spot_mode: before.player.spot_mode,
      },
      spotModeChosen: before.spotModeChosen,
      pronunciationsAtStart: before.pronunciationsAtStart,
      ...(before.heardAsAtStart !== undefined ? { heardAsAtStart: before.heardAsAtStart } : {}),
    };
  });
}

function identity(player: RosterPlayer): string {
  return playerIdentity(player);
}

/** Fills only the blanks: what the announcer already typed about the team wins. */
export function mergeTeam(draft: TeamDraft, found: Partial<Record<keyof TeamDraft, string | null>>): TeamDraft {
  const next = { ...draft };
  for (const field of Object.keys(EMPTY_TEAM) as Array<keyof TeamDraft>) {
    const raw = found[field];
    // A colour only counts as one when it is a colour.
    const value = field === "color" ? normalizeHex(raw) : raw;
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
    /** "#rrggbb", or null for no colour. Saved in the same transaction as the players (M12). */
    primary_color: string | null;
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
    /** The forms the review accepted (reviewHeardAs). Always sent, so an empty list clears them. */
    heard_as: string[];
    /**
     * Under the name on the card (Oct 7). save_roster does not know it, so it
     * is written after the save (writeStorylines in lib/rosters/heardAs.ts).
     */
    storyline: string;
  }>;
}

/**
 * Exactly what save_roster gets: the team, its colour, and every player with
 * their heard-as forms, in one call and so one transaction. The spoken forms
 * are built here, from the surname and the pronunciations, so what the live
 * screen listens for is what the review screen showed.
 *
 * `reviews` are the review screen's, one per row; the heard-as forms saved
 * are the ones it accepted. Without them each row is checked here the same
 * way.
 */
export function toSaveArgs(team: TeamDraft, rows: EditorRow[], rosterId: string | null, reviews?: PlayerReview[]): SaveArgs {
  const blank = (value: string) => (value.trim().length > 0 ? value.trim() : null);
  const accepted = (row: EditorRow, index: number): string[] =>
    reviews?.[index]?.heardAs ??
    reviewHeardAs(
      row.player,
      rows.filter((_, other) => other !== index).map((each) => each.player),
    ).accepted;
  const heardAs = new Map(rows.map((row, index) => [row.key, accepted(row, index)]));
  return {
    p_roster: {
      ...(rosterId ? { id: rosterId } : {}),
      school: team.school.trim(),
      mascot: blank(team.mascot),
      sport: team.sport,
      gender: blank(team.gender),
      level: blank(team.level),
      season: blank(team.season),
      primary_color: normalizeHex(team.color),
    },
    p_players: savableRows(rows).map(({ key, player, season }) => {
      // A typed suffix is not part of the surname either: "Bates III" saves as "Bates".
      const names = withoutSuffix(player.first_name?.trim() || null, player.last_name);
      return {
        jersey: player.jersey?.trim() || null,
        first_name: names.first_name,
        last_name: names.last_name,
        position: player.position?.trim() || null,
        grade: player.grade?.trim() || null,
        height: player.height?.trim() || null,
        weight: player.weight?.trim() || null,
        pronunciations: player.pronunciations,
        spoken_forms: spokenForms(names.last_name, player.pronunciations),
        spot_mode: player.spot_mode,
        season_stats: season?.season_stats ?? null,
        season_lines: season?.season_lines ?? [],
        stats_as_of: season?.stats_as_of ?? null,
        heard_as: heardAs.get(key) ?? [],
        storyline: cleanStoryline(player.storyline),
      };
    }),
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
  first_name_collision: "warn_first_name",
  no_spoken_forms: "warn_no_spoken_forms",
  letters_dropped: "warn_letters_dropped",
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
    heard_as_added: 0,
  };
  rows.forEach((row, index) => {
    if (row.player.last_name.trim().length === 0) return;
    props.players += 1;
    if (row.edited) props.rows_edited += 1;
    if (row.player.spot_mode === "exact_only") props.exact_only_set += 1;
    if (row.player.spot_mode === "off") props.spotting_off_set += 1;
    props.pronunciations_added += Math.max(0, row.player.pronunciations.length - row.pronunciationsAtStart);
    props.heard_as_added += Math.max(0, (reviews[index]?.heardAs.length ?? row.player.heard_as?.length ?? 0) - (row.heardAsAtStart ?? 0));
    for (const flag of reviews[index]?.flags ?? []) {
      const key = WARNING_KEYS[flag];
      if (key) props[key] = (props[key] ?? 0) + 1;
    }
  });
  if (firstImportAt !== null) props.minutes_from_first_import = Math.round((now - firstImportAt) / 6000) / 10;
  return props;
}
