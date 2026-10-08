"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { TableBox } from "@/components/ui/Table";
import { surnameSplits } from "@/lib/rosters/ambiguity";
import {
  BLANK_PLAYER,
  editField,
  freshRow,
  insertByJersey,
  setHeardAs,
  setPronunciations,
  setStoryline,
  setSpotMode,
  setSplit,
  type EditorRow,
  type PlayerField,
} from "@/lib/rosters/editor";
import { FLAG_LABELS, isNote, warningCount } from "@/lib/rosters/flagLabels";
import { MAX_STORYLINE_CHARS } from "@/lib/cards/cardFace";
import { parsePronunciations, writePronunciations } from "@/lib/rosters/pronunciations";
import { FIXABLE_FLAGS, type PlayerReview } from "@/lib/rosters/reviewPlayers";
import { SPOT_MODE_LABELS, SPOT_MODES, type Sport, type SpotMode } from "@/lib/rosters/types";
import { plural } from "@/lib/ui/format";

/** A cell's input: borderless, filling the cell, so the table reads as a spreadsheet. */
const CELL =
  "cell h-8 w-full min-w-0 border-0 bg-transparent px-2 text-[13px] text-ink outline-none transition-colors duration-100 placeholder:text-disabled hover:bg-surface-2 focus:bg-surface";
const NUM_CELL = `${CELL} text-right font-num text-[12px]`;
const TD = "border-r border-b border-cell-line p-0 align-middle";
const TH = "sticky top-0 z-10 h-8 whitespace-nowrap border-b border-line-strong bg-surface px-2 text-left text-[12px] font-semibold text-ink-2";

const FIELDS: Array<{ field: PlayerField; label: string; header: string; placeholder: string; width: string; numeric: boolean; bold?: boolean }> = [
  { field: "jersey", label: "Jersey", header: "#", placeholder: "#", width: "w-12", numeric: true, bold: true },
  { field: "first_name", label: "First name", header: "First", placeholder: "First", width: "w-28", numeric: false },
  { field: "last_name", label: "Last name", header: "Last", placeholder: "Last", width: "w-32", numeric: false, bold: true },
  { field: "position", label: "Position", header: "Pos", placeholder: "Pos", width: "w-14", numeric: false },
  { field: "grade", label: "Grade", header: "Gr", placeholder: "Gr", width: "w-12", numeric: true },
  { field: "height", label: "Height", header: "Ht", placeholder: "Ht", width: "w-14", numeric: true },
  { field: "weight", label: "Weight", header: "Wt", placeholder: "Wt", width: "w-14", numeric: true },
];

/**
 * The roster being reviewed: one row per player, every cell editable in place,
 * the spotting setting beside it, and the row's warnings as badges at its
 * right. docs/V3_DEFINITION.md 6.3.
 *
 * A row's warnings open under it on a click, with the whole reason and the
 * one-click fixes (exact matches only, a pronunciation, which part is the
 * surname). Escape closes it.
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
  // A new player is typed into a row under the table, and only joins the
  // roster on Enter, in its numerical place.
  const table = useRef<HTMLTableElement>(null);
  const jumpTo = useRef<string | null>(null);
  const [draft, setDraft] = useState<EditorRow | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const pronunciationBoxes = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    const key = jumpTo.current;
    if (!key) return;
    jumpTo.current = null;
    table.current?.querySelector(`[data-row-key="${key}"]`)?.scrollIntoView({ block: "center" });
  }, [rows]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  const replace = (key: string, next: (row: EditorRow) => EditorRow) =>
    onChange(rows.map((row) => (row.key === key ? next(row) : row)));

  const commitDraft = () => {
    if (!draft || draft.player.last_name.trim().length === 0) return;
    jumpTo.current = draft.key;
    onChange(insertByJersey(rows, draft));
    setDraft(null);
  };

  const named = rows.filter((row) => row.player.last_name.trim()).length;
  const warnings = warningCount(reviews);
  const columns = FIELDS.length + 6;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex h-8 items-center gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">Players</h2>
        <span className="font-num text-[12px]">{named}</span>
        {warnings > 0 && <span className="text-amber-text">{plural(warnings, "warning")}</span>}
      </div>

      {rows.length === 0 && !draft && <p className="text-muted">No players yet. Import a roster above, or add players one at a time.</p>}

      {(rows.length > 0 || draft) && (
        <TableBox wide>
          <table ref={table} className="w-full min-w-[1420px] border-collapse text-[13px]">
            <thead>
              <tr>
                {FIELDS.map(({ field, header, width, numeric }) => (
                  <th key={field} className={`${TH} ${width} ${numeric ? "text-right" : ""}`}>
                    {header}
                  </th>
                ))}
                <th className={`${TH} w-28`}>Spotting</th>
                <th className={`${TH} w-40`}>Pronunciation</th>
                <th className={`${TH} w-40`}>Heard as</th>
                <th className={`${TH} w-60`}>Storyline</th>
                <th className={`${TH} w-[176px]`}>Warnings</th>
                <th className={`${TH} w-16`}>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const review = reviews[index];
                const notes = rowNotes(row, review);
                const name = row.player.last_name || "this player";
                const open = expanded === row.key && notes.length > 0;
                return (
                  <Fragment key={row.key}>
                    <tr data-row-key={row.key} className="h-8">
                      {FIELDS.map(({ field, label, placeholder, numeric, bold }) => (
                        <td key={field} className={TD}>
                          <input
                            aria-label={`${label}, ${name}`}
                            title={field === "last_name" ? `Listens for: ${review.forms.length > 0 ? review.forms.join(" · ") : "nothing yet"}` : undefined}
                            placeholder={placeholder}
                            className={`${numeric ? NUM_CELL : CELL} ${bold ? "font-semibold" : ""}`}
                            value={row.player[field] ?? ""}
                            onChange={(event) => replace(row.key, (current) => editField(current, field, event.target.value, sport))}
                          />
                        </td>
                      ))}
                      <td className={TD}>
                        <select
                          aria-label={`Spotting for ${name}`}
                          title={
                            row.player.spot_mode === "off"
                              ? `Spotting off${review.offensiveLineman ? " (offensive line)" : ""}: saved, never puts a card up.`
                              : undefined
                          }
                          className={`${CELL} cursor-pointer pr-1`}
                          value={row.player.spot_mode}
                          onChange={(event) => replace(row.key, (current) => setSpotMode(current, event.target.value as SpotMode))}
                        >
                          {SPOT_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                              {SPOT_MODE_LABELS[mode]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={TD}>
                        <PronunciationBox
                          label={`Pronunciation for ${name}`}
                          value={row.player.pronunciations}
                          onChange={(said) => replace(row.key, (current) => setPronunciations(current, said))}
                          register={(element) => {
                            if (element) pronunciationBoxes.current.set(row.key, element);
                            else pronunciationBoxes.current.delete(row.key);
                          }}
                        />
                      </td>
                      <td className={TD}>
                        <PronunciationBox
                          label={`Heard as, for ${name}`}
                          placeholder="what speech recognition wrote"
                          value={row.player.heard_as ?? []}
                          onChange={(forms) => replace(row.key, (current) => setHeardAs(current, forms))}
                        />
                      </td>
                      <td className={TD}>
                        <input
                          aria-label={`Storyline for ${name}`}
                          title="One line under the name on the card"
                          placeholder="Committed to Fresno State"
                          maxLength={MAX_STORYLINE_CHARS}
                          className={CELL}
                          value={row.player.storyline ?? ""}
                          onChange={(event) => replace(row.key, (current) => setStoryline(current, event.target.value))}
                        />
                      </td>
                      <td className={`${TD} w-[176px] px-2`}>
                        {notes.length > 0 && (
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-label={`Warnings for ${name}: ${notes.map((note) => note.reason).join(" ")}`}
                            onClick={() => setExpanded(open ? null : row.key)}
                            className="flex max-w-full cursor-pointer items-center gap-1"
                          >
                            <Badge tone={notes[0].warning ? "amber" : "neutral"} reason={notes[0].reason}>
                              {notes[0].label}
                            </Badge>
                            {notes.length > 1 && (
                              <span className="text-[11px] font-semibold text-ink-2" title={notes.slice(1).map((note) => note.reason).join(" ")}>
                                +{notes.length - 1}
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                      <td className={`${TD} border-r-0 px-2 text-right`}>
                        <button
                          type="button"
                          aria-label={`Remove ${row.player.last_name || "player"}`}
                          onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
                          className="cursor-pointer text-[12px] text-muted hover:text-red"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-surface-2">
                        <td colSpan={columns} className="border-b border-line px-3 py-2">
                          <RowWarnings
                            row={row}
                            review={review}
                            notes={notes}
                            onExactOnly={() => replace(row.key, (current) => setSpotMode(current, "exact_only"))}
                            onPronunciation={() => {
                              const box = pronunciationBoxes.current.get(row.key);
                              box?.focus();
                              box?.scrollIntoView({ block: "center" });
                            }}
                            onSplit={(first, last) => replace(row.key, (current) => setSplit(current, first, last))}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            {draft && (
              <tfoot>
                <tr
                  className="h-8 bg-surface-2"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitDraft();
                    } else if (event.key === "Escape") {
                      setDraft(null);
                    }
                  }}
                >
                  {FIELDS.map(({ field, label, placeholder, numeric }, index) => (
                    <td key={field} className={TD}>
                      <input
                        autoFocus={index === 0}
                        aria-label={`New player ${label.toLowerCase()}`}
                        placeholder={placeholder}
                        className={numeric ? NUM_CELL : CELL}
                        value={draft.player[field] ?? ""}
                        onChange={(event) => setDraft(editField(draft, field, event.target.value, sport))}
                      />
                    </td>
                  ))}
                  <td colSpan={6} className={`${TD} border-r-0 px-2 text-[12px] text-muted`}>
                    Enter adds {draft.player.last_name.trim() ? "" : "(needs a last name) "}in number order. Esc cancels.{" "}
                    <button type="button" onClick={() => setDraft(null)} className="cursor-pointer text-accent hover:underline">
                      Cancel
                    </button>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </TableBox>
      )}

      <div>
        <Button onClick={() => setDraft((current) => current ?? freshRow(BLANK_PLAYER, sport))}>Add player</Button>
      </div>
    </section>
  );
}

/** One thing a row's Warnings cell says: a short label, the whole reason, and whether it needs a look. */
interface RowNote {
  key: string;
  label: string;
  reason: string;
  warning: boolean;
}

/**
 * Everything the review says about a player, warnings that need a look first:
 * the flags, any typed "heard as" form that was refused, and why spotting
 * starts exact-only when the editor chose it.
 */
function rowNotes(row: EditorRow, review: PlayerReview): RowNote[] {
  const notes: RowNote[] = review.flags.map((flag, at) => ({ key: flag, label: FLAG_LABELS[flag], reason: review.reasons[at], warning: !isNote(flag) }));
  for (const rejected of review.heardAsRejected) {
    notes.push({ key: `heard-${rejected.form}`, label: "Heard as refused", reason: `Not saved as heard as: ${rejected.reason}`, warning: true });
  }
  if (row.player.spot_mode === "exact_only" && !row.spotModeChosen && review.exactOnlyBecause) {
    notes.push({
      key: "exact-default",
      label: "Exact by default",
      reason: `Exact only by default, because "${review.exactOnlyBecause}" would put this card up. Change it back in Spotting if you want.`,
      warning: false,
    });
  }
  return notes.sort((a, b) => Number(b.warning) - Number(a.warning));
}

/** A row's warnings opened under it: every reason in full, and the fixes that go with them. */
function RowWarnings({
  row,
  review,
  notes,
  onExactOnly,
  onPronunciation,
  onSplit,
}: {
  row: EditorRow;
  review: PlayerReview;
  notes: RowNote[];
  onExactOnly: () => void;
  onPronunciation: () => void;
  onSplit: (first: string, last: string) => void;
}) {
  const fixable = review.flags.some((flag) => FIXABLE_FLAGS.includes(flag));
  // A spelling Spotter cannot hear has one fix: say how it sounds.
  const unheard = !fixable && review.flags.some((flag) => flag === "no_spoken_forms" || flag === "letters_dropped");
  return (
    <div className="flex flex-col gap-1">
      {notes.map((note) => (
        <p key={note.key} className="flex items-center gap-2">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${note.warning ? "bg-amber-dot" : "bg-line-strong"}`} />
          <span className="font-semibold">{note.label}.</span> {note.reason}
        </p>
      ))}
      {fixable && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {row.player.spot_mode === "exact_only" ? (
            <span className="font-semibold text-ink-2">Exact matches only is on.</span>
          ) : (
            <Button onClick={onExactOnly}>Exact matches only</Button>
          )}
          <Button onClick={onPronunciation}>Add pronunciation</Button>
        </div>
      )}
      {unheard && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button onClick={onPronunciation}>Add pronunciation</Button>
        </div>
      )}
      {review.flags.includes("ambiguous_last_name") && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[12px] font-semibold text-ink-2">Surname</span>
          {surnameSplits(row.player.first_name, row.player.last_name).map((split) => (
            <Button
              key={split.last}
              aria-pressed={split.last === row.player.last_name}
              className={split.last === row.player.last_name ? "border-ink font-semibold" : ""}
              onClick={() => onSplit(split.first, split.last)}
            >
              {split.last}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
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
  placeholder = "oh-soo-EH-tuh",
}: {
  label: string;
  value: string[];
  onChange: (said: string[]) => void;
  register?: (element: HTMLInputElement | null) => void;
  placeholder?: string;
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
      placeholder={placeholder}
      className={CELL}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parsePronunciations(event.target.value));
      }}
    />
  );
}
