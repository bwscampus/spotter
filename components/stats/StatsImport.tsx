"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { ImportPanel } from "@/components/rosters/ImportPanel";
import { Badge } from "@/components/ui/Badge";
import { Button, TextLink } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { RowList, WarningRow } from "@/components/ui/Rows";
import { TableBox } from "@/components/ui/Table";
import { Toolbar, type Crumb } from "@/components/ui/Toolbar";
import { lineText, seasonLine } from "@/lib/cards/lines";
import { MAX_STAT_LINES, MAX_STAT_LINE_LENGTH } from "@/lib/cards/limits";
import { FOOTBALL_STAT_KEYS, FOOTBALL_STAT_LABELS, type FootballStatKey } from "@/lib/cards/statKeys";
import { columnGroups } from "@/lib/stats/columnGroups";
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
import type { StatsExtractResponse } from "@/lib/stats/types";
import { api } from "@/lib/apiClient";
import { plural } from "@/lib/ui/format";

/** A spreadsheet cell's input: borderless, filling the cell. */
const CELL =
  "cell h-8 w-full min-w-0 border-0 bg-transparent px-2 text-[13px] text-ink outline-none transition-colors duration-100 hover:bg-surface-2 focus:bg-surface";
const NUM_CELL = `${CELL} w-16 text-right font-num text-[12px]`;
const TH = "sticky top-0 z-10 h-8 whitespace-nowrap border-b border-line-strong bg-surface px-2 text-left text-[12px] font-semibold text-ink-2";
const GROUP_TH = "h-6 whitespace-nowrap border-l border-line bg-surface px-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-2";
const TD = "border-b border-cell-line px-2 align-middle";

function isStatsResult(body: unknown): body is StatsExtractResponse {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as { blocks?: unknown; roster?: unknown; kind?: unknown };
  return Array.isArray(candidate.blocks) && Array.isArray(candidate.roster) && (candidate.kind === "numbers" || candidate.kind === "lines");
}

/** "14 rows read, 10 matched, 4 unmatched". */
export function readCounts(review: Pick<StatsReview, "rows" | "unmatched">): { read: number; matched: number; unmatched: number } {
  return { read: review.rows.length + review.unmatched, matched: review.rows.length, unmatched: review.unmatched };
}

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
            isResult={isStatsResult}
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

/** The first three cells every review row has: the sheet's name, who it landed on, the number. */
function PlayerCells({ row }: { row: ReviewRow }) {
  return (
    <>
      <td className={`${TD} whitespace-nowrap`}>{row.mismatchedName ?? row.player.last_name}</td>
      <td className={`${TD} whitespace-nowrap font-semibold`}>{row.player.last_name}</td>
      <td className={`${TD} text-right font-num text-[12px] font-semibold`}>{row.player.jersey ?? "?"}</td>
    </>
  );
}

/** "Matched", or why the match needs a look. */
function CheckCell({ row }: { row: ReviewRow }) {
  return (
    <td className={`${TD} whitespace-nowrap`}>
      {row.mismatchedName ? (
        <Badge tone="amber" reason={`Matched by jersey; the sheet says ${row.mismatchedName}.`}>
          Name differs
        </Badge>
      ) : (
        <span className="font-semibold text-green">Matched</span>
      )}
    </td>
  );
}

/** Football: one row per player, one column per stat under its group, and what the card will say. */
function NumberTable({
  rows,
  columns,
  showAll,
  onShowAll,
  onChange,
}: {
  rows: ReviewRow[];
  columns: FootballStatKey[];
  showAll: boolean;
  onShowAll: (showAll: boolean) => void;
  onChange: (id: string, key: FootballStatKey, value: string) => void;
}) {
  const groups = columnGroups(columns);
  const firstOfGroup = new Set(groups.map((group) => group.keys[0]));
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={showAll} onChange={(event) => onShowAll(event.target.checked)} />
        Show every stat, not just the ones on this sheet
      </label>
      <TableBox wide>
        <table className="border-collapse text-[13px]">
          <thead>
            <tr>
              <th colSpan={3} className="h-6 bg-surface" />
              {groups.map((group) => (
                <th key={group.label} colSpan={group.keys.length} className={GROUP_TH}>
                  {group.label}
                </th>
              ))}
              <th colSpan={2} className="h-6 border-l border-line bg-surface" />
            </tr>
            <tr>
              <th className={TH}>Name in file</th>
              <th className={TH}>Matched player</th>
              <th className={`${TH} text-right`}>#</th>
              {columns.map((key) => (
                <th key={key} className={`${TH} text-right ${firstOfGroup.has(key) ? "border-l border-l-line" : ""}`}>
                  {FOOTBALL_STAT_LABELS[key]}
                </th>
              ))}
              <th className={`${TH} border-l border-l-line`}>Card line</th>
              <th className={TH}>Check</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const card = lineText(seasonLine(row.stats));
              return (
                <tr key={row.player.id} className="h-8">
                  <PlayerCells row={row} />
                  {columns.map((key) => (
                    <td key={key} className={`border-b border-cell-line p-0 ${firstOfGroup.has(key) ? "border-l border-l-line" : ""}`}>
                      <input
                        type="number"
                        step="any"
                        aria-label={`${FOOTBALL_STAT_LABELS[key]} for #${row.player.jersey ?? "?"}`}
                        className={NUM_CELL}
                        value={row.stats[key] ?? ""}
                        onChange={(event) => onChange(row.player.id, key, event.target.value)}
                      />
                    </td>
                  ))}
                  <td className={`${TD} whitespace-nowrap border-l border-l-line text-ink-2`}>
                    {card.length > 0 ? card : <span className="text-muted">Nothing for the card.</span>}
                  </td>
                  <CheckCell row={row} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableBox>
    </div>
  );
}

/** Every other sport: up to three lines per player, read on air exactly as written. */
function LineTable({ rows, onChange }: { rows: ReviewRow[]; onChange: (id: string, index: number, value: string) => void }) {
  const lines = Array.from({ length: MAX_STAT_LINES }, (_, index) => index);
  return (
    <TableBox wide>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={TH}>Name in file</th>
            <th className={TH}>Matched player</th>
            <th className={`${TH} text-right`}>#</th>
            {lines.map((index) => (
              <th key={index} className={`${TH} ${index === 0 ? "border-l border-l-line" : ""}`}>
                Line {index + 1}
              </th>
            ))}
            <th className={TH}>Check</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.player.id}>
              <tr className="h-8">
                <PlayerCells row={row} />
                {lines.map((index) => (
                  <td key={index} className={`min-w-[180px] border-b border-r border-cell-line p-0 ${index === 0 ? "border-l border-l-line" : ""}`}>
                    <input
                      aria-label={`Stat line ${index + 1} for #${row.player.jersey ?? "?"}`}
                      className={CELL}
                      maxLength={MAX_STAT_LINE_LENGTH}
                      placeholder={index === 0 ? "A line for the card" : "Another line (optional)"}
                      value={row.lines[index] ?? ""}
                      onChange={(event) => onChange(row.player.id, index, event.target.value)}
                    />
                  </td>
                ))}
                <CheckCell row={row} />
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </TableBox>
  );
}
