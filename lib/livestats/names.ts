import { doubleMetaphone } from "double-metaphone";
import { stripSuffix } from "@/lib/rosters/suffix";

// =============================================================================
// Whether a credited player is named in the words a play was read from, for
// the stat check (./check.ts). Case, hyphens, apostrophes, spaces and
// suffixes (Jr., Sr., II, III, IV) are ignored, because the transcript writes
// a hyphenated surname as two words, as one half, or run together (Oct 6:
// three real tackles were dropped because "Taylor-Britt" came through as
// "taylor britt" and "Davis-Gaither" as "davis").
//
// Oct 10, after the Oct 9 high school game: the reader named the right player
// and the check dropped the credit because the transcript spelled the surname
// a letter or two differently, the way the card matcher already allowed that
// night. Stats code may not import the matcher, so a close spelling has its
// own small tolerance here (namedIn): one letter in a surname of 4 to 6
// letters, two in 7 or more, none in 3 or fewer, and only when no other
// player on either roster is as close to that word.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/**
 * How many letters a word may be off a surname and still name the player,
 * by the surname's length (letters only, suffix off, before doubled letters
 * are collapsed). One slip in a short name, two in a long one, and none in a
 * name so short that one slip makes it another word.
 */
export function closeLimit(surnameLetters: number): number {
  if (surnameLetters <= 3) return 0;
  if (surnameLetters <= 6) return 1;
  return 2;
}

/**
 * A sound-alike (fix 6, Part 4b): the transcript writes a surname as another
 * word that sounds like it, which no spelling tolerance reaches. Two words
 * sound alike when their double-metaphone codes (primary or alternate, the
 * npm package, never lib/matching) are within one edit of each other. A code
 * shorter than this is too little sound to mean anyone ("Lee" is "L").
 */
export const MIN_METAPHONE_CODE = 3;

/**
 * How many edits apart two metaphone codes may be and still sound alike: one,
 * but none when the surname's code is only MIN_METAPHONE_CODE long, because a
 * three-letter code one edit off matches too many ordinary words.
 */
export const SOUND_ALIKE_EDITS = 1;
export function soundAlikeEdits(surnameCode: string): number {
  return surnameCode.length > MIN_METAPHONE_CODE ? SOUND_ALIKE_EDITS : 0;
}

/**
 * Two codes sound alike only when they begin with the same sound: a garbled
 * name keeps its first consonant far more often than its last, and a different
 * onset one edit away ("b" for "h") is another word, not the same one misheard.
 */
export const SOUND_ALIKE_SAME_ONSET = true;

// =============================================================================

/** Lowercase letters only, accents folded: "O'Garro" -> "ogarro". */
export function letters(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Shortest half of a hyphenated or two-word surname that names the player on
 * its own. Two letters ("Le", "St") are inside too many other words to mean
 * anyone.
 */
export const MIN_TOKEN_LETTERS = 3;

/**
 * The most words a whole surname may be split into in the transcript: "de la
 * cruz" is three.
 */
const MAX_SPLIT_WORDS = 3;

/**
 * The words a surname can be recognised by: the whole thing, and each half of
 * a hyphenated or two-word one. "White-McLain" -> whitemclain, white, mclain.
 * The suffix is never one of them.
 */
export function surnameTokens(lastName: string): string[] {
  const base = stripSuffix(lastName);
  const tokens: string[] = [];
  const whole = letters(base);
  if (whole.length > 0) tokens.push(whole);
  for (const part of base.split(/[\s\-‐-―]+/)) {
    const token = letters(part);
    if (token.length >= MIN_TOKEN_LETTERS && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

/** The whole surname, suffix off, letters only. */
export function surnameKey(lastName: string): string {
  return letters(stripSuffix(lastName));
}

/**
 * The text's words in order, letters only. Hyphens, spaces and underscores
 * split; apostrophes do not. A possessive is the word: "smith's" is "smith".
 */
export function wordList(text: string): string[] {
  const words: string[] = [];
  for (const raw of text.split(/[^\p{L}'’]+/u)) {
    const word = letters(raw.replace(/['’]s$/i, ""));
    if (word.length > 0) words.push(word);
  }
  return words;
}

/**
 * Whether a surname, or one of the extra forms (heard-as), is named in the
 * text: the whole surname as one word or split across up to three ("taylor
 * britt", "de la cruz"), or either half of a hyphenated or two-word surname
 * on its own. A form shorter than MIN_TOKEN_LETTERS never counts.
 */
export function isNamedIn(lastName: string, text: string, extraForms: readonly string[] = []): boolean {
  const words = wordList(text);
  const single = new Set(words);
  const whole = surnameKey(lastName);
  const forms = [...surnameTokens(lastName), ...extraForms.map(letters)].filter((form) => form.length >= MIN_TOKEN_LETTERS);
  if (forms.some((form) => single.has(form))) return true;
  if (whole.length < MIN_TOKEN_LETTERS) return false;
  for (let i = 0; i < words.length; i++) {
    let joined = words[i];
    for (let n = 1; n < MAX_SPLIT_WORDS && i + n < words.length && joined.length < whole.length; n++) {
      joined += words[i + n];
      if (joined === whole) return true;
    }
  }
  return false;
}

// -----------------------------------------------------------------------------
// Close spellings.
// -----------------------------------------------------------------------------

/** Doubled letters collapsed to one: "stallworth" -> "stalworth". Both words are compared this way. */
export function squeeze(word: string): string {
  return word.replace(/(.)\1+/g, "$1");
}

/**
 * Edits between two words: a letter put in, taken out or changed, or two
 * neighbours swapped (optimal string alignment). Stops counting past `max`
 * and returns max + 1, which is all a caller needs to know.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1);
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    before = previous;
    previous = row;
  }
  return Math.min(previous[b.length], max + 1);
}

/** One player as the close-spelling check knows them. */
interface IndexedName {
  playerId: string;
  /** Each surname token, squeezed. */
  tokens: string[];
  /** Heard-as forms, squeezed: a word that is one of these names that player exactly. */
  aliases: string[];
  /** The metaphone codes of each surname token, those at least MIN_METAPHONE_CODE long. */
  sounds: string[];
}

/** Every player on both rosters, for "is anyone else as close to this word". */
export interface NameIndex {
  names: IndexedName[];
}

interface NamedPlayer {
  playerId: string;
  last: string;
  aliases?: readonly string[];
}

const indexes = new WeakMap<object, NameIndex>();

/** The roster's names, built once per roster. */
export function nameIndex(roster: ReadonlyMap<string, NamedPlayer> | readonly NamedPlayer[]): NameIndex {
  const known = indexes.get(roster);
  if (known) return known;
  const names: IndexedName[] = [];
  const players: Iterable<NamedPlayer> = roster instanceof Map ? roster.values() : (roster as readonly NamedPlayer[]);
  for (const player of players) {
    names.push({
      playerId: player.playerId,
      tokens: surnameTokens(player.last).map(squeeze),
      aliases: (player.aliases ?? []).map(letters).filter((form: string) => form.length >= MIN_TOKEN_LETTERS).map(squeeze),
      sounds: surnameTokens(player.last).flatMap(soundsOf),
    });
  }
  const index = { names };
  indexes.set(roster, index);
  return index;
}

/**
 * Whether one word is a close spelling of this player's surname: within the
 * surname's tolerance (closeLimit), and no other player on either roster has
 * a surname, or a heard-as form, as close to it or closer. That keeps a word
 * that is exactly one player's name from passing as a near miss of another's.
 */
export function closeSpelling(player: Pick<NamedPlayer, "playerId" | "last">, word: string, index: NameIndex): boolean {
  const said = squeeze(word);
  let distance = Number.POSITIVE_INFINITY;
  for (const token of surnameTokens(player.last)) {
    const limit = closeLimit(token.length);
    if (limit === 0) continue;
    const off = editDistance(said, squeeze(token), limit);
    if (off <= limit) distance = Math.min(distance, off);
  }
  if (!Number.isFinite(distance)) return false;
  for (const other of index.names) {
    if (other.playerId === player.playerId) continue;
    if (other.aliases.includes(said)) return false;
    if (other.tokens.some((token) => editDistance(said, token, distance) <= distance)) return false;
  }
  return true;
}

// -----------------------------------------------------------------------------
// Sound-alikes.
// -----------------------------------------------------------------------------

/** The metaphone codes of a word worth comparing: primary and alternate, each at least MIN_METAPHONE_CODE long, once. */
export function soundsOf(word: string): string[] {
  if (word.length === 0) return [];
  const [primary, alternate] = doubleMetaphone(word);
  return [...new Set([primary, alternate])].filter((code) => code.length >= MIN_METAPHONE_CODE);
}

/** The fewest edits between any code of the word and any of the player's sounds (within what that sound allows), or infinity. */
function soundDistance(sounds: readonly string[], word: readonly string[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const code of word) {
    for (const sound of sounds) {
      if (SOUND_ALIKE_SAME_ONSET && code[0] !== sound[0]) continue;
      const allowed = soundAlikeEdits(sound);
      const off = editDistance(code, sound, allowed);
      if (off <= allowed) best = Math.min(best, off);
    }
  }
  return best;
}

/**
 * Whether one word (or two adjacent words joined) sounds like this player's
 * surname: a metaphone code within SOUND_ALIKE_EDITS of a surname token's,
 * both at least MIN_METAPHONE_CODE long, and no other player on either roster
 * as close to the word by sound or spelling.
 */
export function soundAlike(player: Pick<NamedPlayer, "playerId" | "last">, word: string, index: NameIndex): boolean {
  const codes = soundsOf(word);
  if (codes.length === 0) return false;
  const own = index.names.find((name) => name.playerId === player.playerId)?.sounds ?? surnameTokens(player.last).flatMap(soundsOf);
  const distance = soundDistance(own, codes);
  if (!Number.isFinite(distance)) return false;
  const said = squeeze(letters(word));
  for (const other of index.names) {
    if (other.playerId === player.playerId) continue;
    if (other.aliases.includes(said) || other.tokens.includes(said)) return false;
    if (soundDistance(other.sounds, codes) <= distance) return false;
  }
  return true;
}

/** How the text names the player: by a form, by a close spelling, by a sound-alike word or pair of words, or not at all. */
export type NamedHow = "form" | "spelling" | "sound";

export function namedHow(player: NamedPlayer, text: string, index: NameIndex, extraForms: readonly string[] = player.aliases ?? []): NamedHow | null {
  if (isNamedIn(player.last, text, extraForms)) return "form";
  const words = wordList(text);
  if (words.some((word) => closeSpelling(player, word, index))) return "spelling";
  const tokens = surnameTokens(player.last);
  for (let i = 0; i < words.length; i++) {
    if (soundAlike(player, words[i], index)) return "sound";
    // Two words joined: a surname the transcript split ("van tree"). The pair
    // must also spell the surname nearly, or two ordinary words would sound
    // like half the roster.
    if (i + 1 < words.length) {
      const joined = words[i] + words[i + 1];
      const spelled = tokens.some((token) => editDistance(squeeze(joined), squeeze(token), closeLimit(token.length) + 1) <= closeLimit(token.length) + 1);
      if (spelled && soundAlike(player, joined, index)) return "sound";
    }
  }
  return null;
}

/**
 * Whether the player is named in the text: by any form isNamedIn takes, by
 * one word that is a close spelling of the surname (closeSpelling), or by a
 * word that sounds like it (soundAlike). The name check (./check.ts) asks
 * this, for the R18 check and the passer rule.
 */
export function namedIn(player: NamedPlayer, text: string, index: NameIndex, extraForms: readonly string[] = player.aliases ?? []): boolean {
  return namedHow(player, text, index, extraForms) !== null;
}

/** Throwing words: a player named just before one of these is said to have thrown the ball. */
const THROW_WORD = /^(?:throw|throws|throwing|threw|thrown|pass|passes|passing|passed)$/;

/** How many words after the surname a throwing word may come. */
export const THROW_WORDS_AFTER = 2;

/**
 * Whether the text says this player threw the ball: the surname (any form
 * isNamedIn takes as a single word) followed within THROW_WORDS_AFTER words
 * by a throwing word. "jones throws", "jones pass to". The passer rule
 * (./check.ts) keeps a non-quarterback's pass only when this is true, and
 * hands in `close` so a close spelling of the surname counts here too.
 */
export function saidToThrow(
  lastName: string,
  text: string,
  extraForms: readonly string[] = [],
  close: (word: string) => boolean = () => false,
): boolean {
  const words = wordList(text);
  const forms = new Set([...surnameTokens(lastName), ...extraForms.map(letters)].filter((form) => form.length >= MIN_TOKEN_LETTERS));
  for (let i = 0; i < words.length; i++) {
    if (!forms.has(words[i]) && !close(words[i])) continue;
    for (let n = 1; n <= THROW_WORDS_AFTER && i + n < words.length; n++) if (THROW_WORD.test(words[i + n])) return true;
  }
  return false;
}
