"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ImportPanel } from "@/components/rosters/ImportPanel";
import { Button, TextLink } from "@/components/ui/Button";
import { RowList, WarningRow } from "@/components/ui/Rows";
import { Toolbar, type Crumb } from "@/components/ui/Toolbar";
import { api } from "@/lib/apiClient";
import type { ScheduleDraft } from "@/lib/schedule/normalize";
import { overallRecord } from "@/lib/schedule/record";
import {
  draftOf,
  emptyDraft,
  isScheduleExtractResponse,
  scheduleImportProps,
  scheduleProblem,
  toScheduleSaveBody,
  type ScheduleExtractResponse,
} from "@/lib/schedule/review";
import type { ScheduleGame } from "@/lib/schedule/types";
import { plural } from "@/lib/ui/format";
import { useToday } from "@/lib/ui/useToday";
import { ScheduleTable } from "./ScheduleTable";

/**
 * Import a team's schedule, check every game, and save (docs/V3_DEFINITION.md
 * 6.7). Laid out like the season stats import: the big drop zone first, then
 * the review table, every cell editable in place, rows added and deleted.
 * Save replaces the team's saved schedule, so saving twice never doubles it.
 * The live screen's team panel shows what is saved (docs/PANEL_SPEC.md).
 *
 * A team with a schedule saved opens with it in the table, so a score can be
 * typed in after Friday's game without importing anything.
 */
export function ScheduleImport({ teamId, initial, crumbs = [] }: { teamId: string; initial: ScheduleGame[]; crumbs?: Crumb[] }) {
  const router = useRouter();
  const today = useToday();
  const saved = useMemo(() => initial.map(draftOf), [initial]);
  const [rows, setRows] = useState<ScheduleDraft[]>(saved);
  // Set while an import is on the table: its file name and what it warned about.
  const [imported, setImported] = useState<{ source: string; warnings: string[] } | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Leaving with unsaved edits loses them, so the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const changeRows = (next: ScheduleDraft[]) => {
    setRows(next);
    setDirty(true);
    setError(null);
  };

  const onImported = (body: ScheduleExtractResponse, from: string) => {
    setRows(body.games);
    setImported({ source: from, warnings: body.warnings });
    setReplacing(false);
    setDirty(true);
    setError(null);
  };

  const problem = scheduleProblem(rows);

  async function save() {
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
    router.push(`/teams/${teamId}`);
    router.refresh();
  }

  const flagged = rows.filter((row) => row.flags.length > 0).length;
  const record = overallRecord(
    rows.flatMap((row) => {
      const team = Number(row.teamScore);
      const opponent = Number(row.opponentScore);
      return row.teamScore.trim() && row.opponentScore.trim() && Number.isFinite(team) && Number.isFinite(opponent)
        ? [{ date: row.date, opponent: row.opponent, site: row.site, teamScore: team, opponentScore: opponent, league: row.league }]
        : [];
    }),
  );

  return (
    <>
      <Toolbar
        crumbs={crumbs}
        title="Schedule"
        actions={
          <>
            <TextLink href={`/teams/${teamId}`}>Cancel</TextLink>
            <Button variant="primary" disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <TextLink href={`/teams/${teamId}/stats`}>Season stats</TextLink>
      </Toolbar>

      <div className="flex flex-col gap-4 p-4">
        {/* First on the page, and big, as on the stats import. Kept mounted once a file is read, so Replace file reopens it. */}
        <div hidden={imported !== null && !replacing}>
          <ImportPanel
            kind="schedule"
            endpoint="/api/schedule/extract"
            title="Import the schedule"
            noun="schedule"
            pastePlaceholder="Copy the team's schedule from a website (MaxPreps, the school's site) and paste it here."
            fields={{ roster_id: teamId, today: today ?? "" }}
            isResult={isScheduleExtractResponse}
            finishedProps={(body) => ({ route: body.route, ...scheduleImportProps(body.games), ...(body.pages ? { pages: body.pages } : {}) })}
            onResult={onImported}
          />
          {imported && replacing && (
            <Button className="mt-2" onClick={() => setReplacing(false)}>
              Keep {imported.source || "this file"}
            </Button>
          )}
        </div>

        <p className="text-muted">
          A paste, a PDF, a screenshot or a saved web page, in any format. StatCast reads each game&apos;s date, opponent, home or away,
          the score and whether it is a league game; check them below. Saving replaces this team&apos;s schedule, and the live
          screen&apos;s team panel shows it.
        </p>

        {error && (
          <p role="alert" className="flex items-center gap-2 text-red">
            <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
            {error}
          </p>
        )}

        {imported && (
          <div className="flex min-h-[38px] flex-wrap items-center gap-3 rounded-[3px] border border-dashed border-line-strong px-3 py-1">
            <span className="min-w-0 truncate font-num font-semibold" title={imported.source}>
              {imported.source}
            </span>
            <span>
              {plural(rows.length, "game")} read
              {flagged > 0 && (
                <>
                  , <span className="font-semibold text-amber-text">{flagged} to check</span>
                </>
              )}
            </span>
            <Button disabled={replacing} onClick={() => setReplacing(true)}>
              Replace file
            </Button>
            <Button
              onClick={() => {
                // Back to what is saved.
                setRows(saved);
                setImported(null);
                setReplacing(false);
                setDirty(false);
                setError(null);
              }}
            >
              Discard
            </Button>
          </div>
        )}

        {imported && imported.warnings.length > 0 && (
          <RowList className="rounded-[3px] border border-line bg-surface">
            {imported.warnings.map((warning) => (
              <WarningRow key={warning} text={warning} />
            ))}
          </RowList>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">
            {imported ? "Read from the file" : saved.length > 0 ? "Saved schedule" : "Games"}
            {rows.length > 0 && <span className="ml-2 font-num normal-case tracking-normal text-muted">{record}</span>}
          </h2>
          {rows.length > 0 ? (
            <ScheduleTable rows={rows} onChange={changeRows} />
          ) : (
            <p className="text-muted">No games yet. Import the schedule above, or add the games by hand.</p>
          )}
          <div>
            <Button onClick={() => changeRows([...rows, emptyDraft()])}>+ Add a game</Button>
          </div>
        </section>
      </div>
    </>
  );
}
