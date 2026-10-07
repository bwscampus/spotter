"use client";

import { useEffect, useRef, useState } from "react";
import { buildGame } from "@/lib/game/buildGame";
import { compareWatchlists, describeRosterChanges } from "@/lib/game/rosterChanges";
import { writeGameSnapshot, type GameSnapshot } from "@/lib/game/snapshot";

/**
 * Pulls both rosters again, without leaving the live screen or stopping the mic.
 *
 * A game is a frozen copy of two rosters, which is what lets the hot path
 * ignore the network entirely. The cost of that is a jersey fixed on the teams
 * screen during a game doing nothing until the game is rebuilt. This is the one
 * place that copy is allowed to be replaced, on a button, in a dead ball.
 *
 * Everything here is outside the hot path: it runs on a click, it awaits, and
 * what it writes is the same snapshot Start writes. The live screen picks the
 * new one up through useSyncExternalStore and builds a new engine from it.
 */
const HINT = "Refresh during a dead ball. The mic stays on; if names changed, Deepgram reconnects for about a second.";

/** How long what changed stays on screen before the hint comes back. */
const MESSAGE_MS = 12_000;

export function RefreshRosters({
  game,
  onRefreshed,
}: {
  game: GameSnapshot;
  /** A new game was written. `changes` is how many players changed, for the count and the event. */
  onRefreshed: (changes: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const say = (text: string, bad: boolean) => {
    clearTimeout(timer.current);
    setMessage({ text, bad });
    timer.current = setTimeout(() => setMessage(null), MESSAGE_MS);
  };

  const refresh = async () => {
    setBusy(true);
    setMessage(null);
    const result = await buildGame(game);
    setBusy(false);

    if (!result.ok) {
      // The game on screen is untouched: an announcer offline mid-game keeps
      // the rosters they started with.
      say(result.error, true);
      return;
    }

    const before = game.watchlist;
    const after = result.snapshot.watchlist;
    const counted = compareWatchlists(before, after);
    const changes = Object.values(counted).reduce((sum, n) => sum + n, 0);
    const lostBoost = game.keyterms.length > 0 && result.snapshot.keyterms.length === 0;

    if (!writeGameSnapshot(result.snapshot)) {
      say("Could not save the refreshed game to this browser.", true);
      return;
    }
    onRefreshed(changes);
    const line = describeRosterChanges(before, after);
    say(lostBoost ? `${line} Too many names for Deepgram now, so the boost is off.` : line, lostBoost);
  };

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-1" data-testid="refresh-rosters">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Rosters</span>
      <div className="flex h-5 items-center">
        <button
          type="button"
          disabled={busy}
          onClick={(event) => {
            event.currentTarget.blur();
            void refresh();
          }}
          className="cursor-pointer rounded border border-neutral-300 px-2 py-0.5 text-sm font-semibold text-neutral-800 hover:border-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400"
        >
          {busy ? "Refreshing..." : "Refresh rosters"}
        </button>
      </div>
      <p
        role="status"
        className={`h-4 max-w-80 truncate text-xs ${message?.bad ? "text-amber-700" : "text-neutral-500"}`}
        title={message?.text ?? HINT}
      >
        {message?.text ?? HINT}
      </p>
    </div>
  );
}
