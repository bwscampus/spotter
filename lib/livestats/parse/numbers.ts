import { isDigits } from "./tokens";

// =============================================================================
// Numbers as the booth says them and the transcript writes them (v7, Part 2):
// digits ("23"), words the numerals option left alone ("seven", "twenty
// three"), "a yard" (1), "inches" (half a yard, fuzzy), "a couple" (2, fuzzy),
// "a handful" (5, fuzzy). Pure and synchronous; every number comes back with
// the token span it was read from, so a caller can tell "3rd and 7" from
// "the 7".
// =============================================================================

export interface NumberToken {
  value: number;
  /** Token indexes, inclusive. */
  start: number;
  end: number;
  /** A number the words only suggest ("inches", "a couple"). */
  fuzzy: boolean;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Wording that means a number without saying one. */
const FUZZY: Array<{ words: string[]; value: number }> = [
  { words: ["inches"], value: 0.5 },
  { words: ["half", "a", "yard"], value: 0.5 },
  { words: ["0.5", "a", "yard"], value: 0.5 },
  { words: ["a", "couple"], value: 2 },
  { words: ["couple"], value: 2 },
  { words: ["a", "few"], value: 3 },
  { words: ["a", "handful"], value: 5 },
  { words: ["handful"], value: 5 },
];

/** Every number in the words, in order. "a yard" is 1 and not fuzzy: the booth said one yard. */
export function parseNumbers(words: readonly string[]): NumberToken[] {
  const found: NumberToken[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (isDigits(word)) {
      // "1 81": the transcript splits a three-digit number into its hundreds and the rest.
      const next = words[i + 1];
      if (word.length === 1 && next !== undefined && /^\d{2}$/.test(next) && word !== "0") {
        found.push({ value: Number(word) * 100 + Number(next), start: i, end: i + 1, fuzzy: true });
      }
      found.push({ value: Number(word), start: i, end: i, fuzzy: false });
      continue;
    }
    if (word === "a" && words[i + 1] === "yard") {
      found.push({ value: 1, start: i, end: i + 1, fuzzy: false });
      i += 1;
      continue;
    }
    const fuzzy = FUZZY.find((entry) => entry.words.every((part, index) => words[i + index] === part));
    if (fuzzy) {
      found.push({ value: fuzzy.value, start: i, end: i + fuzzy.words.length - 1, fuzzy: true });
      i += fuzzy.words.length - 1;
      continue;
    }
    if (word in TENS) {
      const next = words[i + 1];
      if (next !== undefined && next in UNITS && UNITS[next] < 10 && UNITS[next] > 0) {
        found.push({ value: TENS[word] + UNITS[next], start: i, end: i + 1, fuzzy: false });
        i += 1;
      } else found.push({ value: TENS[word], start: i, end: i, fuzzy: false });
      continue;
    }
    if (word in UNITS) found.push({ value: UNITS[word], start: i, end: i, fuzzy: false });
  }
  return found;
}

/** The number whose span starts at `index`, or null. */
export function numberAt(numbers: readonly NumberToken[], index: number): NumberToken | null {
  return numbers.find((number) => number.start === index) ?? null;
}
