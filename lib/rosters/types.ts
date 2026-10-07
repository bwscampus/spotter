// Shapes shared by the extraction route, the review screen, and the watchlist
// builder. These are the roster as the announcer is editing it, before it is
// saved; the saved shape lives in lib/supabase/database.types.ts.

/** Sports the team_key and the lineman rule understand. */
export const SPORTS = [
  "volleyball",
  "football",
  "basketball",
  "soccer",
  "baseball",
  "softball",
  "water_polo",
  "lacrosse",
  "other",
] as const;
export type Sport = (typeof SPORTS)[number];

export const GENDERS = ["boys", "girls", "coed"] as const;
export type Gender = (typeof GENDERS)[number];

export const LEVELS = ["varsity", "jv", "freshman"] as const;
export type Level = (typeof LEVELS)[number];

// Human labels for every screen. The stored values stay lowercase: team_key is
// built from them and the database's check constraints require it, so casing is
// a presentation concern only and lives here rather than in the column.

/** Human labels for the selects. Sport is required before saving. */
export const SPORT_LABELS: Record<Sport, string> = {
  volleyball: "Volleyball",
  football: "Football",
  basketball: "Basketball",
  soccer: "Soccer",
  baseball: "Baseball",
  softball: "Softball",
  water_polo: "Water polo",
  lacrosse: "Lacrosse",
  other: "Other",
};

export const GENDER_LABELS: Record<Gender, string> = {
  boys: "Boys",
  girls: "Girls",
  coed: "Coed",
};

/** JV is an initialism, so it is not simply capitalized. */
export const LEVEL_LABELS: Record<Level, string> = {
  varsity: "Varsity",
  jv: "JV",
  freshman: "Freshman",
};

/**
 * The label for a value read back from the database, which is typed as a plain
 * string. Anything unrecognized is capitalized rather than dropped, so a value
 * added to the enum before this map still reads sensibly.
 */
export function sportLabel(value: string | null | undefined): string | null {
  return label(value, isSport, SPORT_LABELS);
}

export function genderLabel(value: string | null | undefined): string | null {
  return label(value, isGender, GENDER_LABELS);
}

export function levelLabel(value: string | null | undefined): string | null {
  return label(value, isLevel, LEVEL_LABELS);
}

function label<T extends string>(
  value: string | null | undefined,
  is: (candidate: unknown) => candidate is T,
  labels: Record<T, string>,
): string | null {
  if (!value) return null;
  if (is(value)) return labels[value];
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface RosterTeam {
  school: string | null;
  mascot: string | null;
  sport: Sport | null;
  gender: Gender | null;
  level: Level | null;
  season: string | null;
}

/**
 * How a player takes part in name-spotting. docs/V3_DEFINITION.md section 6.3.
 *
 * - normal: a card goes up on the surname or a cued jersey.
 * - exact_only: near-sound matches are dropped, so only the surname said
 *   cleanly puts the card up. For names that sound like play-by-play.
 * - off: never puts a card up, but stays on the saved roster so a stat can
 *   still be credited. Football offensive linemen start here.
 */
export const SPOT_MODES = ["normal", "exact_only", "off"] as const;
export type SpotMode = (typeof SPOT_MODES)[number];

export const SPOT_MODE_LABELS: Record<SpotMode, string> = {
  normal: "Normal",
  exact_only: "Exact only",
  off: "Off",
};

export function isSpotMode(value: unknown): value is SpotMode {
  return typeof value === "string" && (SPOT_MODES as readonly string[]).includes(value);
}

/**
 * Flags come from two places: Claude sets the first three while reading the
 * PDF, and the checks in this folder add the rest. All of them are advice for
 * the announcer, never a reason to refuse a save.
 */
export type PlayerFlag =
  | "ambiguous_last_name"
  | "unreadable"
  | "missing_jersey"
  | "not_in_source"
  | "duplicate_jersey"
  | "common_word_fire"
  | "common_word_close"
  | "common_phrase_fire"
  | "common_phrase_close"
  | "look_alike"
  | "similar_jersey"
  | "single_digit";

/** Flags Claude is allowed to return. Anything else is dropped. */
export const CLAUDE_FLAGS: PlayerFlag[] = ["ambiguous_last_name", "unreadable", "missing_jersey"];

export interface RosterPlayer {
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  position: string | null;
  grade: string | null;
  height: string | null;
  weight: string | null;
  /**
   * How the announcer says the surname, when the spelling does not predict it.
   * Typed by hand on the review screen and folded into the forms the matcher
   * listens for. Kept apart from those forms so editing the surname cannot
   * regenerate them away.
   */
  pronunciations: string[];
  spot_mode: SpotMode;
  flags: PlayerFlag[];
}

/**
 * The four ways a roster arrives, split five ways for analytics because CSV
 * and Excel are read differently in the browser. docs/V3_DEFINITION.md 6.2.
 */
export const IMPORT_FORMATS = ["pdf", "image", "text", "csv", "xlsx"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export function isImportFormat(value: unknown): value is ImportFormat {
  return typeof value === "string" && (IMPORT_FORMATS as readonly string[]).includes(value);
}

/**
 * What Claude was given to read. text: words it could read directly (a PDF's
 * text layer, pasted text, spreadsheet rows). vision: page images, from a
 * scanned PDF or a photo.
 */
export type ReadRoute = "text" | "vision";

/** What POST /api/rosters/extract returns. No file bytes, no raw text. */
export interface ExtractResponse {
  team: RosterTeam;
  players: RosterPlayer[];
  warnings: string[];
  format: ImportFormat;
  route: ReadRoute;
}

export function isSport(value: unknown): value is Sport {
  return typeof value === "string" && (SPORTS as readonly string[]).includes(value);
}

export function isGender(value: unknown): value is Gender {
  return typeof value === "string" && (GENDERS as readonly string[]).includes(value);
}

export function isLevel(value: unknown): value is Level {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value);
}

/** A saved team as the roster list and game setup show it. */
export interface TeamSummary {
  id: string;
  school: string;
  mascot: string | null;
  sport: string;
  gender: string | null;
  level: string | null;
  season: string | null;
  updated_at: string;
  playerCount: number;
}

/** One line describing a team, for lists and game labels: "Campbell Hall Girls Varsity Volleyball 26-27". */
export function describeTeam(team: Pick<TeamSummary, "school" | "sport" | "gender" | "level" | "season">): string {
  return [team.school, genderLabel(team.gender), levelLabel(team.level), sportLabel(team.sport), team.season]
    .filter(Boolean)
    .join(" ");
}
