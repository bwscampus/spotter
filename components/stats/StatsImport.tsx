"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImportPanel } from "@/components/rosters/ImportPanel";
import { seasonLines } from "@/lib/cards/lines";
import { MAX_STAT_LINES, MAX_STAT_LINE_LENGTH } from "@/lib/cards/limits";
import { FOOTBALL_STAT_KEYS, FOOTBALL_STAT_LABELS, type FootballStatKey } from "@/lib/cards/statKeys";
import {
  buildStatsReview,
  columnsIn,
  statsImportProps,
  toSetSeasonStatsArgs,
  todayIso,
  withStat,
  type ReviewRow,
  type StatsReview,
} from "@/lib/stats/review";
import type { StatsExtractResponse } from "@/lib/stats/types";
import { api } from "@/lib/apiClient";

const LABEL = "text-[11px] font-semibold uppercase tracking-widest text-neutral-500";
const PRIMARY =
  "cursor-pointer rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2 text-sm font-black uppercase tracking-wider text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:bg-neutral-200 disabled:text-neutral-500";
const CELL =
  "h-8 w-16 rounded border border-neutral-200 bg-neutral-50 px-1 text-right text-sm tabular-nums text-neutral-900 focus:border-neutral-600 focus:outline-none";
const FIELD =
  "h-8 w-full rounded border border-neutral-200 bg-neutral-50 px-2 text-sm text-neutral-900 focus:border-neutral-600 focus:outline-none";

function isStatsResult(body: unknown): body is StatsExtractResponse {
  if (typeof body !== "object" || body === null) return false;
  const candidate = body as { blocks?: unknown; roster?: unknown; kind?: unknown };
  return Array.isArray(candidate.blocks) && Array.isArray(candidate.roster) && (candidate.kind === "numbers" || candidate.kind === "lines");
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
}: {
  rosterId: string;
  playerCount: number;
  afterSave?: string | null;
}) {
  const router = useRouter();
  const [review, setReview] = useState<StatsReview | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [columns, setColumns] = useState<FootballStatKey[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [asOf, setAsOf] = useState(todayIso);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imported = (body: StatsExtractResponse) => {
    const next = buildStatsReview(body);
    setReview(next);
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
    const { p_stats } = toSetSeasonStatsArgs(rosterId, review.kind, rows, asOf || null);
    const saved = await api("PUT", `/api/rosters/${encodeURIComponent(rosterId)}/stats`, p_stats);
    setSaving(false);
    if (!saved.ok) {
      setError(saved.error || "Could not save these stats. Try again.");
      return;
    }
    router.push(afterSave ?? `/teams/${rosterId}/cards`);
    router.refresh();
  }

  const shownColumns = showAll ? [...FOOTBALL_STAT_KEYS] : columns;

  return (
    <div className="flex flex-col gap-6">
      <ImportPanel
        kind="stats"
        endpoint="/api/stats/extract"
        title="Import season stats"
        noun="stats sheet"
        pastePlaceholder="Copy the team's stats tables from a website and paste them here."
        fields={{ roster_id: rosterId }}
        blockedBy={
          playerCount === 0
            ? "Save this team's roster first. Stats are matched to the saved players by jersey number."
            : null
        }
        isResult={isStatsResult}
        finishedProps={(body) => ({
          route: body.route,
          ...statsImportProps(buildStatsReview(body)),
          ...(body.pages ? { pages: body.pages } : {}),
        })}
        onResult={imported}
      />

      {review && (
        <section className="flex flex-col gap-4">
          <div>
            <p className={LABEL}>Check the stats</p>
            <p className="mt-1 text-sm text-neutral-600">
              {review.rows.length} of {review.rows.length + review.silent} players matched.
              {review.silent > 0 && ` ${review.silent} had nothing on the sheet.`} Saving replaces this team&apos;s
              season stats. The card shows exactly what is below.
            </p>
          </div>

          {review.warnings.length > 0 && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {review.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
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
            <LineEditor
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

          <div className="sticky bottom-0 flex flex-wrap items-end gap-4 border-t border-neutral-200 bg-white py-3">
            <label>
              <span className={LABEL}>As of</span>
              <input
                type="date"
                value={asOf}
                onChange={(event) => setAsOf(event.target.value)}
                className="mt-1 block h-9 rounded-md border border-neutral-300 bg-neutral-50 px-2 text-sm"
              />
            </label>
            <button type="button" disabled={saving} onClick={() => void save()} className={PRIMARY}>
              {saving ? "Saving..." : "Save stats"}
            </button>
            <button
              type="button"
              onClick={() => {
                setReview(null);
                setRows([]);
              }}
              className="cursor-pointer px-1 text-sm text-neutral-500 hover:text-neutral-800"
            >
              Discard
            </button>
            {error && (
              <span role="alert" className="text-sm font-semibold text-amber-700">
                {error}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function PlayerName({ row }: { row: ReviewRow }) {
  return (
    <>
      <span className="font-black">
        #{row.player.jersey ?? "?"} {row.player.last_name}
      </span>
      {row.mismatchedName && (
        <span className="block text-xs font-semibold text-amber-700">matched by jersey; the sheet says {row.mismatchedName}</span>
      )}
    </>
  );
}

/** Football: one row per player, one column per stat, and what the card will say under each. */
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
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input type="checkbox" checked={showAll} onChange={(event) => onShowAll(event.target.checked)} />
        Show every stat, not just the ones on this sheet
      </label>
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="bg-neutral-50">
              <th className="sticky left-0 z-10 bg-neutral-50 px-3 py-2 text-left">Player</th>
              {columns.map((key) => (
                <th key={key} className="whitespace-nowrap px-1 py-2 text-right text-xs font-semibold text-neutral-600">
                  {FOOTBALL_STAT_LABELS[key]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const card = seasonLines(row.stats);
              return [
                <tr key={row.player.id} className="border-t border-neutral-200">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1 align-top">
                    <PlayerName row={row} />
                  </td>
                  {columns.map((key) => (
                    <td key={key} className="px-1 py-1">
                      <input
                        type="number"
                        step="any"
                        aria-label={`${FOOTBALL_STAT_LABELS[key]} for #${row.player.jersey ?? "?"}`}
                        className={CELL}
                        value={row.stats[key] ?? ""}
                        onChange={(event) => onChange(row.player.id, key, event.target.value)}
                      />
                    </td>
                  ))}
                </tr>,
                <tr key={`${row.player.id}-card`}>
                  <td colSpan={columns.length + 1} className="px-3 pb-2 text-xs text-neutral-600">
                    {card.length > 0 ? card.join("  /  ") : "Nothing for the card."}
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Every other sport: up to three lines per player, read on air exactly as written. */
function LineEditor({ rows, onChange }: { rows: ReviewRow[]; onChange: (id: string, index: number, value: string) => void }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.player.id} className="rounded-lg border border-neutral-200 px-3 py-2">
          <PlayerName row={row} />
          <div className="mt-2 flex flex-col gap-1">
            {Array.from({ length: MAX_STAT_LINES }, (_, index) => (
              <input
                key={index}
                aria-label={`Stat line ${index + 1} for #${row.player.jersey ?? "?"}`}
                className={FIELD}
                maxLength={MAX_STAT_LINE_LENGTH}
                placeholder={index === 0 ? "A line for the card" : "Another line (optional)"}
                value={row.lines[index] ?? ""}
                onChange={(event) => onChange(row.player.id, index, event.target.value)}
              />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
