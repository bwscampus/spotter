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
const HINT = "Refresh during a dead ball. The mic stays on; if names changed, speech recognition reconnects for about a second.";

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
    say(lostBoost ? `${line} Too many names for the name boost now, so it is off.` : line, lostBoost);
  };

  return (
    <div className="relative shrink-0" data-testid="refresh-rosters">
      <button
        type="button"
        disabled={busy}
        title={HINT}
        onClick={(event) => {
          event.currentTarget.blur();
          void refresh();
        }}
        className="h-9 cursor-pointer rounded-md border border-neutral-300 bg-white/80 px-3 text-sm font-semibold text-neutral-800 hover:border-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400"
      >
        {busy ? "Refreshing..." : "Refresh rosters"}
      </button>
      {/* What changed, for a few seconds, in a bubble above the bar rather than a line in it. */}
      {message && (
        <p
          role="status"
          className={`absolute right-0 top-full z-30 mt-2 w-80 rounded-md border bg-white px-3 py-2 text-xs shadow-lg ${
            message.bad ? "border-amber-300 text-amber-700" : "border-neutral-300 text-neutral-600"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
