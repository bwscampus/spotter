"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { gameTitle, getGameSnapshot, getServerGameSnapshot, subscribeGameSnapshot } from "@/lib/game/snapshot";

/**
 * The game still open in this browser, if there is one, with the way back to
 * it. A game stays open until End game, so leaving the live screen for the
 * menu or the teams loses nothing.
 */
export function CurrentGame() {
  const game = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);
  if (!game) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3">
      <div className="flex flex-col">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-green-800">Game in progress</span>
        <span className="font-black">{gameTitle(game)}</span>
      </div>
      <Link
        href="/live"
        className="ml-auto rounded-md border border-green-700 bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"
      >
        Back to the live screen
      </Link>
    </div>
  );
}
