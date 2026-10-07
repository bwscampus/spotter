// =============================================================================
// The "Also said as" box on the review screen.
//
// One text field, comma separated, because an announcer adding a pronunciation
// is writing a note to themselves and should not have to click Add for each
// one. What they type is stored verbatim; turning it into something the matcher
// can compare against is spokenForms' job.
// =============================================================================

/** What a pronunciation longer than this is, is a sentence. */
const MAX_LENGTH = 40;

/** Splits the box into entries, dropping blanks and repeats but keeping the words as typed. */
export function parsePronunciations(text: string): string[] {
  const seen = new Set<string>();
  const said: string[] = [];
  for (const part of text.split(",")) {
    const trimmed = part.trim().slice(0, MAX_LENGTH);
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    said.push(trimmed);
  }
  return said;
}

/** Back into the box. The trailing separator is not added, so typing can continue. */
export function writePronunciations(said: readonly string[]): string {
  return said.join(", ");
}
