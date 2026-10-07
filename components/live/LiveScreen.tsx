"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { NameDisplay, type NameDisplayHandle } from "@/components/NameDisplay";
import { SignOutButton, Wordmark } from "@/components/SiteHeader";
import { useApproved, WaitingNote } from "@/components/auth/Approval";
import { ConnectionStatus } from "@/components/live/ConnectionStatus";
import { DevicePicker } from "@/components/live/DevicePicker";
import { FeedbackCard } from "@/components/live/FeedbackCard";
import { LevelMeter } from "@/components/live/LevelMeter";
import { ListenButton } from "@/components/live/ListenButton";
import { LogPanel } from "@/components/live/LogPanel";
import { MissingKeyBanner } from "@/components/live/MissingKeyBanner";
import { RecentMatches } from "@/components/live/RecentMatches";
import { RefreshRosters } from "@/components/live/RefreshRosters";
import { ScreenAwake } from "@/components/live/ScreenAwake";
import { applyResult, EMPTY_TRANSCRIPT, TranscriptLine } from "@/components/live/TranscriptLine";
import { setGameId, track } from "@/lib/analytics/track";
import { afterPaint } from "@/lib/afterPaint";
import { useMicrophone } from "@/lib/audio/useMicrophone";
import { useWakeLock } from "@/lib/audio/useWakeLock";
import type { DeepgramResults } from "@/lib/deepgram/config";
import { useDeepgramStream } from "@/lib/deepgram/useDeepgramStream";
import { endGame } from "@/lib/game/calledGames";
import {
  countMicStretch,
  countReconnect,
  countRefresh,
  countRemoval,
  countResult,
  EMPTY_COUNTS,
  readLiveCounts,
  writeLiveCounts,
  type LiveCounts,
} from "@/lib/game/liveCounts";
import { cardRemovedProps } from "@/lib/game/liveEvents";
import {
  gameTitle,
  getGameSnapshot,
  getServerGameSnapshot,
  readGameSnapshot,
  subscribeGameSnapshot,
} from "@/lib/game/snapshot";
import { INITIAL_KEY_STATE, isTextEntry, reduceLiveKey, type RemovalKey } from "@/lib/keys";
import { logWriter } from "@/lib/log/gameLog";
import { gameRecord, resultRecord } from "@/lib/log/records";
import type { LogRow } from "@/lib/matching/matchLog";
import type { NumberContext } from "@/lib/matching/numbers";
import { MAX_NAMES_ON_SCREEN, SpotterEngine, type RecentMatch } from "@/lib/matching/SpotterEngine";
import { isSport } from "@/lib/rosters/types";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";

const RECENT_MATCH_COUNT = 3;

/** How long "Removed LANGAN" stays up. Long enough to be read mid-play, short enough to be gone by the next one. */
const FLASH_MS = 2000;

// Stable references so the engine and the stream are not rebuilt every render.
const NO_WATCHLIST: WatchlistEntry[] = [];
const NO_KEYTERMS: string[] = [];
const NO_MATCHES: RecentMatch[] = [];
const NO_NUMBERS: NumberContext = { sport: null, teamCues: [] };
const NO_PLAYERS: WatchlistPlayer[] = [];

function roundMs(ms: number | null) {
  return ms === null ? null : Math.round(ms * 10) / 10;
}

/**
 * What just came off the screen, said loudly for about two seconds.
 *
 * Taking a card down puts back whatever it pushed off, so the screen barely
 * changes and the correction can look like nothing happened. This is the part
 * that says it landed.
 *
 * PRIVACY: the surname is on screen and nowhere else. It is not in the event
 * that goes with it, and never will be.
 */
function RemovedFlash({ name }: { name: string }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
      <p className="max-w-full truncate rounded-lg bg-black px-8 py-3 text-4xl font-black tracking-wider text-white shadow-lg">
        Removed <span className="uppercase">{name}</span>
      </p>
    </div>
  );
}

/** The keys, learnable from the screen. Each card also carries its digit in the corner. */
function WrongCardKeys() {
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Wrong card</span>
      <p className="h-5 text-sm text-neutral-500">
        <kbd className="font-mono font-bold text-neutral-700">X</kbd> takes the newest down ·{" "}
        <kbd className="font-mono font-bold text-neutral-700">1</kbd>-
        <kbd className="font-mono font-bold text-neutral-700">{MAX_NAMES_ON_SCREEN}</kbd> take that card down
      </p>
    </div>
  );
}

export function LiveScreen({ hasApiKey }: { hasApiKey: boolean }) {
  const router = useRouter();
  const approved = useApproved();
  const mic = useMicrophone();
  const [transcript, setTranscript] = useState(EMPTY_TRANSCRIPT);
  // Matches are tagged with the watchlist they came from, so a refresh clears
  // the list by derivation rather than by resetting state in an effect.
  const [matchState, setMatchState] = useState<{ source: WatchlistEntry[]; matches: RecentMatch[] }>({
    source: NO_WATCHLIST,
    matches: NO_MATCHES,
  });
  // What was last taken down, for the flash over the cards. Cleared on a timer.
  const [flash, setFlash] = useState<{ name: string; at: number } | null>(null);
  const keyStateRef = useRef(INITIAL_KEY_STATE);
  // How the game went, for called_games and game.ended. A ref, not state:
  // nothing on screen depends on it until the game ends.
  const countsRef = useRef<LiveCounts>(EMPTY_COUNTS);
  const countsGameRef = useRef<string | null>(null);
  const micOnSinceRef = useRef<number | null>(null);
  const reconnectingRef = useRef(false);
  // When each roster slot last went up, for "seconds since shown" on a removal.
  const shownAtRef = useRef(new Map<string, number>());
  // Set while End game is navigating away, so clearing the game does not
  // bounce through the menu, or count anything, on the way out.
  const endingRef = useRef(false);
  const [ending, setEnding] = useState(false);
  // Set once End game has written the counts and the game is cleared: the
  // feedback card takes the screen until it is saved or skipped.
  const [finished, setFinished] = useState<{ gameId: string; title: string } | null>(null);
  const nameDisplayRef = useRef<NameDisplayHandle>(null);
  // What was last handed to show(), so a removal can say how many cards were up.
  const lastShownRef = useRef<WatchlistPlayer[]>(NO_PLAYERS);
  const engineRef = useRef<SpotterEngine | null>(null);
  // Which watchlist the current engine was built from, so a refresh rebuilds it.
  const engineWatchlistRef = useRef<WatchlistEntry[] | null>(null);

  // The game lives in localStorage, which React cannot see. Reading it through
  // a store means the server renders "no game" and the browser swaps in the
  // real one on the first paint, with no hydration mismatch.
  const game = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);

  const watchlist = game ? game.watchlist : NO_WATCHLIST;
  const keyterms = game ? game.keyterms : NO_KEYTERMS;
  const gameId = game?.gameId ?? null;
  const recentMatches = matchState.source === watchlist ? matchState.matches : NO_MATCHES;

  // When the game was built, so an utterance can say how far into it a thing
  // was said. Deepgram's own clock restarts at zero on every socket.
  const builtAtMs = useMemo(() => {
    if (!game) return null;
    const parsed = Date.parse(game.builtAt);
    return Number.isFinite(parsed) ? parsed : null;
  }, [game]);

  // What a number means in this game: the sport's vetoes and the words that
  // name each side. Built once per game, so the hot path only reads it.
  const numbers: NumberContext = useMemo(() => {
    if (!game) return NO_NUMBERS;
    return { sport: isSport(game.sport) ? game.sport : null, teamCues: game.teamCues };
  }, [game]);

  /** Updates the counts and mirrors them, so a reload mid-game keeps them. Never in the hot path. */
  const bump = (update: (counts: LiveCounts) => LiveCounts) => {
    if (endingRef.current || gameId === null) return;
    countsRef.current = update(countsRef.current);
    writeLiveCounts(gameId, countsRef.current);
  };

  /**
   * Every write to the cards goes through here, so the players last put up are
   * always known. HOT PATH on one of its callers: one ref assignment and one
   * call, passing an array the engine already made.
   */
  const showPlayers = (players: WatchlistPlayer[]) => {
    lastShownRef.current = players;
    nameDisplayRef.current?.show(players);
  };

  // A game opened, or reopened after a reload: pick up the counts it had.
  useEffect(() => {
    if (gameId === null || countsGameRef.current === gameId) return;
    countsGameRef.current = gameId;
    countsRef.current = readLiveCounts(gameId);
    // Every event from here on belongs to this game.
    setGameId(gameId);
    return () => setGameId(null);
  }, [gameId]);

  // A new watchlist (the game opening, or Refresh rosters) means nothing on
  // screen from the old one, and a new engine. The engine is also rebuilt in
  // the hot path if a result gets there first; whichever runs first wins and
  // the other sees it is already current.
  useEffect(() => {
    if (!game) return;
    if (engineWatchlistRef.current !== watchlist) {
      engineRef.current = new SpotterEngine(watchlist, numbers);
      engineWatchlistRef.current = watchlist;
    }
    shownAtRef.current = new Map();
    showPlayers(NO_PLAYERS);
    // The log says which rosters every result after this was matched against.
    logWriter().push(gameRecord(game, Date.now()));
    // showPlayers only writes a ref and the DOM, so it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist, numbers]);

  // The live screen exists to call a game. With none saved in this browser
  // there is nothing to listen for, so go back to the menu rather than sit on
  // an empty screen. Storage is read directly: the first render on the client
  // still carries the server's "no game", and that must not trigger a bounce.
  useEffect(() => {
    if (endingRef.current) return;
    if (readGameSnapshot() === null) router.replace("/");
  }, [game, router]);

  /**
   * The announcer says a card up is wrong: take it down and log it.
   *
   * `slot` counts from the top of the screen, so 0 is the newest. Outside the
   * hot path, on a key press. The row it writes is the only record of a false
   * match that Spotter did not decide for itself.
   */
  const takeDown = (slot: number, key: RemovalKey) => {
    const engine = engineRef.current;
    if (!engine || gameId === null) return;
    const onScreen = lastShownRef.current.length;
    const outcome = engine.markSlotWrong(slot);
    if (outcome.rows.length === 0) return;
    if (outcome.display) showPlayers(outcome.display.players);
    setMatchState({ source: watchlist, matches: engine.recentMatches(RECENT_MATCH_COUNT) });
    // Names the card that came off, because the screen alone barely changes:
    // whatever the wrong card pushed off comes straight back up.
    if (outcome.removed) setFlash({ name: outcome.removed, at: Date.now() });

    afterPaint(() => {
      const log = logWriter();
      for (const row of outcome.rows) log.push({ kind: "row", gameId, at: Date.parse(row.at), row });
      bump((counts) => countRemoval(counts, key));
      if (!outcome.wrong) return;
      // The shape of the mistake goes to analytics. The surname, the number and
      // the words that scored stay in the row above, which never leaves this browser.
      const wrongRow = outcome.rows.find((row) => row.type === "wrong");
      const shownTimes = (wrongRow?.slots ?? [])
        .map((slotKey) => shownAtRef.current.get(slotKey))
        .filter((at): at is number => at !== undefined);
      const since = shownTimes.length > 0 ? (Date.now() - Math.max(...shownTimes)) / 1000 : null;
      track("names.card_removed", cardRemovedProps(outcome.wrong, key, onScreen, since));
    });
  };

  // The flash takes itself down. Keyed on the object rather than the name, so
  // the same card removed twice restarts the two seconds.
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  /**
   * Everything a result leads to that is not the card itself: the browser log,
   * the counts, the lists on screen. Runs after paint, never in handleResults.
   */
  const afterResult = (
    results: DeepgramResults,
    arrivedAt: number,
    connectionId: number,
    rows: LogRow[],
    latencyMs: number | null,
    domMs: number | null,
  ) => {
    if (gameId === null) return;
    const log = logWriter();
    // Every result, interims included: a replay needs exactly what the engine saw.
    log.push(resultRecord(gameId, results, arrivedAt, connectionId));
    const text = results.channel.alternatives[0]?.transcript ?? "";
    // Interims are rewritten by the next one; only a final is something said.
    if (results.is_final && text.length > 0) {
      log.push({
        kind: "utterance",
        gameId,
        at: arrivedAt,
        connectionId,
        text,
        offsetMs: builtAtMs === null ? 0 : Math.max(0, arrivedAt - builtAtMs),
      });
    }
    if (rows.length > 0) {
      for (const row of rows) {
        const logged: LogRow =
          row.type === "match" ? { ...row, gameId, latencyMs: roundMs(latencyMs), domMs: roundMs(domMs) } : { ...row, gameId };
        log.push({ kind: "row", gameId, at: Date.parse(row.at), row: logged });
        if (row.type === "match") for (const slot of row.slots ?? []) shownAtRef.current.set(slot, arrivedAt);
      }
      bump((counts) => countResult(counts, rows, latencyMs));
    }
    setTranscript((previous) => applyResult(previous, text, results.is_final));
  };

  // HOT PATH. Called synchronously from the socket's message handler with the
  // time the result arrived. Matching is synchronous and the card is written
  // straight into the DOM. The log, the counts and React state wait until after
  // paint. No await, no fetch, no storage, no Supabase: see
  // test/cardPathIsolation.test.ts.
  const handleResults = (results: DeepgramResults, receivedAt: number, connectionId: number) => {
    const arrivedAt = Date.now();
    if (engineWatchlistRef.current !== watchlist) {
      engineRef.current = new SpotterEngine(watchlist, numbers);
      engineWatchlistRef.current = watchlist;
    }
    const engine = engineRef.current!;
    const outcome = engine.process(results, connectionId);

    let domMs: number | null = null;
    if (outcome.display) {
      // The engine hands over the cards themselves: every one of them has been
      // sitting in memory since the game was built.
      showPlayers(outcome.display.players);
      domMs = performance.now() - receivedAt;
    }

    afterPaint((paintedAt) => {
      // null when the page was hidden: nothing was painted, so there is no paint latency.
      const latencyMs = outcome.display && paintedAt !== null ? paintedAt - receivedAt : null;
      afterResult(results, arrivedAt, connectionId, outcome.rows, latencyMs, domMs);
      if (outcome.rows.length > 0) {
        setMatchState({ source: watchlist, matches: engine.recentMatches(RECENT_MATCH_COUNT) });
        // A new card on screen is a new thing to be right or wrong about, and
        // the last correction is no longer what the screen is about.
        if (outcome.display) setFlash(null);
      }
    });
  };

  const connection = useDeepgramStream({
    graph: mic.graph,
    // An account waiting for approval never opens the socket. The token route
    // would refuse it anyway, but DeepgramStream retries refusals it does not
    // know are final, so the screen has to be the one that says no.
    enabled: hasApiKey && approved,
    keyterms,
    onResults: handleResults,
  });

  const micOn = mic.status === "on";

  // X, 1, 2 and 3. No dependency array on purpose: the handler closes over the
  // current engine and watchlist, and swapping one listener per render costs
  // nothing next to a stale one taking the wrong card down.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // The game is over: the digits belong to the feedback card, and there is no card to take down.
      if (endingRef.current) return;
      const { state, action, handled } = reduceLiveKey(keyStateRef.current, {
        key: event.key,
        repeat: event.repeat,
        modifier: event.metaKey || event.ctrlKey || event.altKey,
        textEntry: isTextEntry(event.target),
        now: Date.now(),
      });
      keyStateRef.current = state;
      if (!handled) return;
      event.preventDefault();
      if (action.type === "removeCard") takeDown(action.slot, action.key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // The laptop dozing mid-game cuts the mic, so the screen is held awake for
  // as long as the mic is open. Nowhere near the hot path.
  const wakeLock = useWakeLock(micOn);

  // How long the mic was actually open, across every start, stop and
  // reconnect. Counted on the status changing rather than on a timer.
  useEffect(() => {
    if (endingRef.current) return;
    if (micOn) {
      if (micOnSinceRef.current !== null) return;
      micOnSinceRef.current = Date.now();
      const soFar = countsRef.current.micSeconds;
      afterPaint(() => track("game.mic_started", { seconds: soFar }));
      return;
    }
    const since = micOnSinceRef.current;
    micOnSinceRef.current = null;
    if (since === null) return;
    const stretch = Math.round((Date.now() - since) / 1000);
    bump((counts) => countMicStretch(counts, stretch));
    const total = countsRef.current.micSeconds;
    afterPaint(() => track("game.mic_stopped", { seconds: stretch, total_seconds: total }));
    // bump reads the current game through its closure and changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micOn]);

  // Every drop into reconnecting is one reconnect. The socket can sit in that
  // state across several attempts, so only the transition into it counts.
  useEffect(() => {
    const reconnecting = connection.status === "reconnecting";
    if (reconnecting && !reconnectingRef.current) bump(countReconnect);
    reconnectingRef.current = reconnecting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.status]);

  const onRefreshed = (changes: number) => {
    bump(countRefresh);
    afterPaint(() => track("names.roster_refreshed", { changes }));
  };

  /**
   * The game is over: stop the mic, write the counts, keep the log, and go back
   * to the menu. Outside the hot path in every sense, on a confirmed click.
   */
  const finishGame = async () => {
    if (!game) return;
    if (!window.confirm("End this game? The counts are saved and the live screen clears. The log stays in this browser.")) {
      return;
    }
    setEnding(true);
    endingRef.current = true;
    if (micOn) mic.toggle();

    const open = micOnSinceRef.current;
    micOnSinceRef.current = null;
    const final = open === null ? countsRef.current : countMicStretch(countsRef.current, (Date.now() - open) / 1000);
    await logWriter().flush();
    await endGame(game, final);
    // The feedback goes on the game's row, so a game whose row never wrote has nothing to attach it to.
    if (game.recorded) setFinished({ gameId: game.gameId, title: gameTitle(game) });
    else router.replace("/");
  };

  const toggleListening = () => {
    setTranscript(EMPTY_TRANSCRIPT);
    mic.toggle();
  };

  const transcriptionDown =
    hasApiKey && micOn && (connection.status === "reconnecting" || connection.status === "failed");

  const nameCount = watchlist.length;

  const placeholder = !hasApiKey
    ? "Name spotting is off until the API key is added"
    : !approved
      ? "Listening starts once your account is approved"
      : micOn
        ? `Listening for ${nameCount} ${nameCount === 1 ? "name" : "names"}`
        : "Start listening to spot names";

  // The game is over and its counts are written. Before the menu, one card.
  if (finished) {
    return <FeedbackCard gameId={finished.gameId} title={finished.title} onDone={() => router.replace("/")} />;
  }

  // Every hook above runs either way, so this return is safe. It shows for one
  // frame on a reload, while the effect above reads storage and redirects.
  if (game === null) {
    return (
      <div className="flex h-dvh flex-col bg-white text-black">
        <header className="flex items-center border-b border-neutral-200 px-6 py-4">
          <Wordmark />
        </header>
        <main className="flex min-h-0 flex-1 items-center justify-center px-6">
          <p className="text-2xl font-black text-neutral-400">Loading the game...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-white text-black">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-neutral-200 px-6 py-4">
        <Wordmark />
        <div className="flex flex-col gap-1">
          <ListenButton status={mic.status} disabled={!hasApiKey || !approved} onToggle={toggleListening} />
          <WaitingNote />
        </div>
        <DevicePicker
          devices={mic.devices}
          labelsHidden={mic.labelsHidden}
          value={mic.deviceId}
          activeLabel={mic.activeLabel}
          onChange={mic.selectDevice}
        />
        <LevelMeter analyser={mic.graph?.analyser ?? null} />
        <ConnectionStatus state={connection} micOn={micOn} hasApiKey={hasApiKey} />
        <div className="flex min-w-0 shrink-0 flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Game</span>
          <span className="h-5 max-w-64 truncate text-sm font-black tracking-wider">{gameTitle(game)}</span>
        </div>
        <RefreshRosters game={game} onRefreshed={onRefreshed} />
        <div className="flex shrink-0 flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">This game</span>
          <div className="flex h-5 items-center">
            <button
              type="button"
              disabled={ending}
              onClick={(event) => {
                event.currentTarget.blur();
                void finishGame();
              }}
              className="cursor-pointer rounded border border-neutral-300 px-2 py-0.5 text-sm font-semibold text-neutral-800 hover:border-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400"
            >
              {ending ? "Ending..." : "End game"}
            </button>
          </div>
          <p className="h-4 max-w-64 truncate text-xs text-neutral-500">
            {game.recorded ? "Saves the counts and goes to the menu" : "Clears the screen"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-5 text-sm">
          <Link href="/games" className="text-neutral-500 hover:text-neutral-700">
            Past games
          </Link>
          <Link href="/" className="text-neutral-500 hover:text-neutral-700">
            Menu
          </Link>
          <SignOutButton />
        </div>
      </header>

      {!hasApiKey && <MissingKeyBanner />}

      {transcriptionDown && (
        <div
          role="alert"
          className="flex items-center justify-center gap-4 bg-red-600 px-6 py-3 text-center text-2xl font-black text-white"
        >
          <span className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-white" />
          {connection.status === "failed"
            ? `TRANSCRIPTION FAILED: ${connection.reason}`
            : `TRANSCRIPTION DOWN · RECONNECTING (attempt ${connection.attempt})`}
        </div>
      )}

      {mic.error && (
        <div role="alert" className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-lg font-semibold text-amber-700">
          {mic.error}
        </div>
      )}

      <main className="relative min-h-0 flex-1 px-6">
        <NameDisplay ref={nameDisplayRef} dimmed={!micOn} placeholder={placeholder} />
        {flash && <RemovedFlash name={flash.name} />}
      </main>

      <footer className="flex flex-wrap items-end gap-x-10 gap-y-3 border-t border-neutral-200 px-6 py-3">
        <RecentMatches matches={recentMatches} />
        <TranscriptLine transcript={transcript} />
        <WrongCardKeys />
        <ScreenAwake state={wakeLock} />
        {!game.recorded && (
          <div className="flex shrink-0 flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Past games</span>
            <p className="h-5 text-sm font-semibold text-amber-700">This game&apos;s counts are not being saved</p>
          </div>
        )}
        <LogPanel gameId={game.gameId} />
      </footer>
    </div>
  );
}
