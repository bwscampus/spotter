"use client";

import { useMemo, useSyncExternalStore } from "react";
import { BarMenu } from "@/components/live/BarMenu";
import { LiveScreen } from "@/components/live/LiveScreen";
import { TeamPanel } from "@/components/panel/TeamPanel";
import { getGameSnapshot, getServerGameSnapshot, subscribeGameSnapshot, writeGameSnapshot, type GameSnapshot } from "@/lib/game/snapshot";
import type { TeamWords } from "@/lib/livestats/types";
import type { TonightSource } from "@/lib/panel/types";
import { logWriter, readGameLog } from "@/lib/log/gameLog";
import { OutTonight } from "./OutTonight";
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
//
// It also builds the team panel (Oct 28, docs/PANEL_SPEC.md), which is
// neither the card path nor live stats: the live screen only shows or hides
// it, and its tonight numbers come from the same stats loop the cards' lines
// do, through the same change notices.
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

/** The team names and cue phrases as live stats takes them, so the stats folder never reads the snapshot's engine types. */
export function teamWordsOf(game: Pick<GameSnapshot, "home" | "away" | "teamCues">): TeamWords {
  const phrases = (side: "H" | "A") => game.teamCues.filter((cue) => cue.side === side).map((cue) => cue.words.join(" ").toLowerCase()).filter(Boolean);
  return { home: { name: game.home.name, phrases: phrases("H") }, away: { name: game.away.name, phrases: phrases("A") } };
}

export function LiveGame({ hasApiKey }: { hasApiKey: boolean }) {
  const game = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);
  const teams = useMemo(() => (game ? teamWordsOf(game) : null), [game]);
  const statsGame = useMemo(() => (game ? { ...game, teams } : null), [game, teams]);
  const { controller, view } = useLiveStats(statsGame, STATS_LOG);
  const button = view ? statsButton(view) : null;
  // Tonight's numbers for the panel: the controller's own totals, heard
  // through the same subscription the cards' lines are. Null on a game
  // without live stats, where the panel shows the season leaders instead.
  const tonight: TonightSource | null = useMemo(
    () =>
      controller
        ? { board: () => controller.tonightBoard(), subscribe: (listener) => controller.bridge.subscribe(() => listener()) }
        : null,
    [controller],
  );

  return (
    <LiveScreen
      hasApiKey={hasApiKey}
      stats={controller?.bridge}
      panel={
        game ? <TeamPanel home={game.home} away={game.away} sport={game.sport} roster={game.statsRoster} tonight={tonight} /> : undefined
      }
      statsMenu={
        controller && view && button && game ? (
          <>
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
            {/* Who is out tonight (Part 3): written to the snapshot, which hands it to the loop the way a refresh hands it the roster. */}
            <BarMenu label={game.out?.length ? `Out · ${game.out.length}` : "Out"} title="Players out tonight: never credited with a play" wide>
              <OutTonight
                roster={game.statsRoster ?? []}
                out={game.out ?? []}
                sides={{ away: game.away.name, home: game.home.name }}
                compact
                onChange={(out) => writeGameSnapshot({ ...game, out })}
              />
            </BarMenu>
          </>
        ) : undefined
      }
      statsLatest={
        controller && view ? (
          <LatestStat view={view} onCorrect={(playId, correction) => controller.correct(playId, correction)} />
        ) : undefined
      }
    />
  );
}
