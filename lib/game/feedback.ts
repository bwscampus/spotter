import { api } from "@/lib/apiClient";

// =============================================================================
// The end-of-game feedback card: a rating, what got in the way, and an optional
// short note (docs/V3_DEFINITION.md 7.2 and 10.2). One game_feedback row per
// game, written only when the announcer presses Save. Skip writes nothing.
//
// PRIVACY: the note is free text the announcer types, which is the one place a
// player's name could get in. The card asks them not to, and the note never goes
// to analytics; it lives in game_feedback and is left out of the metric views.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Longest note, in characters. The table's check constraint says the same. */
export const NOTE_MAX_CHARS = 280;

/** Said on the card, under the note. */
export const NOTE_HINT = "Please don't type player names.";

// =============================================================================

export const RATING_MIN = 1;
export const RATING_MAX = 5;

/**
 * What got in the way: the chips, as the codes the table holds. The check
 * constraint on game_feedback.blockers lists the same seven, and a test holds
 * the two equal.
 */
export const BLOCKERS = [
  "wrong_names",
  "missing_names",
  "slow",
  "stats_wrong",
  "stats_missing",
  "too_much_on_screen",
  "nothing",
] as const;
export type Blocker = (typeof BLOCKERS)[number];

export const BLOCKER_LABELS: Record<Blocker, string> = {
  wrong_names: "Wrong names",
  missing_names: "Missing names",
  slow: "Slow",
  stats_wrong: "Stats wrong",
  stats_missing: "Stats missing",
  too_much_on_screen: "Too much on screen",
  nothing: "Nothing",
};

/** "Nothing" says nothing got in the way, so it cannot sit beside a chip that says something did. */
const NOTHING: Blocker = "nothing";

export function isBlocker(value: unknown): value is Blocker {
  return typeof value === "string" && (BLOCKERS as readonly string[]).includes(value);
}

/** What the card is holding before Save. rating is null until one is picked. */
export interface FeedbackDraft {
  rating: number | null;
  blockers: readonly string[];
  note: string;
}

export const EMPTY_DRAFT: FeedbackDraft = { rating: null, blockers: [], note: "" };

/** What one game_feedback row holds, less the columns the database fills in (owner_id, created_at). */
export interface FeedbackRow {
  game_id: string;
  rating: number;
  blockers: Blocker[];
  note: string | null;
}

export type FeedbackProblem = "rating_missing" | "rating_range" | "note_too_long" | "blocker_unknown";

export const PROBLEM_MESSAGES: Record<FeedbackProblem, string> = {
  rating_missing: "Pick a rating from 1 to 5, or skip.",
  rating_range: `The rating has to be a whole number from ${RATING_MIN} to ${RATING_MAX}.`,
  note_too_long: `Keep the note to ${NOTE_MAX_CHARS} characters.`,
  blocker_unknown: "That is not one of the choices.",
};

export type FeedbackCheck = { ok: true; row: FeedbackRow } | { ok: false; problems: FeedbackProblem[] };

/** Characters the way the database counts them (char_length), not UTF-16 units. */
export function noteLength(note: string): number {
  return [...note].length;
}

/**
 * Checks a draft and turns it into the row that would be saved. Pure, so the
 * rules the table enforces can be held to on this side first, where they can
 * be explained to the announcer instead of arriving as a database error.
 */
export function validateFeedback(gameId: string, draft: FeedbackDraft): FeedbackCheck {
  const problems: FeedbackProblem[] = [];

  if (draft.rating === null || draft.rating === undefined) problems.push("rating_missing");
  else if (!Number.isInteger(draft.rating) || draft.rating < RATING_MIN || draft.rating > RATING_MAX) {
    problems.push("rating_range");
  }

  const note = (draft.note ?? "").trim();
  if (noteLength(note) > NOTE_MAX_CHARS) problems.push("note_too_long");

  if (!draft.blockers.every(isBlocker)) problems.push("blocker_unknown");

  if (problems.length > 0) return { ok: false, problems };

  // In the order the chips are shown, each once. "Nothing" only on its own.
  const chosen = BLOCKERS.filter((blocker) => draft.blockers.includes(blocker));
  const blockers = chosen.length > 1 ? chosen.filter((blocker) => blocker !== NOTHING) : chosen;

  return {
    ok: true,
    row: { game_id: gameId, rating: draft.rating as number, blockers, note: note.length > 0 ? note : null },
  };
}

/** A chip pressed: on or off, and "Nothing" and the others push each other off. */
export function toggleBlocker(current: readonly string[], blocker: Blocker): Blocker[] {
  const held = BLOCKERS.filter((candidate) => current.includes(candidate));
  if (held.includes(blocker)) return held.filter((candidate) => candidate !== blocker);
  if (blocker === NOTHING) return [NOTHING];
  // Kept in the order the chips are shown.
  return BLOCKERS.filter((candidate) => candidate === blocker || (candidate !== NOTHING && held.includes(candidate)));
}

/**
 * Saves the row, or replaces the one already there for this game: the game id
 * is the table's key, so pressing Save twice is still one row. The server only
 * lets an account leave feedback on a game it called.
 */
export async function saveFeedback(row: FeedbackRow): Promise<boolean> {
  const result = await api("PUT", `/api/games/${encodeURIComponent(row.game_id)}/feedback`, row);
  if (!result.ok) console.warn(`[Spotter] Could not save the feedback (${result.code ?? result.status}).`);
  return result.ok;
}
