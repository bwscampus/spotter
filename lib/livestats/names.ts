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

/**
 * Whether the player is named in the text: by any form isNamedIn takes, or by
 * one word that is a close spelling of the surname (closeSpelling). The name
 * check (./check.ts) asks this, for the R18 check and the passer rule.
 */
export function namedIn(player: NamedPlayer, text: string, index: NameIndex, extraForms: readonly string[] = player.aliases ?? []): boolean {
  if (isNamedIn(player.last, text, extraForms)) return true;
  return wordList(text).some((word) => closeSpelling(player, word, index));
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
