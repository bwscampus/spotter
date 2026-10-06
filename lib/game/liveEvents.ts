import { scoreBucket, type CARD_CUES, type MATCH_KINDS } from "@/lib/analytics/events";
import type { RemovalKey } from "@/lib/keys";
import type { WrongShape } from "@/lib/matching/SpotterEngine";

// =============================================================================
// The props of names.card_removed, built from what the engine says about the
// card that came off. docs/V3_DEFINITION.md 10.2.
//
// PRIVACY: WrongShape is already the shape of a mistake with nothing in it that
// says who: no surname, no jersey, no words. This keeps it that way. The surname
// is on screen in the "Removed" flash and in the local log row, nowhere else.
// =============================================================================

export function cueOf(wrong: WrongShape): (typeof CARD_CUES)[number] {
  if (wrong.kind === "name" || wrong.cue === null) return "name";
  return `number_${wrong.cue}`;
}

/**
 * Exact or near, in the sense section 7.3 uses: a name scoring 1 was the name
 * itself, anything under it was a sound like it. A number either was read as
 * digits (exact) or was heard as words that scored like a number (near); its
 * score is the cue's weight, not a sound, so it does not decide this.
 */
export function matchOf(wrong: WrongShape): (typeof MATCH_KINDS)[number] {
  if (wrong.kind === "number") return wrong.sound ? "near" : "exact";
  return wrong.score >= 1 ? "exact" : "near";
}

export function cardRemovedProps(
  wrong: WrongShape,
  key: RemovalKey,
  cardsOnScreen: number,
  secondsSinceShown: number | null,
) {
  return {
    key,
    cue: cueOf(wrong),
    match: matchOf(wrong),
    score_bucket: scoreBucket(wrong.score),
    cards_on_screen: cardsOnScreen,
    seconds_since_shown: secondsSinceShown === null ? null : Math.max(0, Math.round(secondsSinceShown)),
  };
}
