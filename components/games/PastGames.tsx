"use client";

import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, LinkButton, TextLink } from "@/components/ui/Button";
import { LocalDate } from "@/components/ui/LocalDate";
import { EmptyState, ErrorRow } from "@/components/ui/Rows";
import { TABLE, TableBox, TD, TD_NUM, TH, TH_NUM, TR } from "@/components/ui/Table";
import { Toolbar } from "@/components/ui/Toolbar";
import { deleteGame, logsInBrowser, matchupOf, type PastGame } from "@/lib/game/pastGames";
import { getGameSnapshot, getServerGameSnapshot, subscribeGameSnapshot } from "@/lib/game/snapshot";
import { downloadGameLog, LOG_STAYS_HERE } from "@/lib/log/download";
import { clearGameLog, countGameLog } from "@/lib/log/gameLog";
import { SPORT_LABELS, isSport } from "@/lib/rosters/types";
import { HeardAsList, heardAsLabel, useHeardAsSuggestions } from "./HeardAsSuggestions";

const DASH = "–";

/** Minutes the mic was open, as a number for the Listened column. */
export function listenedMinutes(micSeconds: number): number {
  return Math.round(Math.max(0, micSeconds) / 60);
}

/** "4/5", or a dash when there is no rating. */
export function ratingText(rating: number | null): string {
  return rating === null ? DASH : `${rating}/5`;
}

function DownloadButton({ gameId }: { gameId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  return (
    <span className="inline-flex items-center gap-2">
      <LinkButton
        disabled={busy}
        title={LOG_STAYS_HERE}
        onClick={async () => {
          setBusy(true);
          setNote(null);
          const result = await downloadGameLog(gameId);
          if (!result.ok) setNote(result.reason === "empty" ? "This log is empty." : "Could not read the log.");
          setBusy(false);
        }}
      >
        Download
      </LinkButton>
      {note && <span className="text-[12px] text-red">{note}</span>}
    </span>
  );
}

/**
 * Delete, asked twice, in place of the row's actions. The game still open in
 * this browser cannot be deleted from here: its row is what End game writes
 * the counts into, so the announcer ends it first.
 */
function DeleteFlow({
  gameId,
  remove,
  onDeleted,
  onAsking,
}: {
  gameId: string;
  remove: (gameId: string) => Promise<boolean>;
  onDeleted: (gameId: string) => void;
  onAsking: (asking: boolean) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const go = (next: 0 | 1 | 2) => {
    setStep(next);
    onAsking(next !== 0);
  };

  useEffect(() => {
    if (step === 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setStep(0);
        onAsking(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, onAsking]);

  if (step === 0) {
    return (
      <LinkButton
        tone="red"
        onClick={() => {
          setNote(null);
          go(1);
        }}
      >
        Delete
      </LinkButton>
    );
  }

  const confirm = async () => {
    setBusy(true);
    const ok = await remove(gameId);
    if (!ok) {
      setNote("Could not delete this game. Check the connection and try again.");
      setBusy(false);
      return;
    }
    // Only once the row is gone, so a failed delete never leaves a listed
    // game without its log. A log that will not clear is no reason to keep the
    // game on the list.
    await clearGameLog(gameId).catch(() => undefined);
    onDeleted(gameId);
  };

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2" role="group">
      <span className="font-semibold text-red">
        {step === 1 ? "Delete this game?" : "Its download goes too. Sure?"}
      </span>
      {step === 1 ? (
        <Button variant="destructive" onClick={() => go(2)}>
          Yes, delete
        </Button>
      ) : (
        <Button variant="destructive" disabled={busy} onClick={() => void confirm()}>
          {busy ? "Deleting..." : "Delete for good"}
        </Button>
      )}
      <Button autoFocus disabled={busy} onClick={() => go(0)}>
        Cancel
      </Button>
      {note && <span className="basis-full text-right text-[12px] text-red">{note}</span>}
    </span>
  );
}

/** Deletes through the browser's own session, so row level security decides whose game it is. */
const deleteFromBrowser = (gameId: string) => deleteGame(gameId);

/**
 * One game's row. `hasLog` is whether this browser still holds its log, which
 * is what puts Download beside it. `open` is whether it is the game still open
 * in this browser, which cannot be deleted from here.
 */
export function GameItem({
  game,
  hasLog,
  open = false,
  onDeleted = () => undefined,
  remove = deleteFromBrowser,
}: {
  game: PastGame;
  hasLog: boolean;
  open?: boolean;
  onDeleted?: (gameId: string) => void;
  remove?: (gameId: string) => Promise<boolean>;
}) {
  const [asking, setAsking] = useState(false);
  // The words Deepgram got wrong, read from this browser's log only when asked.
  const words = useHeardAsSuggestions(game.id);
  const [wordsOpen, setWordsOpen] = useState(false);
  useEffect(() => {
    if (!wordsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWordsOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [wordsOpen]);
  const stat = (value: number) => (game.statsEnabled ? value : DASH);
  return (
    <Fragment>
      <tr className={TR}>
        <td className={`${TD} whitespace-nowrap`}>
          <LocalDate iso={game.startedAt} />
        </td>
        <td className={TD}>
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-medium">{matchupOf(game)}</span>
            {game.endedAt === null && (
              <Badge tone="amber" reason="Not ended, so its counts were never saved.">
                Not ended
              </Badge>
            )}
          </span>
        </td>
        <td className={TD}>{isSport(game.sport) ? SPORT_LABELS[game.sport] : ""}</td>
        <td className={TD_NUM}>{listenedMinutes(game.micSeconds)}</td>
        <td className={TD_NUM}>{game.cardsShown}</td>
        <td className={TD_NUM}>{game.cardsRemoved}</td>
        <td className={TD_NUM}>{stat(game.statPlaysAdded)}</td>
        <td className={TD_NUM}>{stat(game.statPlaysUndone)}</td>
        <td className={TD}>
          {game.statsEnabled ? (
            <span className="font-semibold text-green">On</span>
          ) : (
            <span className="text-muted">Off</span>
          )}
        </td>
        <td className={TD_NUM}>{ratingText(game.rating)}</td>
        <td className={`${TD} whitespace-nowrap text-right`}>
          <span className="inline-flex flex-wrap items-center justify-end gap-3">
            {!asking &&
              (hasLog ? <DownloadButton gameId={game.id} /> : <span className="text-muted">Not in this browser</span>)}
            {!asking && hasLog && words.state.kind !== "none" && (
              <LinkButton
                aria-expanded={wordsOpen}
                onClick={() => {
                  if (words.state.kind === "idle") void words.load();
                  setWordsOpen(!wordsOpen);
                }}
              >
                {heardAsLabel(words.state)}
              </LinkButton>
            )}
            {open ? (
              <span className="text-[12px] text-muted">Open in this browser. End it to delete it.</span>
            ) : (
              <DeleteFlow gameId={game.id} remove={remove} onDeleted={onDeleted} onAsking={setAsking} />
            )}
          </span>
        </td>
      </tr>
      {wordsOpen && hasLog && (
        <tr className="bg-surface-2">
          <td colSpan={11} className="border-b border-line px-3 py-2">
            <HeardAsList suggestions={words} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/**
 * The list. `games` is null when the read failed, which is a different thing
 * from having called none.
 */
export function PastGames({ games }: { games: PastGame[] | null }) {
  // Which games this browser still holds a log for. Unknown until IndexedDB
  // answers, and Download appears only when it says yes.
  const [withLogs, setWithLogs] = useState<Set<string>>(new Set());
  // Deleted on this page since it loaded. The server's list is not read again.
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  // The game still open in this browser, if any, which cannot be deleted.
  const openGame = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);

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

  const shown = (games ?? []).filter((game) => !deleted.has(game.id));

  return (
    <>
      <Toolbar title="Past games">
        {games && <span className="font-num text-[12px] text-muted">{shown.length}</span>}
      </Toolbar>
      <div className="flex flex-col gap-2 p-4">
        {games === null ? (
          <ErrorRow className="px-0" text="Could not load your past games. Check the connection and reload." />
        ) : shown.length === 0 ? (
          <EmptyState className="px-0">
            No games yet. A game is listed here once you start it.{" "}
            <TextLink href="/games/new">Set up a new game</TextLink>
          </EmptyState>
        ) : (
          <>
            <p className="text-muted">Counts only. {LOG_STAYS_HERE}</p>
            <TableBox>
              <table className={TABLE} data-testid="past-games">
                <thead>
                  <tr>
                    <th className={TH}>Date</th>
                    <th className={TH}>Matchup</th>
                    <th className={TH}>Sport</th>
                    <th className={TH_NUM}>Listened</th>
                    <th className={TH_NUM}>Cards shown</th>
                    <th className={TH_NUM}>Cards removed</th>
                    <th className={TH_NUM}>Plays added</th>
                    <th className={TH_NUM}>Plays undone</th>
                    <th className={TH}>Stats</th>
                    <th className={TH_NUM}>Rating</th>
                    <th className={TH}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((game) => (
                    <GameItem
                      key={game.id}
                      game={game}
                      hasLog={withLogs.has(game.id)}
                      open={openGame?.gameId === game.id}
                      onDeleted={(id) => setDeleted((before) => new Set(before).add(id))}
                    />
                  ))}
                </tbody>
              </table>
            </TableBox>
          </>
        )}
      </div>
    </>
  );
}
