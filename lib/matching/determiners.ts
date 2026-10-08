// =============================================================================
// A surname right after "the" is not a name (Oct 6). Across the two Gemini
// games roster surnames were said 1,356 times; 79 came right after one of the
// words below, and 73 of those 79 were not about a player at all ("the ball",
// "the field", "his own"). A surname match whose word directly before it is
// one of these is vetoed, logged as `veto:determiner`, the way numbers.ts
// vetoes a score or a clock.
//
// Surname matches only: a jersey cue is untouched. Synchronous, a Set lookup
// on the word before; matcher.ts scoring and thresholds are not touched. This
// is the whole list, and it does not grow.
// =============================================================================

export const DETERMINERS: ReadonlySet<string> = new Set(["the", "a", "an", "some", "his", "her", "their", "our", "my", "your", "its"]);

/** The veto reason in the match log. */
export const DETERMINER_VETO = "veto:determiner";

/** Whether the word directly before a surname match is one of DETERMINERS. A plain word comparison. */
export function afterDeterminer(words: readonly { word: string }[], firstIndex: number): boolean {
  const before = words[firstIndex - 1];
  if (!before) return false;
  return DETERMINERS.has(before.word.toLowerCase().replace(/[^a-z]/g, ""));
}
