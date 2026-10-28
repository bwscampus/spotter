"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, ButtonLink, TextLink } from "@/components/ui/Button";
import { LocalDate } from "@/components/ui/LocalDate";
import { Panel, PanelRow } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/Rows";
import { endGame } from "@/lib/game/calledGames";
import { getGameSnapshot, getServerGameSnapshot, subscribeGameSnapshot } from "@/lib/game/snapshot";
import { runningLabel } from "@/lib/ui/format";

/**
 * The game still open in this browser, if there is one, with the way back to
 * it. A game stays open until End game, so leaving the live screen for the
 * menu or the teams loses nothing.
 *
 * `startedAt` is the game's called_games start, by game id, from the server:
 * the snapshot's own build time moves on every Refresh rosters, so it cannot
 * say when the game started. A game whose row never wrote has no start shown.
 */
export function CurrentGame({ startedAt = {} }: { startedAt?: Record<string, string> }) {
  const game = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);
  const [now, setNow] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!game) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [game]);

  if (!game) {
    return (
      <Panel heading="Game in progress">
        <EmptyState>
          No game open in this browser. <TextLink href="/games/new">Set up a game</TextLink>
        </EmptyState>
      </Panel>
    );
  }

  const started = startedAt[game.gameId] ?? null;
  const startedMs = started ? new Date(started).getTime() : NaN;

  // The same end as starting another game from setup: the counts this
  // browser mirrored are written, and the game clears. The log stays.
  const end = async () => {
    if (!window.confirm("End this game? The counts are saved and the game clears. The log stays in this browser; a copy with last names kept and first names and schools taken out is sent if sharing is on.")) return;
    setEnding(true);
    await endGame(game);
    setEnding(false);
  };

  return (
    <Panel heading="Game in progress">
      <PanelRow label={<span className="font-semibold text-ink">{game.away.name}</span>} />
      <PanelRow label={<span className="font-semibold text-ink">{game.home.name}</span>} />
      {started && (
        <PanelRow label="Started">
          <LocalDate iso={started} />
        </PanelRow>
      )}
      {started && now !== null && Number.isFinite(startedMs) && (
        <PanelRow label="Running">
          <span className="font-num text-[12px]">{runningLabel(now - startedMs)}</span>
        </PanelRow>
      )}
      <PanelRow label="Live stats">{game.statsEnabled ? <span className="font-semibold text-green">On</span> : <span className="text-muted">Off</span>}</PanelRow>
      <div className="flex gap-2 px-3 py-2">
        <ButtonLink href="/live">Resume</ButtonLink>
        <Button disabled={ending} onClick={() => void end()}>
          {ending ? "Ending..." : "End"}
        </Button>
      </div>
    </Panel>
  );
}
