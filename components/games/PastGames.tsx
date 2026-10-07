"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LOG_STAYS_HERE } from "@/components/live/LogPanel";
import { logsInBrowser, matchupOf, minutesListened, type PastGame } from "@/lib/game/pastGames";
import { downloadGameLog } from "@/lib/log/download";
import { countGameLog } from "@/lib/log/gameLog";
import { SPORT_LABELS, isSport } from "@/lib/rosters/types";

const LABEL = "text-[11px] font-semibold uppercase tracking-widest text-neutral-500";

/** "Fri, Sep 25, 7:03 PM", in the announcer's own time zone, which the server cannot know. */
function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className={LABEL}>{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function DownloadButton({ gameId }: { gameId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          const result = await downloadGameLog(gameId);
          if (!result.ok) setNote(result.reason === "empty" ? "This log is empty." : "Could not read the log.");
          setBusy(false);
        }}
        title={LOG_STAYS_HERE}
        className="cursor-pointer rounded border border-neutral-300 px-2 py-0.5 text-sm font-semibold text-neutral-800 hover:border-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400"
      >
        Download
      </button>
      {note && <p className="text-xs text-amber-700">{note}</p>}
    </div>
  );
}

/** One game. `hasLog` is whether this browser still holds its log, which is what puts Download beside it. */
export function GameItem({ game, hasLog }: { game: PastGame; hasLog: boolean }) {
  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-lg font-black">{matchupOf(game)}</span>
        <span className="text-sm text-neutral-500" suppressHydrationWarning>
          {when(game.startedAt)}
        </span>
        {isSport(game.sport) && <span className="text-sm text-neutral-500">{SPORT_LABELS[game.sport]}</span>}
        {game.endedAt === null && (
          <span className="text-sm font-semibold text-amber-700">Not ended, so its counts were never saved</span>
        )}
        {hasLog && (
          <span className="ml-auto">
            <DownloadButton gameId={game.id} />
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-2">
        <Stat label="Listened" value={minutesListened(game.micSeconds)} />
        <Stat label="Cards shown" value={game.cardsShown} />
        <Stat label="Cards removed" value={game.cardsRemoved} />
        <Stat label="Stat plays added" value={game.statPlaysAdded} />
        <Stat label="Stat plays undone" value={game.statPlaysUndone} />
        <Stat label="Stats" value={game.statsEnabled ? "On" : "Off"} />
        <Stat label="Your rating" value={game.rating === null ? "None" : `${game.rating} of 5`} />
      </div>
    </li>
  );
}

/**
 * The list. `games` is null when the read failed, which is a different thing
 * from having called none.
 */
export function PastGames({ games }: { games: PastGame[] | null }) {
  // Which games this browser still holds a log for. Unknown until IndexedDB
  // answers, and the Download button appears only when it says yes.
  const [withLogs, setWithLogs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!games || games.length === 0) return;
    let cancelled = false;
    void logsInBrowser(
      games.map((game) => game.id),
      countGameLog,
    ).then((found) => {
      if (!cancelled) setWithLogs(found);
    });
    return () => {
      cancelled = true;
    };
  }, [games]);

  if (games === null) {
    return (
      <p role="alert" className="text-sm font-semibold text-amber-700">
        Could not load your past games. Check the connection and reload.
      </p>
    );
  }

  if (games.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No games yet. A game is listed here once you start it.{" "}
        <Link href="/games/new" className="font-semibold underline">
          Start one
        </Link>
      </p>
    );
  }

  return (
    <>
      <p className="text-sm text-neutral-500">Counts only. {LOG_STAYS_HERE}</p>
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200" data-testid="past-games">
        {games.map((game) => (
          <GameItem key={game.id} game={game} hasLog={withLogs.has(game.id)} />
        ))}
      </ul>
    </>
  );
}
