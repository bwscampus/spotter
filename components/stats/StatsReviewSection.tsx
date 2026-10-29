"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { RowList, WarningRow } from "@/components/ui/Rows";
import { FOOTBALL_STAT_KEYS, type FootballStatKey } from "@/lib/cards/statKeys";
import type { Json } from "@/lib/json";
import type { SavedStats } from "@/lib/rosters/editor";
import {
  columnsIn,
  playersSent,
  statsShortfall,
  toSetSeasonStatsArgs,
  todayIso,
  withStat,
  type ReviewRow,
  type StatsReview,
} from "@/lib/stats/review";
import { api } from "@/lib/apiClient";
import { plural } from "@/lib/ui/format";
import { LineTable, NumberTable, readCounts } from "./StatsTables";

/**
 * A season stats sheet read from the team page's Stats box (Oct 29), checked
 * and saved right there, under the boxes: the same review the Season stats
 * page shows, with its own Save (the toolbar's Save is the roster's).
 *
 * Stats are matched to the saved players, so Save waits while the roster has
 * unsaved changes (`blockedBy`). A save hands back exactly what was written,
 * by jersey and surname, so the table takes it without reloading.
 */
export function StatsReviewSection({
  rosterId,
  review,
  source,
  blockedBy,
  onSaved,
  onDiscard,
}: {
  rosterId: string;
  review: StatsReview;
  source: string;
  blockedBy: string | null;
  onSaved: (saved: SavedStats[], asOf: string | null) => void;
  onDiscard: () => void;
}) {
  const [rows, setRows] = useState<ReviewRow[]>(review.rows);
  // Fixed at import, so clearing a column while editing does not make it vanish.
  const [columns] = useState<FootballStatKey[]>(() => columnsIn(review.rows));
  const [showAll, setShowAll] = useState(false);
  const [asOf, setAsOf] = useState(todayIso);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = readCounts(review);

  const change = (id: string, update: (row: ReviewRow) => ReviewRow) =>
    setRows((current) => current.map((row) => (row.player.id === id ? update(row) : row)));

  async function save() {
    setSaving(true);
    setError(null);
    const args = toSetSeasonStatsArgs(rosterId, review.kind, rows, asOf || null);
    const saved = await api<{ matched: number }>("PUT", `/api/rosters/${encodeURIComponent(rosterId)}/stats`, args.p_stats);
    setSaving(false);
    if (!saved.ok) {
      setError(saved.error || "Could not save these stats. Try again.");
      return;
    }
    // It answers how many players it wrote. Fewer than sent is never a quiet success.
    const shortfall = statsShortfall(playersSent(args), saved.data.matched);
    if (shortfall) {
      setError(shortfall);
      return;
    }
    const sent = (args.p_stats as { as_of: string | null; players: Array<{ id: string; stats: Json | null; lines: string[] }> });
    const byId = new Map(rows.map((row) => [row.player.id, row.player]));
    onSaved(
      sent.players.flatMap((entry) => {
        const player = byId.get(entry.id);
        return player ? [{ jersey: player.jersey, last_name: player.last_name, stats: entry.stats, lines: entry.lines }] : [];
      }),
      sent.as_of,
    );
  }

  return (
    <section data-testid="stats-review" className="flex flex-col gap-3 rounded-[3px] border border-line bg-surface p-3">
      <div className="flex min-h-[38px] flex-wrap items-center gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-2">Season stats</h2>
        <span className="min-w-0 truncate font-num font-semibold" title={source}>
          {source}
        </span>
        <span>
          {plural(counts.read, "row")} read, {counts.matched} matched,{" "}
          <span className={counts.unmatched > 0 ? "font-semibold text-amber-text" : ""}>{counts.unmatched} unmatched</span>
        </span>
        <label className="flex items-center gap-2">
          <span className={LABEL}>Stats as of</span>
          <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} className={`${INPUT} font-num text-[12px]`} />
        </label>
        <span className="ml-auto flex items-center gap-2">
          <Button onClick={onDiscard}>Discard</Button>
          <Button disabled={saving || blockedBy !== null} title={blockedBy ?? undefined} onClick={() => void save()}>
            {saving ? "Saving..." : "Save stats"}
          </Button>
        </span>
      </div>

      {blockedBy && <p className="text-amber-text">{blockedBy}</p>}
      {error && (
        <p role="alert" className="flex items-center gap-2 text-red">
          <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
          {error}
        </p>
      )}

      <p className="text-muted">
        {review.rows.length} of {review.rows.length + review.silent} players matched.
        {review.silent > 0 && ` ${review.silent} had nothing on the sheet.`} Saving replaces this team&apos;s season stats. The
        card shows exactly what is below.
      </p>

      {(counts.unmatched > 0 || review.warnings.length > 0) && (
        <RowList className="rounded-[3px] border border-line bg-surface">
          {counts.unmatched > 0 && <WarningRow text={`${plural(counts.unmatched, "row")} did not match a player. Unmatched rows are not saved.`} />}
          {review.warnings.map((warning) => (
            <WarningRow key={warning} text={warning} />
          ))}
        </RowList>
      )}

      {review.kind === "numbers" ? (
        <NumberTable
          rows={rows}
          columns={showAll ? [...FOOTBALL_STAT_KEYS] : columns}
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
  );
}
