import { normalizeWord } from "@/lib/matching/matcher";

// =============================================================================
// Turning a printed surname into the forms the matcher listens for.
//
// Announcers say a hyphenated surname both ways: "Sanchez-Greenfield" on the
// first mention and "Sanchez" for the rest of the set. Each part earns its own
// form so either fires the same player.
// =============================================================================

/** Hyphen parts shorter than this are initials or particles, not something an announcer says alone. */
export const MIN_PART_LETTERS = 2;

/** Generational suffixes are not part of the name anyone says. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Returns the normalized full surname first, then each hyphen part, then
 * anything the announcer said it is pronounced as.
 *
 * Forms are built exactly the way compileWatchlist builds them (split on
 * whitespace, normalize each word, join with nothing), so what comes out of
 * here is what the matcher compares against.
 *
 *   Sanchez-Greenfield -> sanchezgreenfield, sanchez, greenfield
 *   O'Garro            -> ogarro
 *   Smith Jr.          -> smith
 *   Nguyen + "win"     -> nguyen, win
 *
 * The derived full surname stays first whatever else is added, because
 * buildGameWatchlist treats forms[0] as the identity of the group. A
 * pronunciation is an extra way in, never the name itself.
 */
export function spokenForms(lastName: string, pronunciations: readonly string[] = []): string[] {
  const base = stripSuffixes(lastName);
  const forms: string[] = [];

  const full = toForm(base);
  if (full) forms.push(full);

  // En dash and em dash show up in PDFs as often as a plain hyphen.
  for (const part of base.split(/[-‐-―]/)) {
    const form = toForm(part);
    if (form.length >= MIN_PART_LETTERS && !forms.includes(form)) forms.push(form);
  }

  for (const said of pronunciations) {
    const form = toSpokenForm(said);
    if (form.length > 0 && !forms.includes(form)) forms.push(form);
  }

  return forms;
}

/**
 * One typed pronunciation as a form the matcher can use.
 *
 * Exported because the review screen shows what it will listen for as the
 * announcer types, and that preview has to agree with what gets saved.
 */
export function toSpokenForm(text: string): string {
  return toForm(text);
}

/** Matches compileWatchlist: every word normalized, joined with no separator. */
function toForm(text: string): string {
  return text.split(/\s+/).map(normalizeWord).join("");
}

/** Drops trailing periods and any generational suffix, however it is punctuated. */
function stripSuffixes(lastName: string): string {
  let text = lastName.trim();
  for (;;) {
    const next = text.replace(/[\s,]+([A-Za-z]+)\.?\s*$/, (match, word: string) =>
      SUFFIXES.has(word.toLowerCase()) ? "" : match,
    );
    if (next === text) break;
    text = next;
  }
  return text.replace(/\.+$/, "").trim();
}
