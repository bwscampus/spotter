// =============================================================================
// Deciding whether a PDF's text layer is worth sending to Claude.
// A roster exported from MaxPreps has real text. A scanned or photographed one
// has none, or a few stray characters from a logo, and has to go as an image.
// =============================================================================

/**
 * Letters per page below which the text layer is treated as absent. A 15-player
 * roster has hundreds of letters per page, so this only has to clear the noise
 * a scanner leaves behind.
 */
export const MIN_LETTERS_PER_PAGE = 40;

/** Counts letters only: digits, punctuation, and whitespace say nothing about a text layer. */
function countLetters(text: string): number {
  return (text.match(/\p{L}/gu) ?? []).length;
}

export function isTextUsable(pages: string[]): boolean {
  if (pages.length === 0) return false;
  let letters = 0;
  for (const page of pages) letters += countLetters(page);
  return letters / pages.length >= MIN_LETTERS_PER_PAGE;
}

/**
 * Joins pages with a visible marker. Claude needs to see where a page ends
 * because the staff table it must skip often starts on a later page.
 */
export function joinPages(pages: string[]): string {
  return pages.map((page, index) => `=== page ${index + 1} ===\n${page.trim()}`).join("\n\n");
}
