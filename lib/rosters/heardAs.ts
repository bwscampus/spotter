import { normalizeWord } from "@/lib/matching/matcher";
import { firesOn } from "./firesOn";
import { spokenForms, toSpokenForm } from "./spokenForms";

// =============================================================================
// "Heard as" forms (Oct 4): the words Deepgram actually writes for a surname.
//
// In the Oct 3 game it never spelled the starting quarterback's name right
// once, and wrote it one way thirty times. The thresholds are off limits, so
// each player learns the forms Deepgram writes: typed on the review screen,
// offered from a game's log in Past games, or saved by the sound check. A form
// is an exact way in for the card matcher (spokenForms), an alias the live
// stats reader is told about, and the first repair the stats check tries.
//
// A form is refused when it is another player's name, because it would put
// that card up for this player, and when it is an everyday word, because it
// would put this card up all game. The reason is said in plain words.
// =============================================================================

/** More than this per player is noise on every stats call. */
export const MAX_HEARD_AS_FORMS = 8;

/** A form longer than this is a sentence, not a word Deepgram wrote. */
export const MAX_HEARD_AS_LENGTH = 40;

/** A player as the check needs them: the names and forms a heard-as word must not collide with. */
export interface HeardAsNeighbour {
  first_name: string | null;
  last_name: string;
  pronunciations?: readonly string[];
  heard_as?: readonly string[];
}

export type HeardAsCheck = { ok: true; form: string } | { ok: false; reason: string };

/**
 * Whether `typed` may be saved as one of `player`'s heard-as forms. `others`
 * are the players it must not be: the rest of the team on the review screen,
 * both rosters in Past games and the sound check.
 */
export function checkHeardAs(typed: string, player: HeardAsNeighbour, others: readonly HeardAsNeighbour[]): HeardAsCheck {
  const trimmed = typed.trim();
  if (trimmed.length === 0) return { ok: false, reason: "Type the word Deepgram wrote." };
  if (trimmed.length > MAX_HEARD_AS_LENGTH) return { ok: false, reason: `Keep a heard-as form under ${MAX_HEARD_AS_LENGTH} characters.` };
  const form = toSpokenForm(trimmed);
  if (form.length === 0) return { ok: false, reason: "A heard-as form needs letters." };

  const own = spokenForms(player.last_name, player.pronunciations ?? []);
  if (own.includes(form)) return { ok: false, reason: `"${trimmed}" is already how ${player.last_name} is listened for.` };

  for (const other of others) {
    const name = `${other.first_name ?? ""} ${other.last_name}`.trim();
    const surnames = spokenForms(other.last_name, other.pronunciations ?? [], other.heard_as ?? []);
    if (surnames.includes(form)) return { ok: false, reason: `"${trimmed}" is ${name}'s surname, so it stays theirs.` };
    const firsts = (other.first_name ?? "").split(/\s+/).map(normalizeWord).filter(Boolean);
    if (firsts.includes(form)) return { ok: false, reason: `"${trimmed}" is ${name}'s first name.` };
  }

  const common = firesOn([form]);
  if (common !== null) {
    return { ok: false, reason: `"${trimmed}" sounds like "${common}", which is said all game, so it would put this card up for nothing.` };
  }
  return { ok: true, form: trimmed };
}

export interface HeardAsReview {
  /** The forms that will be saved, as typed, in order, without repeats. */
  accepted: string[];
  rejected: Array<{ form: string; reason: string }>;
}

/** Every typed form of a player through checkHeardAs, for the review screen and the save. */
export function reviewHeardAs(player: HeardAsNeighbour, others: readonly HeardAsNeighbour[]): HeardAsReview {
  const accepted: string[] = [];
  const rejected: HeardAsReview["rejected"] = [];
  const seen = new Set<string>();
  for (const typed of player.heard_as ?? []) {
    const result = checkHeardAs(typed, player, others);
    if (!result.ok) {
      rejected.push({ form: typed.trim(), reason: result.reason });
      continue;
    }
    const key = toSpokenForm(result.form);
    if (seen.has(key)) continue;
    if (accepted.length >= MAX_HEARD_AS_FORMS) {
      rejected.push({ form: result.form, reason: `At most ${MAX_HEARD_AS_FORMS} heard-as forms per player.` });
      continue;
    }
    seen.add(key);
    accepted.push(result.form);
  }
  return { accepted, rejected };
}

/** `form` added to `existing` unless it is already there, capped at MAX_HEARD_AS_FORMS (the oldest goes). */
export function withHeardAs(existing: readonly string[], form: string): string[] {
  const key = toSpokenForm(form);
  const kept = existing.filter((each) => toSpokenForm(each) !== key);
  return [...kept, form.trim()].slice(-MAX_HEARD_AS_FORMS);
}

// The roster editor saves heard-as forms through save_roster with everything
// else, in one transaction (toSaveArgs in lib/rosters/editor.ts). Past games'
// Add and the sound check write one player's forms later through
// PATCH /api/players/[id].
