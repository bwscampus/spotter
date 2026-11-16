"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorRow } from "@/components/ui/Rows";
import { api } from "@/lib/apiClient";
import { gameDay } from "@/lib/game/drafts";
import { confirmEndingOpenGame, startBoothGame } from "@/lib/game/startGame";
import { useToday } from "@/lib/ui/useToday";

// =============================================================================
// Booth partners (Nov 15): a game this announcer joined, as his guest page.
// The teams, rosters, pronunciations and facts are the host's, read live; he
// changes nothing here. Start opens the live screen on his own mic and his
// own account's allowance; the game counts once, against the host.
// =============================================================================

export interface BoothDraftGame {
  gameId: string;
  guestGameId: string;
  hostLabel: string;
  gameDate: string | null;
  homeId: string | null;
  awayId: string | null;
  homeSchool: string | null;
  awaySchool: string | null;
  hostStatus: "draft" | "live";
  guestStatus: "draft" | "live" | "ended";
  share: boolean;
}

export function BoothDraft({ game, autoStart }: { game: BoothDraftGame; autoStart: boolean }) {
  const router = useRouter();
  const today = useToday();
  const [busy, setBusy] = useState<"start" | "leave" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const ready = Boolean(game.awaySchool && game.homeSchool);

  const start = async () => {
    if (!confirmEndingOpenGame()) return;
    setBusy("start");
    setError(null);
    const result = await startBoothGame(
      { gameId: game.gameId, homeId: game.homeId, awayId: game.awayId, share: game.share, gameDate: game.gameDate },
      "setup",
      today ?? "",
    );
    if (!result.ok) {
      setBusy(null);
      setError(result.error);
      return;
    }
    router.push("/live");
  };

  // Joined while the host's game is under way: straight to the live screen.
  useEffect(() => {
    if (!autoStart || !ready || started.current || today === null) return;
    started.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, ready, today]);

  const leave = async () => {
    if (!window.confirm("Leave this game? It comes off your games. You can join again with the code or the link.")) return;
    setBusy("leave");
    const result = await api("DELETE", `/api/drafts/${encodeURIComponent(game.guestGameId)}`);
    if (!result.ok) {
      setBusy(null);
      setError("Could not leave just now. Try again.");
      return;
    }
    router.replace("/games");
    router.refresh();
  };

  const matchup = `${game.awaySchool ?? "?"} at ${game.homeSchool ?? "?"}`;
  return (
    <div className="flex flex-col gap-4" data-testid="booth-draft">
      <div>
        <p className="text-[14px] font-semibold uppercase tracking-[0.04em] text-ink-2">Hosted by {game.hostLabel}</p>
        <h2 className="text-[22px] font-semibold">{matchup}</h2>
        {game.gameDate && <p className="text-ink-2">{gameDay(game.gameDate)}</p>}
      </div>
      <p className="text-ink-2">
        {!ready
          ? "Waiting for the host to pick both teams."
          : game.hostStatus === "live"
            ? "The game is under way. Start puts you in it."
            : "Ready. Either of you can start; your own mic and Listen button are yours."}
      </p>
      <p className="text-[14px] text-muted">
        The rosters, stats, pronunciations and facts are the host&apos;s. Cards from either mic show on both screens.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!ready || busy !== null || today === null} onClick={() => void start()}>
          {busy === "start" ? "Starting..." : game.hostStatus === "live" ? "Join the live game" : "Start"}
        </Button>
        {game.guestStatus === "draft" && (
          <Button variant="outlined" disabled={busy !== null} onClick={() => void leave()}>
            {busy === "leave" ? "Leaving..." : "Leave"}
          </Button>
        )}
      </div>
      {error && <ErrorRow className="px-0" text={error} />}
    </div>
  );
}
