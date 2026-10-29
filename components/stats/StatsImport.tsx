"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImportPanel } from "@/components/rosters/ImportPanel";
import { Button, TextLink } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { RowList, WarningRow } from "@/components/ui/Rows";
import { Toolbar, type Crumb } from "@/components/ui/Toolbar";
import { FOOTBALL_STAT_KEYS, type FootballStatKey } from "@/lib/cards/statKeys";
import {
  buildStatsReview,
  columnsIn,
  playersSent,
  statsImportProps,
  statsShortfall,
  toSetSeasonStatsArgs,
  todayIso,
  withStat,
  type ReviewRow,
  type StatsReview,
} from "@/lib/stats/review";
import { isStatsExtractResponse, type StatsExtractResponse } from "@/lib/stats/types";
import { api } from "@/lib/apiClient";
import { plural } from "@/lib/ui/format";
import { LineTable, NumberTable, readCounts } from "./StatsTables";

export { readCounts } from "./StatsTables";

/**
 * Import a team's season stats, check every number, and save.
 * docs/V3_DEFINITION.md 6.4.
 *
 * Stats get read on air as fact, so nothing is saved until the announcer has
 * seen it: which player each row landed on, which rows landed on nobody, and
 * what the card will say.
 *
 * A save goes to the cards preview, or to `afterSave` when game setup sent the
 * announcer here (back to the game, with this team picked).
 */
export function StatsImport({
  rosterId,
  playerCount,
  afterSave = null,
  crumbs = [],
  intro = null,
  note = null,
}: {
  rosterId: string;
  playerCount: number;
  afterSave?: string | null;
  /** The toolbar's breadcrumb above "Season stats": Teams, then the team. */
  crumbs?: Crumb[];
  /** One muted line on what this import does. */
  intro?: string | null;
  /** Reached from game setup: the step line, with the way back. */
  note?: React.ReactNode;
}) {
  const router = useRouter();
  const [review, setReview] = useState<StatsReview | null>(null);
  const [source, setSource] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [columns, setColumns] = useState<FootballStatKey[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [asOf, setAsOf] = useState(todayIso);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imported = (body: StatsExtractResponse, from: string) => {
    const next = buildStatsReview(body);
    setReview(next);
    setSource(from);
    setReplacing(false);
    setRows(next.rows);
    // Fixed at import, so clearing a column while editing does not make it vanish.
    setColumns(columnsIn(next.rows));
    setError(null);
  };

  const change = (id: string, update: (row: ReviewRow) => ReviewRow) =>
    setRows((current) => current.map((row) => (row.player.id === id ? update(row) : row)));

  async function save() {
    if (!review) return;
    setSaving(true);
    setError(null);
    const args = toSetSeasonStatsArgs(rosterId, review.kind, rows, asOf || null);
    const saved = await api<{ matched: number }>("PUT", `/api/rosters/${encodeURIComponent(rosterId)}/stats`, args.p_stats);
    setSaving(false);
    if (!saved.ok) {
      setError(saved.error || "Could not save these stats. Try again.");
      return;
    }
    const matched = saved.data.matched;
    // It answers how many players it wrote. Fewer than sent is never a quiet success.
    const shortfall = statsShortfall(playersSent(args), matched);
    if (shortfall) {
      setError(shortfall);
      return;
    }
    router.push(afterSave ?? `/teams/${rosterId}/cards`);
    router.refresh();
  }

  const shownColumns = showAll ? [...FOOTBALL_STAT_KEYS] : columns;
  const counts = review ? readCounts(review) : null;

  return (
    <>
      <Toolbar
        crumbs={crumbs}
        title="Season stats"
        actions={
          <>
            <TextLink href={afterSave ?? `/teams/${rosterId}`}>Cancel</TextLink>
            <Button variant="primary" disabled={!review || saving} onClick={() => void save()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <TextLink href={`/teams/${rosterId}/cards`}>Cards preview</TextLink>
      </Toolbar>

      <div className="flex flex-col gap-4 p-4">
        {/* First on the page, and big (Jed, Oct 6). Kept mounted once a file is read, so Replace file reopens it rather than starting it over. */}
        <div hidden={review !== null && !replacing}>
          <ImportPanel
            kind="stats"
            endpoint="/api/stats/extract"
            title="Import season stats"
            noun="stats sheet"
            pastePlaceholder="Copy the team's stats tables from a website and paste them here."
            fields={{ roster_id: rosterId }}
            blockedBy={
              playerCount === 0 ? "Save this team's roster first. Stats are matched to the saved players by jersey number." : null
            }
            isResult={isStatsExtractResponse}
            finishedProps={(body) => ({
              route: body.route,
              ...statsImportProps(buildStatsReview(body)),
              ...(body.pages ? { pages: body.pages } : {}),
            })}
            onResult={imported}
          />
          {review && replacing && (
            <Button className="mt-2" onClick={() => setReplacing(false)}>
              Keep {source || "this file"}
            </Button>
          )}
        </div>

        {note}
        {intro && <p className="text-muted">{intro}</p>}
        {error && (
          <p role="alert" className="flex items-center gap-2 text-red">
            <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
            {error}
          </p>
        )}

        {review && counts && (
          <section className="flex flex-col gap-3">
            <div className="flex min-h-[38px] flex-wrap items-center gap-3 rounded-[3px] border border-dashed border-line-strong px-3 py-1">
              <span className="min-w-0 truncate font-num font-semibold" title={source}>
                {source}
              </span>
              <span>
                {plural(counts.read, "row")} read, {counts.matched} matched,{" "}
                <span className={counts.unmatched > 0 ? "font-semibold text-amber-text" : ""}>{counts.unmatched} unmatched</span>
              </span>
              <Button disabled={replacing} onClick={() => setReplacing(true)}>
                Replace file
              </Button>
              <Button
                onClick={() => {
                  setReview(null);
                  setRows([]);
                  setReplacing(false);
                }}
              >
                Discard
              </Button>
              <label className="ml-auto flex items-center gap-2">
                <span className={LABEL}>Stats as of</span>
                <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className={`${INPUT} font-num text-[12px]`} />
              </label>
            </div>

            <p className="text-muted">
              {review.rows.length} of {review.rows.length + review.silent} players matched.
              {review.silent > 0 && ` ${review.silent} had nothing on the sheet.`} Saving replaces this team&apos;s season stats.
              The card shows exactly what is below.
            </p>

            {(counts.unmatched > 0 || review.warnings.length > 0) && (
              <RowList className="rounded-[3px] border border-line bg-surface">
                {counts.unmatched > 0 && (
                  <WarningRow
                    text={`${plural(counts.unmatched, "row")} did not match a player. Unmatched rows are not saved.`}
                  />
                )}
                {review.warnings.map((warning) => (
                  <WarningRow key={warning} text={warning} />
                ))}
              </RowList>
            )}

            {review.kind === "numbers" ? (
              <NumberTable
                rows={rows}
                columns={shownColumns}
                showAll={showAll}
                onShowAll={setShowAll}
                onChange={(id, key, value) => change(id, (row) => ({ ...row, stats: withStat(row.stats, key, value) }))}
              />
            ) : (
              <LineTable
                rows={rows}
                onChange={(id, index, value) =>
                  change(id, (row) => {
                    const lines = [...row.lines];
                    lines[index] = value;
                    return { ...row, lines };
                  })
                }
              />
            )}
          </section>
        )}
      </div>
    </>
  );
}
