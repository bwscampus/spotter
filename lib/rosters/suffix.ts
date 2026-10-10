// =============================================================================
// Generational suffixes: Jr., Sr., II, III, IV, V. Nobody says them when they
// call a name, and they are not part of the surname (Jed, Oct 9): an import
// and a save both take them off (withoutSuffix), so "Bates III" is saved,
// shown and keyed as "Bates". A spoken form, a keyterm and a stat check still
// strip one, for a game built from a roster saved before that.
//
// Pure and import-free on purpose: lib/rosters/spokenForms.ts (which reaches
// lib/matching) and lib/livestats/ (which may not) both use it.
// =============================================================================

export const SUFFIXES: ReadonlySet<string> = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Drops trailing periods and any generational suffix, however it is punctuated: "Smith Jr." -> "Smith". */
export function stripSuffix(lastName: string): string {
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

/** Whether the printed surname carries a suffix the spoken name does not. */
export function hasSuffix(lastName: string): boolean {
  return stripSuffix(lastName) !== lastName.trim().replace(/\.+$/, "").trim();
}

/**
 * A player's names with the suffix taken off the surname: "Jessie" "Bates III"
 * is "Jessie" "Bates". A surname that is nothing but a suffix ("Jessie Bates"
 * "III", a name split one word too late) takes the first name's last word. A
 * surname that would be left empty stays as it was.
 */
export function withoutSuffix(first: string | null, last: string): { first_name: string | null; last_name: string } {
  const bare = last.trim().replace(/[.,]+/g, "").trim();
  if (SUFFIXES.has(bare.toLowerCase())) {
    const words = (first ?? "").trim().split(/\s+/).filter((word) => word.length > 0);
    if (words.length < 2) return { first_name: first, last_name: last.trim() };
    return { first_name: words.slice(0, -1).join(" "), last_name: words[words.length - 1].replace(/,+$/, "") };
  }
  const surname = stripSuffix(last);
  return { first_name: first, last_name: surname.length > 0 ? surname : last.trim() };
}
