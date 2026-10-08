import { stripSuffix } from "@/lib/rosters/suffix";

// =============================================================================
// Whether a credited player is named in the words a play was read from, for
// the stat check (./check.ts). Case, hyphens, apostrophes, spaces and
// suffixes (Jr., Sr., II, III, IV) are ignored, because the transcript writes
// a hyphenated surname as two words, as one half, or run together (Oct 6:
// three real tackles were dropped because "Taylor-Britt" came through as
// "taylor britt" and "Davis-Gaither" as "davis").
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

/** The text's words in order, letters only. Hyphens, spaces and underscores split; apostrophes do not. */
export function wordList(text: string): string[] {
  const words: string[] = [];
  for (const raw of text.split(/[^\p{L}']+/u)) {
    const word = letters(raw);
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

/** Throwing words: a player named just before one of these is said to have thrown the ball. */
const THROW_WORD = /^(?:throw|throws|throwing|threw|thrown|pass|passes|passing|passed)$/;

/** How many words after the surname a throwing word may come. */
export const THROW_WORDS_AFTER = 2;

/**
 * Whether the text says this player threw the ball: the surname (any form
 * isNamedIn takes as a single word) followed within THROW_WORDS_AFTER words
 * by a throwing word. "jones throws", "jones pass to". The passer rule
 * (./check.ts) keeps a non-quarterback's pass only when this is true.
 */
export function saidToThrow(lastName: string, text: string, extraForms: readonly string[] = []): boolean {
  const words = wordList(text);
  const forms = new Set([...surnameTokens(lastName), ...extraForms.map(letters)].filter((form) => form.length >= MIN_TOKEN_LETTERS));
  for (let i = 0; i < words.length; i++) {
    if (!forms.has(words[i])) continue;
    for (let n = 1; n <= THROW_WORDS_AFTER && i + n < words.length; n++) if (THROW_WORD.test(words[i + n])) return true;
  }
  return false;
}
