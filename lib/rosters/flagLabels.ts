import type { PlayerFlag } from "./types";

/**
 * The short label each roster warning shows as a badge in its player's row
 * (docs/UI_STYLE.md, A4). The full sentence is the review's own reason, in the
 * badge's tooltip and read to a screen reader.
 */
export const FLAG_LABELS: Record<PlayerFlag, string> = {
  ambiguous_last_name: "Which surname?",
  unreadable: "Unreadable",
  missing_jersey: "No jersey",
  not_in_source: "Not in file",
  duplicate_jersey: "Same jersey",
  common_word_fire: "Common word",
  common_word_close: "Near a word",
  common_phrase_fire: "Common phrase",
  common_phrase_close: "Near a phrase",
  look_alike: "Sounds alike",
  similar_jersey: "Similar number",
  single_digit: "Single digit",
  first_name_collision: "First name",
  no_spoken_forms: "Can't listen",
  letters_dropped: "Letters dropped",
};

/** Notes that need no action read quieter than warnings that do. */
export function isNote(flag: PlayerFlag): boolean {
  return flag === "single_digit" || flag === "duplicate_jersey";
}

/** How many warnings that need a look a roster has: every flag but the notes. */
export function warningCount(reviews: ReadonlyArray<{ flags: PlayerFlag[] }>): number {
  return reviews.reduce((total, review) => total + review.flags.filter((flag) => !isNote(flag)).length, 0);
}
