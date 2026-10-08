"use client";

import { useSyncExternalStore } from "react";
import { BarMenu } from "@/components/live/BarMenu";
import { LiveScreen } from "@/components/live/LiveScreen";
import { getGameSnapshot, getServerGameSnapshot, subscribeGameSnapshot } from "@/lib/game/snapshot";
import { logWriter, readGameLog } from "@/lib/log/gameLog";
import { LatestStat, StatsPanel, statsButton } from "./StatsStrip";
import { useLiveStats, type StatsLogIO } from "./useLiveStats";

// =============================================================================
// Where the live screen and live stats meet, and the only place they do.
//
// The live screen is the card path and may never import lib/livestats/
// (docs/V3_DEFINITION.md G3). This file builds the stats loop for the game,
// hands the live screen the narrow bridge it is allowed to know about
// (lib/game/statsBridge.ts), and gives it the Stats button for its top bar and
// the latest stat for its bottom bar. A game with stats off, or any sport but
// football, gets the names-only live screen.
// =============================================================================

/** Live stats' reads and writes go through the same browser log as everything else in the game. */
const STATS_LOG: StatsLogIO = {
  write: (record) => logWriter().push(record),
  read: async (gameId) => {
    // What is still buffered goes to IndexedDB first, so a quick reload loses nothing.
    await logWriter().flush();
    return readGameLog(gameId);
  },
};

export function LiveGame({ hasApiKey }: { hasApiKey: boolean }) {
  const game = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);
  const { controller, view } = useLiveStats(game, STATS_LOG);
  const button = view ? statsButton(view) : null;

  return (
    <LiveScreen
      hasApiKey={hasApiKey}
      stats={controller?.bridge}
      statsMenu={
        controller && view && button ? (
          <BarMenu label={button.label} title="Live stats: what was read, what counted, and corrections" warn={button.warn} wide>
            <StatsPanel
              view={view}
              onOk={(playId) => controller.ok(playId)}
              onDiscard={(playId) => controller.discard(playId)}
              onUndo={() => controller.undo()}
              onCorrect={(playId, correction) => controller.correct(playId, correction)}
              onSwitch={(on) => controller.setOn(on)}
            />
          </BarMenu>
        ) : undefined
      }
      statsLatest={view ? <LatestStat view={view} /> : undefined}
    />
  );
}
