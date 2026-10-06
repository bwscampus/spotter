"use client";

import { useState } from "react";
import { Wordmark } from "@/components/SiteHeader";
import {
  BLOCKERS,
  BLOCKER_LABELS,
  EMPTY_DRAFT,
  NOTE_HINT,
  NOTE_MAX_CHARS,
  PROBLEM_MESSAGES,
  RATING_MAX,
  RATING_MIN,
  noteLength,
  saveFeedback,
  toggleBlocker,
  validateFeedback,
  type FeedbackDraft,
  type FeedbackRow,
} from "@/lib/game/feedback";

const LABEL = "text-[11px] font-semibold uppercase tracking-widest text-neutral-500";
const RATINGS = Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, index) => RATING_MIN + index);

const CHOICE = "cursor-pointer rounded-md border px-4 py-2 text-sm font-semibold";
const OFF = "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-600";
const ON = "border-neutral-900 bg-neutral-900 text-white";

/**
 * Shown when End game has written the game's counts, before going back to the
 * menu (docs/V3_DEFINITION.md 7.2). Skip is always there and saves nothing.
 *
 * Nothing on this screen is the hot path: the mic is off and the game is over.
 */
export function FeedbackCard({
  gameId,
  title,
  onDone,
  save = saveFeedback,
}: {
  gameId: string;
  title: string;
  /** Called once, after Save has landed or Skip was pressed. */
  onDone: () => void;
  /** Where the row goes. The database in the browser; a test passes a stand-in. */
  save?: (row: FeedbackRow) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checked = validateFeedback(gameId, draft);
  const tooLong = !checked.ok && checked.problems.includes("note_too_long");

  const submit = async () => {
    if (!checked.ok) {
      setError(PROBLEM_MESSAGES[checked.problems[0]]);
      return;
    }
    setSaving(true);
    setError(null);
    if (await save(checked.row)) {
      onDone();
      return;
    }
    // The announcer is not trapped here: Save can be tried again, and Skip is still there.
    setSaving(false);
    setError("Could not save that. Try again, or skip.");
  };

  return (
    <div className="flex min-h-dvh flex-col bg-white text-black">
      <header className="flex items-center border-b border-neutral-200 px-6 py-4">
        <Wordmark />
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <div>
          <h1 className="text-2xl font-black">How did that go?</h1>
          <p className="mt-1 text-sm text-neutral-500">{title} is saved. This takes ten seconds and helps make Spotter better.</p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL}>Rating</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Rating">
            {RATINGS.map((rating) => (
              <button
                key={rating}
                type="button"
                role="radio"
                aria-checked={draft.rating === rating}
                onClick={() => setDraft((previous) => ({ ...previous, rating }))}
                className={`${CHOICE} h-12 w-12 text-lg ${draft.rating === rating ? ON : OFF}`}
              >
                {rating}
              </button>
            ))}
          </div>
          <p className="text-xs text-neutral-500">
            {RATING_MIN} is bad, {RATING_MAX} is great.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL}>Did anything get in the way?</legend>
          <div className="flex flex-wrap gap-2">
            {BLOCKERS.map((blocker) => {
              const on = draft.blockers.includes(blocker);
              return (
                <button
                  key={blocker}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDraft((previous) => ({ ...previous, blockers: toggleBlocker(previous.blockers, blocker) }))}
                  className={`${CHOICE} ${on ? ON : OFF}`}
                >
                  {BLOCKER_LABELS[blocker]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Anything else? (optional)</span>
          <textarea
            value={draft.note}
            rows={3}
            maxLength={NOTE_MAX_CHARS}
            onChange={(event) => setDraft((previous) => ({ ...previous, note: event.target.value }))}
            className="rounded-md border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-900 focus:border-neutral-600 focus:outline-none"
          />
          <span className="flex justify-between text-xs text-neutral-500">
            <span>{NOTE_HINT}</span>
            <span className={tooLong ? "font-semibold text-amber-700" : ""}>
              {noteLength(draft.note)} / {NOTE_MAX_CHARS}
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm font-semibold text-amber-700">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving || !checked.ok}
            onClick={() => void submit()}
            className="h-10 cursor-pointer rounded-md border border-neutral-800 bg-neutral-900 px-4 text-sm font-semibold text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:bg-neutral-100 disabled:text-neutral-400"
          >
            {saving ? "Saving..." : "Save feedback"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onDone}
            className="h-10 cursor-pointer rounded-md border border-neutral-300 px-4 text-sm font-semibold text-neutral-800 hover:border-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400"
          >
            Skip
          </button>
        </div>
      </main>
    </div>
  );
}
