import { SPORT_LABELS, SPORTS, type Sport } from "@/lib/rosters/types";

// =============================================================================
// "About you" (Nov 3, Jed): asked once, right after the first sign-in, and
// editable in Settings. Two multi-select questions. Pure, shared by the page,
// the route that saves it and the tests; the database checks the same lists
// (db/migrations/0023_about_you.sql).
// =============================================================================

/** The kinds of announcing, in the order the question lists them. */
export const ANNOUNCER_ROLES = ["public_address", "tv_pbp", "tv_color", "radio_pbp", "radio_color"] as const;
export type AnnouncerRole = (typeof ANNOUNCER_ROLES)[number];

export const ROLE_LABELS: Record<AnnouncerRole, string> = {
  public_address: "Public address",
  tv_pbp: "TV / streaming play-by-play",
  tv_color: "TV / streaming color",
  radio_pbp: "Radio play-by-play",
  radio_color: "Radio color",
};

export function isAnnouncerRole(value: unknown): value is AnnouncerRole {
  return typeof value === "string" && (ANNOUNCER_ROLES as readonly string[]).includes(value);
}

/** What an account said about itself. Empty lists when it skipped or has not answered. */
export interface About {
  sports: Sport[];
  /** Sports typed under "Other" (Nov 4); users.sports has "other" whenever this has any. */
  otherSports: string[];
  roles: AnnouncerRole[];
  /** Answered or skipped "About you". */
  onboarded: boolean;
}

/** A list of known values, each once, in the list's own order, whatever was sent. */
export function cleanList<T extends string>(values: readonly unknown[], known: readonly T[]): T[] {
  return known.filter((value) => values.includes(value));
}

export const cleanSports = (values: readonly unknown[]): Sport[] => cleanList(values, SPORTS);
export const cleanRoles = (values: readonly unknown[]): AnnouncerRole[] => cleanList(values, ANNOUNCER_ROLES);

/**
 * Where "About you" goes next: an account with fewer than two saved teams is
 * walked through setting up its next game; everyone else goes Home.
 */
export const WALKTHROUGH_PATH = "/onboarding/game";
export function afterAbout(teamCount: number): string {
  return teamCount < 2 ? WALKTHROUGH_PATH : "/home";
}

// =============================================================================
// "Other" sports, typed (Nov 4, Jed: "Make other autofill suggestion based on
// what they are typing"). One box under the nine listed sports suggests as the
// announcer types; picking a listed sport ticks its box, anything else is kept
// as a label (users.other_sports, db/migrations/0026_other_sports.sql).
// =============================================================================

/** At most this many typed sports, each at most this many characters (the column's check). */
export const MAX_OTHER_SPORTS = 10;
export const MAX_OTHER_SPORT_CHARS = 40;
/** Suggestions shown at once. */
export const MAX_SUGGESTIONS = 6;

/** High school sports beyond the listed nine, in rough order of how often they are announced. */
export const OTHER_SPORT_SUGGESTIONS = [
  "Wrestling",
  "Track and field",
  "Cross country",
  "Ice hockey",
  "Field hockey",
  "Tennis",
  "Golf",
  "Swimming and diving",
  "Gymnastics",
  "Cheer",
  "Dance",
  "Bowling",
  "Rugby",
  "Flag football",
  "Beach volleyball",
  "Ultimate",
  "Badminton",
  "Rowing",
  "Skiing",
  "Esports",
  "Fencing",
  "Table tennis",
  "Archery",
  "Equestrian",
  "Sailing",
  "Bass fishing",
] as const;

/**
 * What announcers call a sport, each pointing at the name it is listed under
 * (a listed sport's label or one of OTHER_SPORT_SUGGESTIONS), so "lax" ticks
 * Lacrosse instead of being kept as a sport of its own (Nov 6). Lowercase.
 */
export const SPORT_ALIASES: Readonly<Record<string, string>> = {
  lax: "Lacrosse",
  hoops: "Basketball",
  futbol: "Soccer",
  "fútbol": "Soccer",
  "sand volleyball": "Beach volleyball",
  hockey: "Ice hockey",
  xc: "Cross country",
  "cross-country": "Cross country",
  "t&f": "Track and field",
  "track & field": "Track and field",
  "indoor track": "Track and field",
  "outdoor track": "Track and field",
  swim: "Swimming and diving",
  "swim and dive": "Swimming and diving",
  "swim & dive": "Swimming and diving",
  dive: "Swimming and diving",
  diving: "Swimming and diving",
  wrestle: "Wrestling",
  cheerleading: "Cheer",
  "spirit squad": "Cheer",
  "dance team": "Dance",
  pom: "Dance",
  "drill team": "Dance",
  crew: "Rowing",
  "e-sports": "Esports",
  "e sports": "Esports",
  gaming: "Esports",
  frisbee: "Ultimate",
  "ultimate frisbee": "Ultimate",
  "ping pong": "Table tennis",
  "ping-pong": "Table tennis",
  "7v7": "Flag football",
  "7 on 7": "Flag football",
  snowboarding: "Skiing",
  "ski and snowboard": "Skiing",
  fishing: "Bass fishing",
};

/** Words in front of a sport that say who plays it, not what it is: "Boys basketball" is basketball. */
const QUALIFIER_WORDS = new Set(["boys", "boys'", "girls", "girls'", "mens", "men's", "womens", "women's", "coed", "co-ed", "varsity", "jv", "freshman", "frosh", "high", "school", "hs", "unified"]);

/** The text with any leading qualifier words taken off, lowercase; the text itself if nothing would be left. */
function withoutQualifiers(lower: string): string {
  const words = lower.split(" ");
  let at = 0;
  while (at < words.length - 1 && QUALIFIER_WORDS.has(words[at])) at++;
  return words.slice(at).join(" ");
}

/** The name a typed sport is listed under (a label or a suggestion, aliases and "Boys ..." included), or null. */
export function knownSportName(typed: string, labels: Record<Sport, string>): string | null {
  const text = withoutQualifiers(typed.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase());
  const named = [...SPORTS.filter((sport) => sport !== "other").map((sport) => labels[sport]), ...OTHER_SPORT_SUGGESTIONS];
  return named.find((label) => label.toLowerCase() === text) ?? SPORT_ALIASES[text] ?? null;
}

/** A suggestion: one of the listed nine (tick its box) or another sport's label. */
export type SportSuggestion = { kind: "listed"; sport: Sport; label: string } | { kind: "other"; label: string };

/** Letters, numbers, spaces and a few joiners; nothing else is a sport's name. */
const SPORT_TEXT = /^[\p{L}\p{N}][\p{L}\p{N} '&/.-]*$/u;

/** What was typed as a label to keep, or null when it cannot be one (blank, too long, odd characters). */
export function cleanOtherSport(typed: string): string | null {
  const text = typed.normalize("NFC").trim().replace(/\s+/g, " ");
  if (text.length === 0 || text.length > MAX_OTHER_SPORT_CHARS || !SPORT_TEXT.test(text)) return null;
  // A known sport keeps its own spelling ("wrestling" is "Wrestling"), and a
  // nickname or "Girls ..." is the sport it names ("lax" is "Lacrosse").
  return knownSportName(text, SPORT_LABELS) ?? text;
}

/** The listed sport a typed word names ("volleyball", "Water Polo"), or null. "Other" itself is never one. */
export function listedSportNamed(typed: string, labels: Record<Sport, string>): Sport | null {
  const text = typed.trim().toLowerCase();
  return SPORTS.find((sport) => sport !== "other" && (labels[sport].toLowerCase() === text || sport === text.replace(/ /g, "_"))) ?? null;
}

/**
 * The suggestions for what has been typed so far: a name that starts with it
 * first, then one with a word that starts with it, then one that contains it,
 * each group in the lists' own order, the listed nine before the rest, never
 * one already picked, at most MAX_SUGGESTIONS. Nothing until a letter is typed.
 */
export function suggestSports(
  typed: string,
  picked: { sports: readonly Sport[]; others: readonly string[] },
  labels: Record<Sport, string>,
): SportSuggestion[] {
  const query = withoutQualifiers(typed.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " "));
  if (query.length === 0) return [];
  // The names this query reaches through a nickname: "lax" is Lacrosse, "xc" Cross country.
  const aliased = new Map<string, number>();
  for (const [alias, label] of Object.entries(SPORT_ALIASES)) {
    const at = alias === query ? 0 : query.length >= 3 && alias.startsWith(query) ? 1 : null;
    if (at !== null && at < (aliased.get(label) ?? 9)) aliased.set(label, at);
  }
  const taken = new Set(picked.others.map((label) => label.toLowerCase()));
  const all: SportSuggestion[] = [
    ...SPORTS.filter((sport) => sport !== "other" && !picked.sports.includes(sport)).map((sport) => ({ kind: "listed" as const, sport, label: labels[sport] })),
    ...OTHER_SPORT_SUGGESTIONS.filter((label) => !taken.has(label.toLowerCase())).map((label) => ({ kind: "other" as const, label })),
  ];
  const rank = (label: string): number | null => {
    const name = label.toLowerCase();
    const alias = aliased.get(label);
    if (alias === 0 || name.startsWith(query)) return 0;
    if (alias === 1) return 1;
    if (name.split(/[\s/-]+/).some((word) => word.startsWith(query))) return 1;
    if (name.includes(query)) return 2;
    return null;
  };
  return all
    .map((suggestion, order) => ({ suggestion, order, rank: rank(suggestion.label) }))
    .filter((each): each is { suggestion: SportSuggestion; order: number; rank: number } => each.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, MAX_SUGGESTIONS)
    .map((each) => each.suggestion);
}

/** Typed sports kept once each (case aside), cleaned, at most MAX_OTHER_SPORTS. */
export function cleanOtherSports(values: readonly unknown[]): string[] {
  const kept: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const label = cleanOtherSport(value);
    if (label && !kept.some((each) => each.toLowerCase() === label.toLowerCase())) kept.push(label);
    if (kept.length >= MAX_OTHER_SPORTS) break;
  }
  return kept;
}

/**
 * What saves (the route and the page run the same): the listed sports ticked,
 * plus any listed sport typed under Other; the typed rest cleaned and kept
 * once each; and "other" among the sports exactly when anything else was
 * typed, so the new-team Sport list puts Other among the announcer's own.
 */
export function normalizeAbout(
  sports: readonly unknown[],
  otherSports: readonly unknown[],
  roles: readonly unknown[],
  labels: Record<Sport, string>,
): Pick<About, "sports" | "otherSports" | "roles"> {
  const typed = cleanOtherSports(otherSports);
  const named = typed.map((label) => listedSportNamed(label, labels));
  const others = typed.filter((_, at) => named[at] === null);
  const listed = cleanSports([...sports, ...named]).filter((sport) => sport !== "other");
  return {
    sports: others.length > 0 ? [...listed, "other"] : listed,
    otherSports: others,
    roles: cleanRoles(roles),
  };
}
