import { normalizeWord } from "@/lib/matching/matcher";
import { COMMON_WORDS } from "@/lib/rosters/commonWords";
import type { WatchlistEntry } from "@/lib/watchlist";

// =============================================================================
// The name sound check (Oct 4): before a game, the announcer says each team's
// most called names once into the mic, with the game's own Deepgram settings
// and keyterms. What comes back that is not how Spotter listens for the player
// is offered as a "heard as" form. Two minutes for thirty names, and it learns
// the announcer's own voice. The decisions are here, pure; the screen is
// components/game/SoundCheck.tsx.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** The most called names per team. Thirty in all keeps it to about two minutes. */
export const SOUND_CHECK_PER_TEAM = 15;

/** With no words this long after a name went up, it is skipped. */
export const SOUND_CHECK_WAIT_MS = 4000;

/** Shorter words are filler ("a", "um"), not a surname. */
export const MIN_HEARD_LETTERS = 3;

/** A heard form keeps at most this many words: a surname, or a two-part one. */
const MAX_HEARD_WORDS = 2;

// =============================================================================

export interface SoundCheckName {
  side: "H" | "A";
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  /** The watchlist entry the player belongs to, which is where the forms live. */
  entry: string;
  /** Every form the matcher listens for: the surname and its aliases, normalized. */
  forms: string[];
  priority: number;
}

/**
 * The names to say: each side's `perTeam` most called players (priority from
 * lib/cards/callRate.ts; ties keep roster order), away first, then home. A
 * side with no priorities gives its first `perTeam` in roster order.
 */
export function pickSoundCheck(entries: readonly WatchlistEntry[], perTeam = SOUND_CHECK_PER_TEAM): SoundCheckName[] {
  // Roster order, which the index keeps for the tie-break.
  const all: SoundCheckName[] = [];
  for (const entry of entries) {
    const forms = [normalizeWord(entry.name.replace(/[\s-]+/g, "")), ...entry.aliases.map((alias) => normalizeWord(alias.replace(/[\s-]+/g, "")))].filter(Boolean);
    for (const player of entry.players ?? []) {
      all.push({
        side: player.side,
        jersey: player.jersey,
        first_name: player.first_name,
        last_name: player.last_name,
        entry: entry.name,
        forms,
        priority: player.priority ?? 0,
      });
    }
  }
  const pick = (side: "H" | "A") =>
    all
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => name.side === side)
      .sort((a, b) => b.name.priority - a.name.priority || a.index - b.index)
      .slice(0, perTeam)
      .map(({ name }) => name);
  return [...pick("A"), ...pick("H")];
}

export type Heard =
  /** A word Deepgram wrote is one of the player's forms: nothing to learn. */
  | { kind: "right"; word: string }
  /** What was written instead of the surname, offered as a heard-as form. */
  | { kind: "different"; form: string }
  /** Nothing usable: only the first name, filler, or everyday words. */
  | { kind: "nothing" };

/**
 * What one final transcript says about a name. The player's first name and
 * everyday words are not the surname, so they are set aside; what is left, up
 * to two words in the order said, is how Deepgram wrote the surname.
 */
export function decideHeard(text: string, name: SoundCheckName): Heard {
  const words = text.split(/\s+/).map(normalizeWord).filter(Boolean);
  const forms = new Set(name.forms);
  for (let i = 0; i < words.length; i++) {
    if (forms.has(words[i])) return { kind: "right", word: words[i] };
    if (i + 1 < words.length && forms.has(words[i] + words[i + 1])) return { kind: "right", word: `${words[i]} ${words[i + 1]}` };
  }
  const firsts = new Set((name.first_name ?? "").split(/\s+/).map(normalizeWord).filter(Boolean));
  const rest = words.filter((word) => word.length >= MIN_HEARD_LETTERS && !firsts.has(word) && !COMMON.has(word));
  if (rest.length === 0) return { kind: "nothing" };
  return { kind: "different", form: rest.slice(0, MAX_HEARD_WORDS).join(" ") };
}

const COMMON = new Set(COMMON_WORDS.map(normalizeWord));
