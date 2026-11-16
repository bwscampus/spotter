"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { BoothControls } from "@/components/booth/BoothControls";
import { BoothStatus } from "@/components/booth/BoothStatus";
import { LiveScreen } from "@/components/live/LiveScreen";
import { TeamPanel } from "@/components/panel/TeamPanel";
import { BoothLink } from "@/lib/booth/link";
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
//
// Booth partners (Nov 15): it also opens the game's live connection to the
// other laptops in its booth (lib/booth/link.ts) and hands the live screen the
// bridge, the top bar's dot and the host's ⋯ menu section. The card path never
// imports the network side.
// =============================================================================

export function LiveNamesGame({ hasApiKey }: { hasApiKey: boolean }) {
  const game = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);
  const boothId = game?.booth?.gameId ?? null;
  const boothRole = game?.booth?.role ?? null;
  // One connection per booth, kept across Refresh rosters (a new snapshot, the same booth).
  const booth = useMemo(() => (boothId && boothRole ? new BoothLink(boothId, boothRole) : null), [boothId, boothRole]);
  useEffect(() => {
    if (!booth) return;
    booth.start();
    return () => booth.stop();
  }, [booth]);

  return (
    <LiveScreen
      hasApiKey={hasApiKey}
      panel={game ? <TeamPanel home={game.home} away={game.away} sport={game.sport} roster={game.statsRoster} tonight={null} /> : undefined}
      booth={booth ?? undefined}
      boothStatus={booth ? <BoothStatus booth={booth} /> : undefined}
      boothMenu={booth && boothRole === "host" ? <BoothControls gameId={booth.gameId} /> : undefined}
    />
  );
}
