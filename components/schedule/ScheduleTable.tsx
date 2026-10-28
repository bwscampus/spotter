"use client";

import { Badge } from "@/components/ui/Badge";
import { TableBox } from "@/components/ui/Table";
import type { ScheduleDraft } from "@/lib/schedule/normalize";
import { rowProblem } from "@/lib/schedule/review";
import { MAX_OPPONENT_CHARS, type Site } from "@/lib/schedule/types";

// =============================================================================
// The schedule's review table: one row a game, every cell editable in place,
// a row added or removed. A row the reader was not sure of carries an amber
// badge with the reason, like the roster's warnings; a row that cannot be
// saved yet says why under it.
// =============================================================================

/** A spreadsheet cell's input: borderless, filling the cell. */
const CELL =
  "cell h-8 w-full min-w-0 border-0 bg-transparent px-2 text-[13px] text-ink outline-none transition-colors duration-100 hover:bg-surface-2 focus:bg-surface";
const NUM_CELL = `${CELL} w-14 text-right font-num text-[12px]`;
const TH = "sticky top-0 z-10 h-8 whitespace-nowrap border-b border-line-strong bg-surface px-2 text-left text-[12px] font-semibold text-ink-2";
const TD = "border-b border-cell-line px-2 align-middle";

const SITE_LABELS: Record<Site, string> = { H: "Home", A: "Away", N: "Neutral" };

export function ScheduleTable({ rows, onChange }: { rows: ScheduleDraft[]; onChange: (rows: ScheduleDraft[]) => void }) {
  const change = (key: string, update: Partial<ScheduleDraft>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...update } : row)));

  return (
    <TableBox wide>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={TH}>Date</th>
            <th className={TH}>Opponent</th>
            <th className={TH}>Site</th>
            <th className={`${TH} text-right`}>Score</th>
            <th className={`${TH} text-right`}>Opp.</th>
            <th className={TH}>League</th>
            <th className={TH}>Check</th>
            <th className={TH} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const problem = rowProblem(row);
            const label = `game ${index + 1}`;
            return (
              <tr key={row.key} className="h-8">
                <td className={`${TD} w-[150px] p-0`}>
                  <input
                    type="date"
                    aria-label={`Date of ${label}`}
                    className={`${CELL} font-num text-[12px]`}
                    value={row.date}
                    onChange={(event) => change(row.key, { date: event.target.value })}
                  />
                </td>
                <td className={`${TD} min-w-[220px] p-0`}>
                  <input
                    aria-label={`Opponent in ${label}`}
                    className={CELL}
                    maxLength={MAX_OPPONENT_CHARS}
                    placeholder="Opponent"
                    value={row.opponent}
                    onChange={(event) => change(row.key, { opponent: event.target.value })}
                  />
                </td>
                <td className={`${TD} w-[110px] p-0`}>
                  <select
                    aria-label={`Site of ${label}`}
                    className={`${CELL} cursor-pointer`}
                    value={row.site}
                    onChange={(event) => change(row.key, { site: event.target.value as Site })}
                  >
                    {(Object.keys(SITE_LABELS) as Site[]).map((site) => (
                      <option key={site} value={site}>
                        {SITE_LABELS[site]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className={`${TD} w-[72px] p-0`}>
                  <input
                    inputMode="numeric"
                    aria-label={`This team's score in ${label}`}
                    className={NUM_CELL}
                    placeholder="–"
                    value={row.teamScore}
                    onChange={(event) => change(row.key, { teamScore: event.target.value })}
                  />
                </td>
                <td className={`${TD} w-[72px] p-0`}>
                  <input
                    inputMode="numeric"
                    aria-label={`The opponent's score in ${label}`}
                    className={NUM_CELL}
                    placeholder="–"
                    value={row.opponentScore}
                    onChange={(event) => change(row.key, { opponentScore: event.target.value })}
                  />
                </td>
                <td className={`${TD} w-[70px]`}>
                  <input
                    type="checkbox"
                    aria-label={`${label} is a league game`}
                    checked={row.league}
                    onChange={(event) => change(row.key, { league: event.target.checked })}
                  />
                </td>
                <td className={`${TD} min-w-[160px]`}>
                  <span className="flex flex-wrap items-center gap-1">
                    {row.flags.length > 0 && (
                      <Badge tone="amber" reason={row.flags.join(" ")}>
                        Check this game
                      </Badge>
                    )}
                    {problem ? (
                      <span className="text-[12px] text-red">{problem}</span>
                    ) : (
                      row.flags.length === 0 && <span className="text-[12px] text-muted">{row.teamScore.trim() ? "Played" : "To play"}</span>
                    )}
                  </span>
                </td>
                <td className={`${TD} text-right`}>
                  <button
                    type="button"
                    aria-label={`Remove ${label}`}
                    onClick={() => onChange(rows.filter((other) => other.key !== row.key))}
                    className="cursor-pointer text-[12px] text-muted hover:text-red"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableBox>
  );
}
