"use client";

import { Fragment } from "react";
import { Badge } from "@/components/ui/Badge";
import { TableBox } from "@/components/ui/Table";
import { lineText, seasonLine } from "@/lib/cards/lines";
import { MAX_STAT_LINES, MAX_STAT_LINE_LENGTH } from "@/lib/cards/limits";
import { FOOTBALL_STAT_LABELS, type FootballStatKey } from "@/lib/cards/statKeys";
import { columnGroups } from "@/lib/stats/columnGroups";
import type { ReviewRow, StatsReview } from "@/lib/stats/review";

// =============================================================================
// The season stats review's tables: football's numbers under their groups,
// and every other sport's lines. Shared by the Season stats page
// (StatsImport.tsx) and the team page's Stats box (StatsReviewSection.tsx).
// =============================================================================

/** A spreadsheet cell's input: borderless, filling the cell. */
const CELL =
  "cell h-8 w-full min-w-0 border-0 bg-transparent px-2 text-[13px] text-ink outline-none transition-colors duration-100 hover:bg-surface-2 focus:bg-surface";
const NUM_CELL = `${CELL} w-16 text-right font-num text-[12px]`;
const TH = "sticky top-0 z-10 h-8 whitespace-nowrap border-b border-line-strong bg-surface px-2 text-left text-[12px] font-semibold text-ink-2";
const GROUP_TH = "h-6 whitespace-nowrap border-l border-line bg-surface px-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-2";
const TD = "border-b border-cell-line px-2 align-middle";

/** "14 rows read, 10 matched, 4 unmatched". */
export function readCounts(review: Pick<StatsReview, "rows" | "unmatched">): { read: number; matched: number; unmatched: number } {
  return { read: review.rows.length + review.unmatched, matched: review.rows.length, unmatched: review.unmatched };
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
export function NumberTable({
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
export function LineTable({ rows, onChange }: { rows: ReviewRow[]; onChange: (id: string, index: number, value: string) => void }) {
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
