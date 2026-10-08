// =============================================================================
// Generational suffixes: Jr., Sr., II, III, IV, V. Nobody says them when they
// call a name, so a spoken form, a Deepgram keyterm and a stat check all want
// the surname without one. The card keeps the full name as printed.
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
