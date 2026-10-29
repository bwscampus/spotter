"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { RowList, WarningRow } from "@/components/ui/Rows";
import { api } from "@/lib/apiClient";
import type { ScheduleDraft } from "@/lib/schedule/normalize";
import { overallRecord } from "@/lib/schedule/record";
import { draftOf, emptyDraft, scheduleProblem, toScheduleSaveBody, type ScheduleExtractResponse } from "@/lib/schedule/review";
import { fromSaveGame, type ScheduleGame } from "@/lib/schedule/types";
import { plural } from "@/lib/ui/format";
import { ScheduleTable } from "./ScheduleTable";

/** How the section opens: on a read from the Schedule box, or typed in by hand. */
export type ScheduleStart = { mode: "read"; body: ScheduleExtractResponse; source: string } | { mode: "type" };

/**
 * A team's schedule on the team page (Oct 29; docs/V3_DEFINITION.md 6.7): one
 * line saying what is saved, and Edit; or, after a read from the Schedule box
 * or "type the games in", the review table right there, every cell editable,
 * rows added and removed, with its own Save. Save replaces the team's saved
 * schedule, so saving twice never doubles it. The live screen's team panel
 * shows what is saved (docs/PANEL_SPEC.md).
 *
 * `saved` is null when the schedule could not be read: the section says so and
 * offers no Save, so an empty table is never saved over a real schedule.
 */
export function ScheduleSection({
  teamId,
  saved,
  start,
  onSaved,
  onClose,
}: {
  teamId: string;
  saved: ScheduleGame[] | null;
  /** Set when the owner opened it: a read, or typing in. The owner keys the section by it, so each start begins fresh. */
  start: ScheduleStart | null;
  onSaved: (games: ScheduleGame[]) => void;
  /** Discard: back to the saved schedule, closed. */
  onClose: () => void;
}) {
  const savedRows = useMemo(() => (saved ?? []).map(draftOf), [saved]);
  const [open, setOpen] = useState(start !== null);
  const [rows, setRows] = useState<ScheduleDraft[]>(() =>
    start?.mode === "read" ? start.body.games : start?.mode === "type" ? [emptyDraft()] : savedRows,
  );
  const [dirty, setDirty] = useState(start !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaving with unsaved edits loses them, so the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (saved === null) {
    return (
      <p role="alert" className="flex items-center gap-2 text-red">
        <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
        Couldn&apos;t load this team&apos;s schedule. Reload to try again.
      </p>
    );
  }

  if (!open) {
    return (
      <p data-testid="schedule-line" className="flex min-h-8 flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">Schedule</span>
        {saved.length > 0 ? (
          <>
            <span>
              {plural(saved.length, "game")} · <span className="font-num">{overallRecord(saved)}</span>
            </span>
            <LinkButton onClick={() => setOpen(true)}>Edit</LinkButton>
          </>
        ) : (
          <span className="text-muted">
            None yet. Drop one in the Schedule box, or{" "}
            <LinkButton
              onClick={() => {
                setRows([emptyDraft()]);
                setOpen(true);
              }}
            >
              type the games in
            </LinkButton>
            .
          </span>
        )}
      </p>
    );
  }

  const changeRows = (next: ScheduleDraft[]) => {
    setRows(next);
    setDirty(true);
    setError(null);
  };

  const close = () => {
    setRows(savedRows);
    setDirty(false);
    setError(null);
    setOpen(false);
    onClose();
  };

  async function save() {
    const problem = scheduleProblem(rows);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const body = toScheduleSaveBody(rows);
    const result = await api<{ saved: number }>("PUT", `/api/rosters/${encodeURIComponent(teamId)}/schedule`, body);
    setSaving(false);
    if (!result.ok) {
      setError(result.error || "Could not save this schedule. Try again.");
      return;
    }
    // It answers how many games the team now has. Fewer than sent is never a quiet success.
    if (result.data.saved !== body.games.length) {
      setError(`Only ${plural(result.data.saved, "game")} of ${body.games.length} were saved. Try again.`);
      return;
    }
    setDirty(false);
    setOpen(false);
    onSaved(body.games.map(fromSaveGame));
  }

  const read = start?.mode === "read" ? start : null;
  const flagged = rows.filter((row) => row.flags.length > 0).length;

  return (
    <section data-testid="schedule-review" className="flex flex-col gap-3 rounded-[3px] border border-line bg-surface p-3">
      <div className="flex min-h-[38px] flex-wrap items-center gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">Schedule</h2>
        {read && (
          <span className="min-w-0 truncate font-num font-semibold" title={read.source}>
            {read.source}
          </span>
        )}
        <span>
          {plural(rows.length, "game")}
          {read ? " read" : ""}
          {flagged > 0 && (
            <>
              , <span className="font-semibold text-amber-text">{flagged} to check</span>
            </>
          )}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Button onClick={close}>{dirty ? "Discard" : "Close"}</Button>
          <Button disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? "Saving..." : "Save schedule"}
          </Button>
        </span>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-red">
          <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
          {error}
        </p>
      )}
      {read && read.body.warnings.length > 0 && (
        <RowList className="rounded-[3px] border border-line bg-surface">
          {read.body.warnings.map((warning) => (
            <WarningRow key={warning} text={warning} />
          ))}
        </RowList>
      )}
      <p className="text-muted">Saving replaces this team&apos;s schedule. The live screen&apos;s team panel shows what is saved.</p>

      {rows.length > 0 ? <ScheduleTable rows={rows} onChange={changeRows} /> : <p className="text-muted">No games. Add one below.</p>}
      <div>
        <Button onClick={() => changeRows([...rows, emptyDraft()])}>+ Add a game</Button>
      </div>
    </section>
  );
}
