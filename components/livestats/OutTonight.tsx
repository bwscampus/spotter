"use client";

import type { StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// Who is out tonight (Oct 11, Part 3): one checkbox per player, both rosters,
// on the game setup screen and behind the live screen's Out button. A ticked
// player is never credited with a play (rule R35) and the reader is told
// (Part 2). His card is untouched: the booth talks about a hurt player all
// night, and the card should still go up when he is named. The list belongs
// to the game (lib/game/snapshot.ts `out`), not the roster, and can change
// mid-game; whoever renders this writes the snapshot.
// =============================================================================

/** Jersey order, a missing number last, then by surname. */
export function outOrder(a: Pick<StatsRosterPlayer, "jersey" | "last">, b: Pick<StatsRosterPlayer, "jersey" | "last">): number {
  const number = (jersey: string | null) => {
    const value = Number((jersey ?? "").replace(/^#/, ""));
    return Number.isFinite(value) && jersey ? value : Number.POSITIVE_INFINITY;
  };
  return number(a.jersey) - number(b.jersey) || a.last.localeCompare(b.last);
}

/** The list with one id ticked or unticked. */
export function toggleOut(out: readonly string[], playerId: string, isOut: boolean): string[] {
  const without = out.filter((id) => id !== playerId);
  return isOut ? [...without, playerId] : without;
}

export function OutTonight({
  roster,
  out,
  onChange,
  sides = { away: "Away", home: "Home" },
  compact = false,
}: {
  roster: readonly StatsRosterPlayer[];
  out: readonly string[];
  onChange: (out: string[]) => void;
  /** What to call each side: the school names when known. */
  sides?: { away: string; home: string };
  /** The live screen's menu: smaller text, a scroll box per side. */
  compact?: boolean;
}) {
  const ticked = new Set(out);
  const column = (side: "away" | "home") => {
    const players = roster.filter((player) => player.side === side).sort(outOrder);
    return (
      <div key={side} className="min-w-0 flex-1">
        <p className={`mb-1 font-semibold ${compact ? "text-xs text-neutral-500" : "text-[12px] text-ink-2"}`}>
          {sides[side]} ({players.filter((player) => ticked.has(player.playerId)).length} out)
        </p>
        <ul className={`flex flex-col ${compact ? "max-h-72 overflow-y-auto pr-1 text-sm" : "max-h-60 overflow-y-auto"}`}>
          {players.map((player) => (
            <li key={player.playerId}>
              <label className="flex cursor-pointer items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                  checked={ticked.has(player.playerId)}
                  onChange={(event) => onChange(toggleOut(out, player.playerId, event.target.checked))}
                />
                <span className="w-8 shrink-0 text-right tabular-nums">{player.jersey ? `#${player.jersey.replace(/^#/, "")}` : ""}</span>
                <span className="min-w-0 truncate">
                  {player.last}
                  {player.first ? <span className={compact ? "text-neutral-500" : "text-ink-2"}>, {player.first}</span> : null}
                </span>
              </label>
            </li>
          ))}
          {players.length === 0 && <li className={compact ? "text-neutral-500" : "text-ink-2"}>No players.</li>}
        </ul>
      </div>
    );
  };
  return (
    <div data-testid="out-tonight" className="flex flex-col gap-2">
      <p className={compact ? "text-xs text-neutral-500" : "text-muted"}>
        Out tonight: a ticked player is never credited with a play, and the reader is told he is not playing. His card still goes up when he is named.
      </p>
      <div className="flex gap-4">
        {column("away")}
        {column("home")}
      </div>
    </div>
  );
}
