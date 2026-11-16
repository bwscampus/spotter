import type { StatLine } from "./lines";

// =============================================================================
// What a card shows, worked out when the game is built or the rosters are
// refreshed, never when a card goes up. docs/CARD_SPEC.md.
//
// writeCard (components/PlayerCard.tsx) only copies these strings into spans
// that are already there, so every rule about how a name looks lives here, as
// pure functions: Title case, and the respelling and its stressed syllable.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A note longer than this is a sentence about the name, not a respelling, and stays off the card. */
export const RESPELLING_MAX_CHARS = 24;

/** In the number slab when the roster gave no jersey. */
export const NO_JERSEY = "–";

/** A jersey this long drops to the smaller number size, so "123" fits the slab. */
export const LONG_JERSEY_CHARS = 3;

// =============================================================================

/** A respelling split once: "kwell-en-" "BAHK" "". */
export interface Respelling {
  before: string;
  stressed: string;
  after: string;
}

/**
 * Everything a card writes, as strings. A player has either `plain` (the big
 * line is the surname) or the respelling's three parts, never both.
 */
export interface CardFace {
  /** "24", or NO_JERSEY. */
  jersey: string;
  /** Three or more characters: the smaller number size. */
  longJersey: boolean;
  /** "RB" as saved, or empty. */
  position: string;
  /** The big line without a respelling: the surname, in Title case. Empty with one. */
  plain: string;
  before: string;
  stressed: string;
  after: string;
  /**
   * The small line. With a respelling, "Dario " and "Quellenbach" (the space
   * rides on the first name, so a missing one leaves no gap). Without one,
   * the first name alone.
   */
  smallFirst: string;
  smallLast: string;
  /** Football: the season line. */
  season: StatLine;
  /** Every other sport: every saved stat line, as written, one a line (a game built before Oct 8 has only the first). */
  seasonText: string;
  /**
   * The player's facts, as the announcer typed or imported them on the team
   * page (Nov 15: up to MAX_FACTS, every one on the card, never rotated).
   * Empty when there are none. Absent on a game built before them, whose
   * `storyline` is its one fact (factsOf).
   */
  facts?: string[];
  /** A game built before facts (Oct 7 to Nov 15): the one line under the name. Read through factsOf only. */
  storyline?: string;
  /**
   * The scoring view's row (Nov 15): the player's scoring numbers for the
   * sport, "11 G · 6 A · 28 PTS" (lib/cards/scoringKeywords.ts). Empty when
   * the player has none, and then the scoring view is the normal card.
   */
  scoring?: StatLine;
}

/** A face's facts, from a game built with facts or before them. */
export function factsOf(face: Pick<CardFace, "facts" | "storyline"> | undefined): readonly string[] {
  if (!face) return NO_FACTS;
  if (face.facts) return face.facts;
  return face.storyline ? [face.storyline] : NO_FACTS;
}

const NO_FACTS: readonly string[] = [];

export interface FaceSource {
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  position: string | null;
  pronunciations: string[];
  /** roster_players.facts. Absent or empty means none. */
  facts?: readonly string[] | null;
  /** A source from before facts: its storyline is the one fact. Ignored when `facts` is given. */
  storyline?: string | null;
}

export interface FaceOptions {
  season?: StatLine;
  seasonText?: string;
  scoring?: StatLine;
}

export function cardFace(player: FaceSource, options: FaceOptions = {}): CardFace {
  const last = titleCase(player.last_name);
  const first = titleCase(player.first_name ?? "");
  const note = player.pronunciations.map((text) => text.trim()).find((text) => text.length > 0);
  const respelling = note ? splitRespelling(note) : null;
  const jersey = player.jersey?.trim() || NO_JERSEY;

  return {
    jersey,
    longJersey: jersey !== NO_JERSEY && [...jersey].length >= LONG_JERSEY_CHARS,
    position: player.position?.trim() ?? "",
    plain: respelling ? "" : last,
    before: respelling?.before ?? "",
    stressed: respelling?.stressed ?? "",
    after: respelling?.after ?? "",
    // With a respelling the big line is how it sounds, so the small line says
    // who it is: "Dario Quellenbach". Without one the surname is already big.
    smallFirst: respelling ? (first ? `${first} ` : "") : first,
    smallLast: respelling ? last : "",
    season: options.season ?? [],
    seasonText: options.seasonText ?? "",
    facts: cleanFacts(player.facts ?? (player.storyline ? [player.storyline] : [])),
    scoring: options.scoring ?? [],
  };
}

/** Most facts a player has: what the team page lets you add, the column's check and the card's slots. */
export const MAX_FACTS = 5;

/** Longest fact kept, in characters: what the team page lets you type and the column allows. */
export const MAX_FACT_CHARS = 80;

/** The same limit under its Oct 7 name, for the "Other info" import, whose lines become facts. */
export const MAX_STORYLINE_CHARS = MAX_FACT_CHARS;

/** A fact as the card shows it: one line of text, spaces collapsed, at most MAX_FACT_CHARS. */
export function cleanStoryline(text: string | null | undefined): string {
  return [...(text ?? "").replace(/\s+/g, " ").trim()].slice(0, MAX_FACT_CHARS).join("");
}

/** Facts as saved and shown: each cleaned, empty ones dropped, at most MAX_FACTS, in the order typed. */
export function cleanFacts(facts: readonly (string | null | undefined)[] | null | undefined): string[] {
  return (facts ?? [])
    .map((fact) => cleanStoryline(fact))
    .filter((fact) => fact.length > 0)
    .slice(0, MAX_FACTS);
}

/**
 * A respelling, or null when the note is not one: more than
 * RESPELLING_MAX_CHARS, or anything but letters, hyphens, spaces and
 * apostrophes. The stressed syllable is the first run of two or more capitals;
 * the rest is lowercased. No such run: the whole note is `before`.
 */
export function splitRespelling(note: string): Respelling | null {
  const text = note.trim();
  if (text.length === 0 || [...text].length > RESPELLING_MAX_CHARS) return null;
  if (!/^[\p{L}'’ -]+$/u.test(text)) return null;
  const stress = /\p{Lu}{2,}/u.exec(text);
  if (!stress) return { before: text.toLowerCase(), stressed: "", after: "" };
  return {
    before: text.slice(0, stress.index).toLowerCase(),
    stressed: stress[0],
    after: text.slice(stress.index + stress[0].length).toLowerCase(),
  };
}

/**
 * A name in Title case when it was saved in ALL CAPS ("O'BRIEN" is "O'Brien",
 * "VAN DER BERG" is "Van Der Berg"). Any name with a lowercase letter is left
 * exactly as saved, and nothing is ever forced into capitals.
 */
export function titleCase(name: string): string {
  const text = name.trim();
  if (!/\p{Lu}/u.test(text) || /\p{Ll}/u.test(text)) return text;
  return text.toLowerCase().replace(/(^|[\s'’-])(\p{Ll})/gu, (_, gap: string, letter: string) => `${gap}${letter.toUpperCase()}`);
}
