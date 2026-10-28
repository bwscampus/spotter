"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { afterPaint } from "@/lib/afterPaint";
import { sideLooks } from "@/lib/game/colors";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import type { PanelMeasure } from "@/lib/panel/fit";
import { panelFits } from "@/lib/panel/fits";
import { PANEL_COLORS, rowsThatFit } from "@/lib/panel/layout";
import { hasLeaders, seasonLeaders, tonightLeaders, type TonightBoard } from "@/lib/panel/leaders";
import { createThrottle, PANEL_THROTTLE_MS } from "@/lib/panel/throttle";
import type { PanelTeam, TonightSource } from "@/lib/panel/types";
import { scheduleView } from "@/lib/panel/view";
import { useToday } from "@/lib/ui/useToday";
import { loadPanelMeasure } from "./measurePanel";
import { panelFont } from "./panelFont";
import { TeamHalf } from "./TeamHalf";

// =============================================================================
// The live screen's team panel (docs/PANEL_SPEC.md): a fixed column left of
// the stage with each team's season and tonight's leaders, away on top and
// home below, the sides the cards use.
//
// Not on the card path: the live screen never imports this file. It is built
// in components/livestats/LiveGame.tsx and handed in, the way the Stats menu
// is, and the live screen only decides whether it shows. It is handed the
// snapshot's teams and stats roster, which Start and Refresh rosters write,
// and reads tonight's numbers from the stats loop, after paint and at most
// once every 500ms. Nothing here touches a card.
// =============================================================================

const EMPTY_BOARD: TonightBoard = { tallies: new Map(), reached: new Map() };

const NO_ROSTER: readonly KeyedPlayer[] = [];

const BROWSER_TIMERS = {
  now: () => Date.now(),
  setTimeout: (run: () => void, ms: number) => window.setTimeout(run, ms),
  clearTimeout: (handle: unknown) => window.clearTimeout(handle as number),
};

export interface TeamPanelProps {
  /** Each side's name, colour and schedule: the game snapshot's own team objects. */
  home: PanelTeam;
  away: PanelTeam;
  sport: string | null;
  /** Both full rosters with their keys and season numbers (the snapshot's statsRoster). */
  roster: readonly KeyedPlayer[] | undefined;
  /** Tonight's numbers on a game with live stats; null shows the season leaders instead. */
  tonight: TonightSource | null;
}

export const TeamPanel = memo(function TeamPanel({ home: homeTeam, away: awayTeam, sport, roster = NO_ROSTER, tonight }: TeamPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const today = useToday();

  // Each half's height, from the panel's own box: the row count is worked out
  // from it once, and again only if the window itself changes size.
  const [halfPx, setHalfPx] = useState(0);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box) setHalfPx(Math.floor(box.height / 2));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Tonight's numbers: read after paint, at most once every 500ms, whenever
  // live stats says the cards' lines changed.
  const [board, setBoard] = useState<TonightBoard>(EMPTY_BOARD);
  useEffect(() => {
    if (!tonight) return;
    let live = true;
    const throttle = createThrottle(
      () =>
        afterPaint(() => {
          if (live) setBoard(tonight.board());
        }),
      PANEL_THROTTLE_MS,
      BROWSER_TIMERS,
    );
    throttle.poke();
    const stop = tonight.subscribe(() => throttle.poke());
    return () => {
      live = false;
      stop();
      throttle.cancel();
    };
  }, [tonight]);

  // The panel's font, measured once it has loaded.
  const [measure, setMeasure] = useState<PanelMeasure | null>(null);
  useEffect(() => {
    let live = true;
    void loadPanelMeasure().then((loaded) => {
      if (live && loaded) setMeasure(() => loaded);
    });
    return () => {
      live = false;
    };
  }, []);

  const away = useMemo(() => scheduleView(awayTeam.schedule, today), [awayTeam.schedule, today]);
  const home = useMemo(() => scheduleView(homeTeam.schedule, today), [homeTeam.schedule, today]);

  // Every surname, school, opponent and streak line, fitted once per game (and
  // again after Refresh rosters), never while a card goes up.
  const fits = useMemo(
    () =>
      measure
        ? panelFits({ roster, away: { school: awayTeam.name, view: away }, home: { school: homeTeam.name, view: home } }, measure)
        : null,
    [measure, roster, awayTeam.name, homeTeam.name, away, home],
  );

  const looks = useMemo(
    () => sideLooks({ color: homeTeam.color ?? null, school: homeTeam.name }, { color: awayTeam.color ?? null, school: awayTeam.name }),
    [homeTeam.color, homeTeam.name, awayTeam.color, awayTeam.name],
  );

  const leaders = hasLeaders(sport);
  const rows = rowsThatFit(halfPx, { leaders });
  const leadersOf = (side: "home" | "away") =>
    !leaders ? null : tonight ? tonightLeaders(board, roster, side) : seasonLeaders(roster, side);
  const leadersLabel = tonight ? "TONIGHT" : "SEASON LEADERS";

  return (
    <div
      ref={rootRef}
      data-testid="team-panel"
      className={panelFont.className}
      style={{
        height: "100%",
        display: "grid",
        gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
        background: PANEL_COLORS.background,
        color: PANEL_COLORS.ink,
        fontVariantNumeric: "tabular-nums lining-nums",
        lineHeight: 1.2,
        overflow: "hidden",
      }}
    >
      <TeamHalf
        side="away"
        school={awayTeam.name}
        look={looks.A}
        view={away}
        rows={rows}
        leaders={leadersOf("away")}
        leadersLabel={leadersLabel}
        fits={fits?.away ?? null}
        names={fits?.names ?? null}
        opponents={fits?.opponents ?? null}
        advances={fits?.advances ?? null}
        measure={measure}
      />
      <TeamHalf
        side="home"
        school={homeTeam.name}
        look={looks.H}
        view={home}
        rows={rows}
        leaders={leadersOf("home")}
        leadersLabel={leadersLabel}
        fits={fits?.home ?? null}
        names={fits?.names ?? null}
        opponents={fits?.opponents ?? null}
        advances={fits?.advances ?? null}
        measure={measure}
      />
    </div>
  );
});
