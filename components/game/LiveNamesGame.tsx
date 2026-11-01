"use client";

import { useSyncExternalStore } from "react";
import { LiveScreen } from "@/components/live/LiveScreen";
import { TeamPanel } from "@/components/panel/TeamPanel";
import { getGameSnapshot, getServerGameSnapshot, subscribeGameSnapshot } from "@/lib/game/snapshot";

// =============================================================================
// main's live screen: names only (Jed, Nov 1: "Take live stats off of main").
//
// testrun2 renders components/livestats/LiveGame.tsx here, which wraps the live
// screen in the stats loop. main never does: no stats loop, no Stats or Out
// menu, no TONIGHT section, and no call to /api/livestats/*, which main does
// not have. This file only builds the team panel (docs/PANEL_SPEC.md) and hands
// it to the live screen, which shows or hides it. With no stats loop the panel
// shows the season leaders.
// =============================================================================

export function LiveNamesGame({ hasApiKey }: { hasApiKey: boolean }) {
  const game = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);
  return (
    <LiveScreen
      hasApiKey={hasApiKey}
      panel={game ? <TeamPanel home={game.home} away={game.away} sport={game.sport} roster={game.statsRoster} tonight={null} /> : undefined}
    />
  );
}
