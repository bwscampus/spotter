"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { isScheduleExtractResponse, scheduleImportProps, type ScheduleExtractResponse } from "@/lib/schedule/review";
import { buildStatsReview, statsImportProps } from "@/lib/stats/review";
import { isStatsExtractResponse, type StatsExtractResponse } from "@/lib/stats/types";
import { useToday } from "@/lib/ui/useToday";
import { ImportPanel, UploadConsent } from "./ImportPanel";
import { RosterImport, type ImportResult } from "./RosterImport";

/**
 * The team page's imports (Jed, Oct 29): three boxes in one row, Roster,
 * Season stats and Schedule, each taking any of the four formats. Big on a
 * team with no players yet; on a team with a roster, one dashed bar until the
 * toolbar's Import or the bar itself opens it, or a file is dragged over it.
 *
 * The boxes stay mounted while folded, so a read still in flight lands, and
 * each keeps its own errors and warnings. What a box reads goes to its owner,
 * whose review opens on the page under the row.
 */
export function TeamImports({
  rosterId,
  foldable,
  open,
  onOpenChange,
  statsBlockedBy,
  scheduleBlockedBy,
  onRoster,
  onStats,
  onSchedule,
  onTypeSchedule,
}: {
  /** The saved team the stats and the schedule are read for; null on a new team. */
  rosterId: string | null;
  /** True on a team with players: the row folds to one bar. */
  foldable: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Why the Season stats box is shut, or null. */
  statsBlockedBy: string | null;
  /** Why the Schedule box is shut, or null. */
  scheduleBlockedBy: string | null;
  onRoster: (result: ImportResult) => void;
  onStats: (result: StatsExtractResponse, source: string) => void;
  onSchedule: (result: ScheduleExtractResponse, source: string) => void;
  /** "or type the games in": the schedule section, open on one empty row. */
  onTypeSchedule: () => void;
}) {
  const today = useToday();
  const [dragging, setDragging] = useState(false);
  const shown = !foldable || open;

  // Escape folds the row again, like the import bar it replaces.
  useEffect(() => {
    if (!foldable || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [foldable, open, onOpenChange]);

  const boxes: ReactNode = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="import-row">
      <RosterImport layout="column" showConsent={false} onImported={onRoster} />
      <ImportPanel
        kind="stats"
        endpoint="/api/stats/extract"
        title="Season stats"
        noun="stats sheet"
        layout="column"
        showConsent={false}
        pastePlaceholder="Copy the team's stats tables from a website and paste them here."
        fields={{ roster_id: rosterId ?? "" }}
        blockedBy={statsBlockedBy}
        isResult={isStatsExtractResponse}
        finishedProps={(body) => ({
          route: body.route,
          ...statsImportProps(buildStatsReview(body)),
          ...(body.pages ? { pages: body.pages } : {}),
        })}
        onResult={onStats}
      />
      <ImportPanel
        kind="schedule"
        endpoint="/api/schedule/extract"
        title="Schedule"
        noun="schedule"
        layout="column"
        showConsent={false}
        pastePlaceholder="Copy the team's schedule from a website (MaxPreps, the school's site) and paste it here."
        fields={{ roster_id: rosterId ?? "", today: today ?? "" }}
        blockedBy={scheduleBlockedBy}
        isResult={isScheduleExtractResponse}
        finishedProps={(body) => ({ route: body.route, ...scheduleImportProps(body.games), ...(body.pages ? { pages: body.pages } : {}) })}
        onResult={onSchedule}
        footer={
          scheduleBlockedBy === null && (
            <p className="text-muted">
              Or <LinkButton onClick={onTypeSchedule}>type the games in</LinkButton>.
            </p>
          )
        }
      />
    </div>
  );

  return (
    <section className="flex flex-col gap-2">
      {!shown && (
        <div
          role="button"
          tabIndex={0}
          aria-expanded={false}
          data-testid="import-bar"
          onClick={() => onOpenChange(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenChange(true);
            }
          }}
          // A file dragged over the bar opens the row, so it can be dropped on the right box.
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
            onOpenChange(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          className={`flex min-h-[64px] cursor-pointer items-center gap-3 rounded-[3px] border border-dashed px-4 text-[15px] transition-colors duration-100 hover:bg-surface-2 ${
            dragging ? "border-ink bg-surface-2" : "border-line-strong"
          }`}
        >
          <span className="text-[17px] font-semibold">Import</span>
          <span className="min-w-0 truncate text-muted">A roster, season stats or a schedule. Click, or drag a file here.</span>
        </div>
      )}
      {shown && foldable && (
        <div className="flex min-h-9 items-center gap-2">
          <p className="text-[17px] font-semibold text-ink">Import</p>
          <span className="text-muted">A roster, season stats or a schedule, in any format.</span>
          <Button className="ml-auto" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      )}
      {shown && <UploadConsent />}
      <div hidden={!shown}>{boxes}</div>
    </section>
  );
}
