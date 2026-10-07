"use client";

import { useEffect, useRef, useState } from "react";
import { surnameSplits } from "@/lib/rosters/ambiguity";
import {
  BLANK_PLAYER,
  editField,
  freshRow,
  insertByJersey,
  setPronunciations,
  setSpotMode,
  setSplit,
  type EditorRow,
  type PlayerField,
} from "@/lib/rosters/editor";
import { parsePronunciations, writePronunciations } from "@/lib/rosters/pronunciations";
import { FIXABLE_FLAGS, type PlayerReview } from "@/lib/rosters/reviewPlayers";
import { SPOT_MODE_LABELS, SPOT_MODES, type PlayerFlag, type Sport, type SpotMode } from "@/lib/rosters/types";

const CELL =
  "h-8 w-full rounded border border-neutral-200 bg-neutral-50 px-2 text-sm text-neutral-900 focus:border-neutral-600 focus:outline-none";
const LABEL = "text-[11px] font-semibold uppercase tracking-widest text-neutral-500";
const SMALL_BUTTON =
  "cursor-pointer rounded border border-neutral-300 bg-white px-2 py-0.5 text-xs font-semibold text-neutral-800 hover:border-neutral-600";

const FIELDS: Array<{ field: PlayerField; label: string; placeholder: string; span: string }> = [
  { field: "jersey", label: "Jersey", placeholder: "#", span: "col-span-2 sm:col-span-1" },
  { field: "first_name", label: "First name", placeholder: "First", span: "col-span-5 sm:col-span-2" },
  { field: "last_name", label: "Last name", placeholder: "Last", span: "col-span-5 sm:col-span-2" },
  { field: "position", label: "Position", placeholder: "Pos", span: "col-span-3 sm:col-span-1" },
  { field: "grade", label: "Grade", placeholder: "Gr", span: "col-span-3 sm:col-span-1" },
  { field: "height", label: "Height", placeholder: "Ht", span: "col-span-3 sm:col-span-1" },
  { field: "weight", label: "Weight", placeholder: "Wt", span: "col-span-3 sm:col-span-1" },
];

/**
 * The roster being reviewed: one editable row per player, every warning under
 * its row, and the spotting setting beside it. docs/V3_DEFINITION.md 6.3.
 */
export function PlayerTable({
  rows,
  reviews,
  sport,
  onChange,
}: {
  rows: EditorRow[];
  reviews: PlayerReview[];
  sport: Sport | null;
  onChange: (rows: EditorRow[]) => void;
}) {
  // A roster is long, so a row added at the bottom lands off screen and the
  // button looks dead. The new player is typed into a box pinned above the list
  // instead, and only joins the roster on Enter, in its numerical place.
  const list = useRef<HTMLUListElement>(null);
  const jumpTo = useRef<string | null>(null);
  const [draft, setDraft] = useState<EditorRow | null>(null);
  const pronunciationBoxes = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    const key = jumpTo.current;
    if (!key) return;
    jumpTo.current = null;
    list.current?.querySelector(`[data-row-key="${key}"]`)?.scrollIntoView({ block: "center" });
  }, [rows]);

  const replace = (key: string, next: (row: EditorRow) => EditorRow) =>
    onChange(rows.map((row) => (row.key === key ? next(row) : row)));

  const commitDraft = () => {
    if (!draft || draft.player.last_name.trim().length === 0) return;
    jumpTo.current = draft.key;
    onChange(insertByJersey(rows, draft));
    setDraft(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className={LABEL}>
          Players{rows.length > 0 ? ` (${rows.filter((row) => row.player.last_name.trim()).length})` : ""}
        </p>
        <button
          type="button"
          onClick={() => setDraft((current) => current ?? freshRow(BLANK_PLAYER, sport))}
          className="cursor-pointer rounded border border-neutral-300 px-2 py-0.5 text-sm font-semibold text-neutral-800 hover:border-neutral-600"
        >
          Add player
        </button>
      </div>

      {draft && (
        <div
          className="sticky top-2 z-10 mt-2 rounded-lg border border-neutral-300 bg-white p-3 shadow-lg"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            } else if (event.key === "Escape") {
              setDraft(null);
            }
          }}
        >
          <p className={LABEL}>New player</p>
          <div className="mt-2 grid grid-cols-12 gap-2">
            {FIELDS.map(({ field, label, placeholder, span }, index) => (
              <input
                key={field}
                autoFocus={index === 0}
                aria-label={`New player ${label.toLowerCase()}`}
                placeholder={placeholder}
                className={`${CELL} ${span}`}
                value={draft.player[field] ?? ""}
                onChange={(event) => setDraft(editField(draft, field, event.target.value, sport))}
              />
            ))}
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="col-span-3 cursor-pointer text-sm text-neutral-500 hover:text-neutral-700 sm:col-span-2"
            >
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            Press Enter to add {draft.player.last_name.trim() ? "" : "(needs a last name) "}in number order. Esc to cancel.
          </p>
        </div>
      )}

      {rows.length === 0 && !draft && (
        <p className="mt-3 text-sm text-neutral-500">No players yet. Import a roster above, or add players one at a time.</p>
      )}

      <ul ref={list} className="mt-2 flex flex-col gap-2">
        {rows.map((row, index) => {
          const review = reviews[index];
          const off = row.player.spot_mode === "off";
          const fixable = review.flags.some((flag) => FIXABLE_FLAGS.includes(flag));
          return (
            <li
              key={row.key}
              data-row-key={row.key}
              className={`rounded border px-3 py-2 ${
                off ? "border-neutral-200 bg-neutral-50" : review.flags.length > 0 ? "border-amber-300 bg-amber-50" : "border-neutral-200"
              }`}
            >
              <div className="grid grid-cols-12 gap-2">
                {FIELDS.map(({ field, label, placeholder, span }) => (
                  <input
                    key={field}
                    aria-label={label}
                    placeholder={placeholder}
                    className={`${CELL} ${span}`}
                    value={row.player[field] ?? ""}
                    onChange={(event) => replace(row.key, (current) => editField(current, field, event.target.value, sport))}
                  />
                ))}
                <select
                  aria-label={`Spotting for ${row.player.last_name || "this player"}`}
                  className={`${CELL} col-span-4 sm:col-span-2 px-1`}
                  value={row.player.spot_mode}
                  onChange={(event) => replace(row.key, (current) => setSpotMode(current, event.target.value as SpotMode))}
                >
                  {SPOT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {SPOT_MODE_LABELS[mode]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Remove ${row.player.last_name || "player"}`}
                  onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
                  className="col-span-2 cursor-pointer text-sm text-neutral-500 hover:text-neutral-700 sm:col-span-1"
                >
                  Remove
                </button>
              </div>

              {off && (
                <p className="mt-1 text-xs text-neutral-500">
                  Spotting off{review.offensiveLineman ? " (offensive line)" : ""}: saved, never puts a card up.
                </p>
              )}

              <p className="mt-1 text-xs text-neutral-500">
                <span className={LABEL}>Listens for</span>{" "}
                {review.forms.length > 0 ? review.forms.join(" · ") : "nothing yet"}
              </p>

              <label className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className={LABEL}>Pronunciation</span>
                <PronunciationBox
                  label={`Pronunciation for ${row.player.last_name || "this player"}`}
                  value={row.player.pronunciations}
                  onChange={(said) => replace(row.key, (current) => setPronunciations(current, said))}
                  register={(element) => {
                    if (element) pronunciationBoxes.current.set(row.key, element);
                    else pronunciationBoxes.current.delete(row.key);
                  }}
                />
              </label>

              {review.flags.map((flag, flagIndex) => (
                <p key={flag} className={`mt-1 text-xs ${flagTone(flag)}`}>
                  {review.reasons[flagIndex]}
                </p>
              ))}

              {fixable && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  {row.player.spot_mode === "exact_only" ? (
                    <span className="font-semibold text-neutral-600">Exact matches only is on.</span>
                  ) : (
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      onClick={() => replace(row.key, (current) => setSpotMode(current, "exact_only"))}
                    >
                      Exact matches only
                    </button>
                  )}
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    onClick={() => {
                      const box = pronunciationBoxes.current.get(row.key);
                      box?.focus();
                      box?.scrollIntoView({ block: "center" });
                    }}
                  >
                    Add pronunciation
                  </button>
                </div>
              )}

              {review.flags.includes("ambiguous_last_name") && (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={LABEL}>Surname</span>
                  {surnameSplits(row.player.first_name, row.player.last_name).map((split) => (
                    <button
                      key={split.last}
                      type="button"
                      onClick={() => replace(row.key, (current) => setSplit(current, split.first, split.last))}
                      className={`cursor-pointer rounded border px-2 py-0.5 font-semibold ${
                        split.last === row.player.last_name
                          ? "border-neutral-600 text-neutral-900"
                          : "border-neutral-300 text-neutral-600 hover:border-neutral-600"
                      }`}
                    >
                      {split.last}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Notes that need no action read quieter than warnings that do. */
function flagTone(flag: PlayerFlag): string {
  return flag === "single_digit" || flag === "duplicate_jersey" ? "text-neutral-600" : "text-amber-700";
}

/**
 * Comma-separated pronunciations. Keeps its own text so a comma or space typed
 * at the end survives until the next word arrives; the parsed list is what the
 * row stores and what the matcher listens for.
 */
function PronunciationBox({
  label,
  value,
  onChange,
  register,
}: {
  label: string;
  value: string[];
  onChange: (said: string[]) => void;
  register: (element: HTMLInputElement | null) => void;
}) {
  const [text, setText] = useState(() => writePronunciations(value));
  const written = writePronunciations(value);
  // A change from outside (a re-import carried a note over) replaces the box,
  // but typing that parses to the same list leaves it alone.
  if (writePronunciations(parsePronunciations(text)) !== written && text.trim() !== written) setText(written);

  return (
    <input
      ref={register}
      aria-label={label}
      placeholder="oh-soo-EH-tuh"
      className={`${CELL} h-7 max-w-md flex-1`}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parsePronunciations(event.target.value));
      }}
    />
  );
}
