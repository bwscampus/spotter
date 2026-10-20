// =============================================================================
// The words of one transcript line, the way every parser in this folder reads
// them (v7, Part 2). Deepgram's finals are lowercase with no punctuation and
// numbers as digits (numerals=true), so a word is a run of letters, digits,
// apostrophes and a decimal point ("0.5" is how "half" arrives). A possessive
// is its word: "smith's" is "smith". Pure, synchronous, no allocation beyond
// the list.
// =============================================================================

/** "fourth and 2 from the 35" -> ["fourth", "and", "2", "from", "the", "35"]. */
export function tokenize(text: string): string[] {
  const words: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9'’.#]+/)) {
    if (raw.length === 0) continue;
    // "#22" as typed by hand, "22." at a sentence's end, "'cause".
    let word = raw.replace(/^[.'’]+|[.'’]+$/g, "").replace(/['’]s$/, "");
    if (word.startsWith("#")) word = `number ${word.slice(1)}`;
    if (word.length === 0) continue;
    if (word.includes(" ")) words.push(...word.split(" "));
    else words.push(word);
  }
  return words;
}

/** Whether a token is a whole number as the transcript writes one: "23", not "0.5" or "3rd". */
export function isDigits(word: string): boolean {
  return /^\d{1,3}$/.test(word);
}

/** The letters of a token, for name matching: "o'garro" -> "ogarro". */
export function lettersOf(word: string): string {
  return word.replace(/[^a-z]/g, "");
}
