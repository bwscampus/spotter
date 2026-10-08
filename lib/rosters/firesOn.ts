import { commonPhraseHits } from "./commonPhraseHits";
import { commonWordHits } from "./commonWordHits";

/**
 * The everyday word or play-by-play phrase that would put this surname up, or
 * null. Why an imported common-word name starts exact-only (defaultSpotMode),
 * and why a "heard as" form that is a common word is refused (checkHeardAs).
 */
export function firesOn(forms: string[]): string | null {
  if (forms.length === 0) return null;
  const phrases = commonPhraseHits(forms);
  if (phrases.verdict === "would_fire") return phrases.hits[0]?.word ?? null;
  const words = commonWordHits(forms);
  if (words.verdict === "would_fire") return words.hits[0]?.word ?? null;
  return null;
}
