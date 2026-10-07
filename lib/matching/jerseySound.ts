import { jerseySpokenForms } from "@/lib/rosters/jerseyForms";
import { compileWatchlist, normalizeWord, phoneticKeys, scoreAgainst, type CompiledEntry } from "./matcher";

// =============================================================================
// TUNING: hearing a jersey number that never became a number.
//
// Deepgram returns "23" for "twenty three" most of the time, and when it does
// this file never runs. It runs on the misses: "number twenty free", "number
// for teen", "number thurty two". Those arrive as ordinary words, and the only
// way to know they were a number is to score how they sound against how each of
// tonight's numbers is said.
//
// Scored by the same Double Metaphone and Levenshtein the surnames use, so a
// number is heard the way a name is heard. The threshold is the only new knob.
// =============================================================================

/**
 * How close a run of words must sound to a jersey before it counts as one.
 *
 * Higher than the 0.85 a surname needs, because a surname is a rare word and
 * gets the benefit of the doubt while a number word is ordinary English.
 *
 * 0.90 is where the measured scores separate. Real mishearings land at 0.92 and
 * up ("thurty two" 0.96, "for teen" 0.95, "fourty" 0.93, "sevin" 0.92), and the
 * worst ordinary phrase measured is "for the win", which sounds like 14 at 0.82.
 *
 * The cost is honest: "twenty free" for 23 scores 0.807 and is left behind,
 * because it sits below a phrase an announcer really says. Raising the catch to
 * include it would fire on "number for the win". Nothing is lost when Deepgram
 * reads the number properly, which is most of the time; this is the fallback.
 */
export const JERSEY_SOUND_MIN_SCORE = 0.9;

/** Most words one number can be said in: "twenty three" is two, "one oh five" is three. */
export const MAX_JERSEY_WORDS = 3;

// =============================================================================

export interface CompiledJersey {
  jersey: string;
  entry: CompiledEntry;
}

/**
 * Compiles how each of tonight's jerseys sounds. Built once, when the game is,
 * so the hot path only scores against it.
 */
export function compileJerseySounds(jerseys: Iterable<string>): CompiledJersey[] {
  const compiled: CompiledJersey[] = [];
  for (const jersey of jerseys) {
    const forms = jerseySpokenForms(jersey);
    if (forms.length === 0) continue;
    const [entry] = compileWatchlist([{ name: forms[0], aliases: forms.slice(1) }]);
    compiled.push({ jersey, entry });
  }
  return compiled;
}

export interface JerseySound {
  jersey: string;
  score: number;
}

/**
 * The jersey a run of spoken words sounds like, or null.
 *
 * `text` is the run as it was said, with numbers already read back as words:
 * "twenty free", "for teen". Ties go to the higher score, and a tie between two
 * numbers that sound equally alike is no answer at all, because showing the
 * wrong player is worse than showing none.
 */
export function jerseyFromSound(text: string, compiled: CompiledJersey[]): JerseySound | null {
  const normalized = text.split(/\s+/).map(normalizeWord).join("");
  if (normalized.length === 0) return null;

  const keys = phoneticKeys(normalized);
  let best: JerseySound | null = null;
  let tied = false;

  for (const { jersey, entry } of compiled) {
    const { score } = scoreAgainst(normalized, keys, entry);
    if (score < JERSEY_SOUND_MIN_SCORE) continue;
    if (!best || score > best.score) {
      best = { jersey, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }

  return tied ? null : best;
}
