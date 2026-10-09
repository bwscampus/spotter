import { normalizeWord } from "@/lib/matching/matcher";
import { isAmbiguousLastName } from "./ambiguity";
import { commonPhraseHits } from "./commonPhraseHits";
import { commonWordHits, type CommonWordReport } from "./commonWordHits";
import { flagDuplicateJerseys } from "./duplicateJerseys";
import { firesOn } from "./firesOn";
import { firstNameCollisions, type FirstNameCollision } from "./firstNames";
import { reviewHeardAs, type HeardAsReview } from "./heardAs";
import { isOffensiveLineman } from "./isOffensiveLineman";
import { findLookAlikes } from "./lookAlikes";
import { flagSimilarJerseys, type SimilarJersey } from "./similarJerseys";
import { spokenForms } from "./spokenForms";
import { stripSuffix } from "./suffix";
import type { PlayerFlag, RosterPlayer, Sport, SpotMode } from "./types";

// Everything the review screen needs to know about one row. Recomputed as the
// announcer types, so each piece is cheap or cached.
export interface PlayerReview {
  forms: string[];
  flags: PlayerFlag[];
  /** One plain sentence per flag, in the same order. */
  reasons: string[];
  commonWords: CommonWordReport;
  commonPhrases: CommonWordReport;
  /** Teammates this surname can be heard as, printed. */
  lookAlikes: string[];
  /** Football only, and only the offensive line: starts with spotting off. */
  offensiveLineman: boolean;
  /**
   * The everyday word or phrase that would put this card up, when one would:
   * why an imported row starts exact-only (defaultSpotMode). Null when none.
   */
  exactOnlyBecause: string | null;
  /** The "heard as" forms this row will save: the typed ones that passed checkHeardAs. */
  heardAs: string[];
  /** The typed forms that will not be saved, each with why, for the review screen. */
  heardAsRejected: Array<{ form: string; reason: string }>;
}

export { firesOn } from "./firesOn";

/**
 * Flags that come with the two one-click fixes, "Exact matches only" and "Add
 * pronunciation". docs/V3_DEFINITION.md section 6.3.
 */
export const FIXABLE_FLAGS: PlayerFlag[] = ["common_phrase_fire", "common_phrase_close", "look_alike"];

/** Reviews a whole roster. Duplicates, similar jerseys and look-alikes need the full list, so this is the entry point. */
export function reviewRoster(players: RosterPlayer[], sport: Sport | null): PlayerReview[] {
  const duplicates = flagDuplicateJerseys(players);
  const similar = flagSimilarJerseys(players);
  const lookAlikes = findLookAlikes(players);
  const firstNames = firstNameCollisions(players);
  return players.map((player, index) =>
    reviewPlayer(
      player,
      sport,
      duplicates[index],
      similar[index],
      lookAlikes[index],
      firstNames.filter((hit) => hit.index === index),
      reviewHeardAs(player, players.filter((_, other) => other !== index)),
    ),
  );
}

export function reviewPlayer(
  player: RosterPlayer,
  sport: Sport | null,
  duplicateJersey: boolean,
  similarJersey: SimilarJersey | null = null,
  lookAlikes: string[] = [],
  firstNames: FirstNameCollision[] = [],
  heardAs: HeardAsReview = reviewHeardAs(player, []),
): PlayerReview {
  const forms = spokenForms(player.last_name, player.pronunciations, heardAs.accepted);
  const commonWords = commonWordHits(forms);
  const commonPhrases = commonPhraseHits(forms);

  const flags: PlayerFlag[] = [...player.flags];
  const add = (flag: PlayerFlag) => {
    if (!flags.includes(flag)) flags.push(flag);
  };

  // Claude flags what it could not read; these are what the code can prove.
  if (isAmbiguousLastName(player.first_name, player.last_name)) add("ambiguous_last_name");
  if (duplicateJersey) add("duplicate_jersey");
  if ((player.jersey ?? "").trim().length === 0) add("missing_jersey");
  if (isSingleDigit(player.jersey)) add("single_digit");
  // Sounding like something else only matters for a player who can put a card
  // up. An offensive lineman set to off never does, so he is spared the noise.
  const spots = player.spot_mode !== "off";
  if (spots && commonPhrases.verdict === "would_fire") add("common_phrase_fire");
  if (spots && commonPhrases.verdict === "close") add("common_phrase_close");
  // "oregon" is both a common word and a phrase heard during play. Say it once,
  // as the phrase, which is the warning with the fixes beside it.
  const phraseWords = new Set(commonPhrases.hits.map((hit) => hit.word));
  const newWords = commonWords.hits.some((hit) => !phraseWords.has(hit.word));
  if (spots && newWords && commonWords.verdict === "would_fire") add("common_word_fire");
  if (spots && newWords && commonWords.verdict === "close") add("common_word_close");
  if (lookAlikes.length > 0) add("look_alike");
  if (similarJersey) add("similar_jersey");
  if (firstNames.length > 0) add("first_name_collision");
  // M11: the matcher hears a to z only. A surname with none of them gives
  // nothing to listen for, so the player never gets a card; one that loses
  // some (Strøm is heard as "strm") listens for the wrong word. A
  // pronunciation or a heard-as form is the fix, and clears both.
  const dropped = droppedLetters(player.last_name);
  const told = player.pronunciations.length > 0 || heardAs.accepted.length > 0;
  if (player.last_name.trim().length > 0 && forms.length === 0) add("no_spoken_forms");
  else if (dropped.length > 0 && !told) add("letters_dropped");

  return {
    forms,
    flags,
    reasons: flags.map((flag) =>
      reasonFor(flag, { commonWords, commonPhrases, similarJersey, lookAlikes, firstNames, dropped, forms }),
    ),
    commonWords,
    commonPhrases,
    lookAlikes,
    offensiveLineman: isOffensiveLineman(player.position, sport),
    exactOnlyBecause: firesOn(forms),
    heardAs: heardAs.accepted,
    heardAsRejected: heardAs.rejected,
  };
}

/**
 * What a new or imported row starts as. Offensive linemen start off. A
 * surname that an everyday word or a phrase heard during play would put up
 * starts exact-only (Oct 4: "for the" put up Worthy 44 times), and the review
 * says so, so the announcer can change it back.
 */
export function defaultSpotMode(position: string | null, sport: Sport | null, forms: readonly string[] = []): SpotMode {
  if (isOffensiveLineman(position, sport)) return "off";
  if (forms.length > 0 && firesOn([...forms])) return "exact_only";
  return "normal";
}

/**
 * The letters of a surname the matcher cannot hear, each once, in order: "ø"
 * for Strøm, every letter of a name in another script. Accented Latin letters
 * fold to their base letter (García is "garcia") and are not dropped.
 * Punctuation and digits are not letters, so O'Brien and a suffix are fine.
 */
export function droppedLetters(lastName: string): string[] {
  const dropped: string[] = [];
  for (const char of stripSuffix(lastName)) {
    if (!/\p{L}/u.test(char)) continue;
    const lower = char.toLowerCase();
    if (normalizeWord(char).length === 0 && !dropped.includes(lower)) dropped.push(lower);
  }
  return dropped;
}

/** 0 to 9, which only fire with "number" or the surname beside them (spec 7.3). "00" is two digits. */
export function isSingleDigit(jersey: string | null): boolean {
  return /^\d$/.test((jersey ?? "").trim().replace(/^#/, ""));
}

interface ReasonContext {
  commonWords: CommonWordReport;
  commonPhrases?: CommonWordReport;
  similarJersey?: SimilarJersey | null;
  lookAlikes?: string[];
  firstNames?: FirstNameCollision[];
  /** Letters of the surname the matcher cannot hear (droppedLetters). */
  dropped?: string[];
  /** What the surname is listened for. */
  forms?: string[];
}

/** Plain English, telling the announcer what to do about it. */
export function reasonFor(flag: PlayerFlag, context: ReasonContext): string {
  const { commonWords, commonPhrases, similarJersey, lookAlikes = [], firstNames = [], dropped = [], forms = [] } = context;
  switch (flag) {
    case "no_spoken_forms":
      return "StatCast can't listen for this spelling. Add a pronunciation.";
    case "letters_dropped": {
      const letters = joinAnd(dropped.map((letter) => `"${letter}"`)) || "some letters";
      const heard = forms[0] ? ` and listens for "${forms[0]}"` : "";
      return `StatCast can't hear ${letters} in this spelling${heard}. Add a pronunciation.`;
    }
    case "first_name_collision": {
      const hit = firstNames[0];
      if (!hit) return "The first name sounds like another player's surname: saying it can put that card up.";
      const who = hit.jersey ? `${hit.surname} #${hit.jersey}` : hit.surname;
      return `The first name "${hit.first}" ${hit.verdict === "would_fire" ? "is heard as" : "sounds close to"} ${who}'s surname: saying it can put that card up.`;
    }
    case "ambiguous_last_name":
      return "The surname could be one word or two. Pick the right split below.";
    case "unreadable":
      return "This name was hard to read. Check it against the roster.";
    case "missing_jersey":
      return "No jersey number. The screen shows #? if another player shares this surname.";
    case "not_in_source":
      return "This name does not appear in what was imported. Check the spelling.";
    case "duplicate_jersey":
      return "Another player wears this number. That is fine, the screen shows both.";
    case "single_digit":
      return 'Single-digit number: it only puts a card up when you say "number" or the surname with it.';
    case "common_phrase_fire":
      return `Sounds like ${listQuoted(commonPhrases)} in play-by-play. Expect wrong cards.`;
    case "common_phrase_close":
      return `Sounds close to ${listQuoted(commonPhrases)} in play-by-play. Watch for wrong cards.`;
    case "common_word_fire":
      return `Sounds like the common word ${listWords(commonWords)}. Expect false matches.`;
    case "common_word_close":
      return `Sounds close to the common word ${listWords(commonWords)}. Watch for false matches.`;
    case "look_alike":
      return `Can be heard as ${joinAnd(lookAlikes)}, also on this roster.`;
    case "similar_jersey":
      return similarJersey
        ? `#${similarJersey.jersey} can be misheard as #${similarJersey.partner}, which is also on this roster. StatCast shows both cards.`
        : "This number can be misheard as another on this roster. StatCast shows both cards.";
  }
}

function listWords(report: CommonWordReport): string {
  const words = report.hits.slice(0, 3).map((hit) => hit.word);
  if (words.length === 0) return "it matches";
  return joinAnd(words);
}

function listQuoted(report: CommonWordReport | undefined): string {
  const phrases = (report?.hits ?? []).slice(0, 3).map((hit) => `"${hit.word}"`);
  if (phrases.length === 0) return "something said during play";
  return joinAnd(phrases);
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
