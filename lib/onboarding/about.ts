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

/** High school sports beyond the listed ones (Ice hockey has its own box since Nov 6), in rough order of how often they are announced. */
export const OTHER_SPORT_SUGGESTIONS = [
  "Wrestling",
  "Track and field",
  "Cross country",
  "Field hockey",
  "Roller hockey",
  "Sled hockey",
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
  "ice hockey": "Ice hockey",
  "inline hockey": "Roller hockey",
  "in-line hockey": "Roller hockey",
  inline: "Roller hockey",
  roller: "Roller hockey",
  "sledge hockey": "Sled hockey",
  "para hockey": "Sled hockey",
  "para ice hockey": "Sled hockey",
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
const QUALIFIER_WORDS = new Set([
  "boys", "boys'", "girls", "girls'", "mens", "men's", "womens", "women's", "coed", "co-ed", "varsity", "jv", "freshman", "frosh",
  "high", "middle", "school", "hs", "unified", "club", "travel", "youth", "junior", "juniors", "prep", "college",
]);

/**
 * What was typed, ready to compare: lowercase, brackets read as spaces, and
 * any qualifier words taken off either end ("Boys hockey", "hockey (girls)"),
 * the text itself when nothing would be left.
 */
function comparable(typed: string): string {
  const words = typed.normalize("NFC").toLowerCase().replace(/[()]/g, " ").trim().split(/\s+/);
  let from = 0;
  let to = words.length;
  while (to - from > 1 && QUALIFIER_WORDS.has(words[from])) from++;
  while (to - from > 1 && QUALIFIER_WORDS.has(words[to - 1])) to--;
  return words.slice(from, to).join(" ");
}

/** Letters and numbers only: "Ice-hockey" and "icehockey" are "icehockey". */
const compact = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Every listed and suggested sport's name, the listed ones first. */
const allNames = (labels: Record<Sport, string>): string[] => [...SPORTS.filter((sport) => sport !== "other").map((sport) => labels[sport]), ...OTHER_SPORT_SUGGESTIONS];

/** The name a typed sport is listed under (aliases, "Boys ...", "icehockey" and "hockey ice" included), or null. */
export function knownSportName(typed: string, labels: Record<Sport, string>): string | null {
  const text = comparable(typed);
  const words = text.split(" ").sort().join(" ");
  const names = allNames(labels);
  return (
    names.find((label) => compact(label) === compact(text)) ??
    SPORT_ALIASES[text] ??
    names.find((label) => label.toLowerCase().split(" ").sort().join(" ") === words) ??
    null
  );
}

/** Edits from one word to another (a swap of two letters is one): small words only. */
function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  }
  return rows[a.length][b.length];
}

/**
 * A typo of a name or one of its words ("hocky", "hokey", "wresling"): four
 * letters or more, one edit off (two from seven letters), against the word or
 * the start of it the length of what was typed.
 */
function closeTypo(query: string, label: string): boolean {
  const typed = compact(query);
  if (typed.length < 4) return false;
  const limit = typed.length >= 7 ? 2 : 1;
  const targets = [compact(label), ...label.toLowerCase().split(/[\s/-]+/).map(compact)];
  return targets.some((word) =>
    [word, word.slice(0, typed.length - 1), word.slice(0, typed.length), word.slice(0, typed.length + 1)]
      .filter((part) => part.length >= 3)
      .some((part) => editDistance(typed, part) <= limit),
  );
}

/** A suggestion: one of the listed nine (tick its box) or another sport's label. */
export type SportSuggestion = { kind: "listed"; sport: Sport; label: string } | { kind: "other"; label: string };

/** Letters, numbers, spaces and a few joiners; nothing else is a sport's name. */
const SPORT_TEXT = /^[\p{L}\p{N}][\p{L}\p{N} '&/.-]*$/u;

/** What was typed as a label to keep, or null when it cannot be one (blank, too long, odd characters). */
export function cleanOtherSport(typed: string): string | null {
  const text = typed.normalize("NFC").replace(/[()]/g, " ").trim().replace(/\s+/g, " ");
  if (text.length === 0 || text.length > MAX_OTHER_SPORT_CHARS || !SPORT_TEXT.test(text)) return null;
  // A known sport keeps its own spelling ("wrestling" is "Wrestling"), and a
  // nickname or "Girls ..." is the sport it names ("lax" is "Lacrosse").
  // Anything else keeps the announcer's words, starting with a capital ("pond hockey" is "Pond hockey"; "mma" is "MMA").
  return knownSportName(text, SPORT_LABELS) ?? (text !== text.toLowerCase() ? text : text.length <= 3 ? text.toUpperCase() : text[0].toUpperCase() + text.slice(1));
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
  if (typed.trim().length === 0) return [];
  const query = comparable(typed);
  if (query.length === 0) return [];
  const known = knownSportName(typed, labels);
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
    if (alias === 0 || label === known || name.startsWith(query) || (query.length >= 3 && compact(name).startsWith(compact(query)))) return 0;
    if (alias === 1) return 1;
    if (name.split(/[\s/-]+/).some((word) => word.startsWith(query))) return 1;
    if (name.includes(query)) return 2;
    if (closeTypo(query, label)) return 3;
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
