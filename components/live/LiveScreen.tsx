"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { NameDisplay, type CardStatLines, type NameDisplayHandle, type SideLooks } from "@/components/NameDisplay";
import { SignOutButton, Wordmark } from "@/components/SiteHeader";
import { ConnectionStatus } from "@/components/live/ConnectionStatus";
import { DevicePicker } from "@/components/live/DevicePicker";
import { FeedbackCard } from "@/components/live/FeedbackCard";
import { LevelMeter } from "@/components/live/LevelMeter";
import { ListenButton } from "@/components/live/ListenButton";
import { BarMenu } from "@/components/live/BarMenu";
import { BrowserCheck } from "@/components/live/BrowserCheck";
import { MicSource } from "@/components/live/MicSource";
import { MissingKeyBanner } from "@/components/live/MissingKeyBanner";
import { RefreshRosters } from "@/components/live/RefreshRosters";
import { ScreenAwake } from "@/components/live/ScreenAwake";
import { applyResult, EMPTY_TRANSCRIPT, TranscriptLine } from "@/components/live/TranscriptLine";
import { setGameId, track } from "@/lib/analytics/track";
import { afterPaint } from "@/lib/afterPaint";
import { useMicrophone } from "@/lib/audio/useMicrophone";
import { QuietWatch, TOO_QUIET_DB } from "@/lib/audio/quietWatch";
import { useWakeLock } from "@/lib/audio/useWakeLock";
import { ALARM_WORDS, ConnectionWatch, type Alarm } from "@/lib/game/connectionWatch";
import { IDLE_WORDS, IdleWatch, type IdleReason } from "@/lib/game/idleWatch";
import { playAlarmTone } from "@/lib/game/tone";
import { getHidden, getServerHidden, subscribeVisibility } from "@/lib/game/visibility";
import type { DeepgramResults } from "@/lib/deepgram/config";
import { useDeepgramStream, type AudioLevel } from "@/lib/deepgram/useDeepgramStream";
import { endGame } from "@/lib/game/calledGames";
import { sideLooks, splitBackground } from "@/lib/game/colors";
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
import { linesForCards, playersByKey } from "@/lib/game/statLines";
import type { LiveStatsBridge } from "@/lib/game/statsBridge";
import {
  gameTitle,
  getGameSnapshot,
  getServerGameSnapshot,
  readGameSnapshot,
  subscribeGameSnapshot,
} from "@/lib/game/snapshot";
import { INITIAL_KEY_STATE, isTextEntry, reduceLiveKey, type RemovalKey } from "@/lib/keys";
import { speechFailureMessage } from "@/lib/messages";
import { logWriter } from "@/lib/log/gameLog";
import { LOG_SHARED_NOTE, setShareChoice, shareChoice } from "@/lib/log/shareLog";
import { Switch } from "@/components/ui/Switch";
import { gameRecord, resultRecord } from "@/lib/log/records";
import type { LogRow } from "@/lib/matching/matchLog";
import type { NumberContext } from "@/lib/matching/numbers";
import { MAX_NAMES_ON_SCREEN, SpotterEngine } from "@/lib/matching/SpotterEngine";
import { isSport } from "@/lib/rosters/types";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";

/** How long "Removed LANGAN" stays up. Long enough to be read mid-play, short enough to be gone by the next one. */
const FLASH_MS = 2000;
/** How often the silence alarm looks, while a game is open. */
const WATCH_TICK_MS = 1000;

// Stable references so the engine and the stream are not rebuilt every render.
const NO_WATCHLIST: WatchlistEntry[] = [];
const NO_KEYTERMS: string[] = [];
const NO_NUMBERS: NumberContext = { sport: null, teamCues: [] };
const NO_PLAYERS: WatchlistPlayer[] = [];
const NO_LINES: CardStatLines = new Map();

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

/**
 * Share a scrubbed copy of this game's log when it ends (lib/log/shareLog.ts):
 * the choice made at setup, changeable until End game. It lives in this
 * browser's storage.
 */
function ShareToggle({ gameId }: { gameId: string }) {
  // Only mounted when the ⋯ menu is opened, so it is always on the client.
  const [on, setOn] = useState(() => shareChoice(gameId));
  return (
    <div className="flex max-w-80 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Share game log</span>
      <Switch
        checked={on}
        onChange={(next) => {
          setShareChoice(gameId, next);
          setOn(next);
        }}
        label="Share a copy of this game's log, last names kept"
      />
      <p className="text-xs text-neutral-500">{on ? LOG_SHARED_NOTE : "Nothing is sent. The log stays in this browser."}</p>
    </div>
  );
}

/** The keys, learnable from the menu. */
function WrongCardKeys() {
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Wrong card</span>
      <p className="text-sm text-neutral-500">
        <kbd className="font-mono font-bold text-neutral-700">X</kbd> or <kbd className="font-mono font-bold text-neutral-700">1</kbd>{" "}
        takes the big card down · <kbd className="font-mono font-bold text-neutral-700">2</kbd>-
        <kbd className="font-mono font-bold text-neutral-700">{MAX_NAMES_ON_SCREEN}</kbd> take down the first or second small one
      </p>
    </div>
  );
}

/**
 * The live screen. `stats`, `statsMenu` and `statsLatest` are live stats, put
 * together outside the card path (components/livestats/) and handed in: this
 * file never imports lib/livestats/ (docs/V3_DEFINITION.md G3). Without them
 * it is the names-only screen.
 *
 * Laid out as Jed set it on Oct 3: every control in one thin bar at the top,
 * the cards' stage under it, and one bar at the bottom with the raw
 * transcript on the left and the latest stat on the right.
 */
export function LiveScreen({
  hasApiKey,
  stats,
  statsMenu,
  statsLatest,
}: {
  hasApiKey: boolean;
  stats?: LiveStatsBridge;
  /** The stats button for the top bar, with everything live stats has behind it. */
  statsMenu?: ReactNode;
  /** The latest stat update, for the right of the bottom bar. */
  statsLatest?: ReactNode;
}) {
  const router = useRouter();
  const mic = useMicrophone();
  const [transcript, setTranscript] = useState(EMPTY_TRANSCRIPT);
  // What was last taken down, for the flash over the cards. Cleared on a timer.
  const [flash, setFlash] = useState<{ name: string; at: number } | null>(null);
  // How loud the sound reaching Deepgram is, once a second from the worklet,
  // and whether speech has stayed too quiet to transcribe even with the boost.
  const [level, setLevel] = useState<AudioLevel | null>(null);
  const [tooQuiet, setTooQuiet] = useState(false);
  const quietWatchRef = useRef(new QuietWatch());
  const levelReportsRef = useRef(0);
  // The silence alarm (Oct 4): when words and levels last arrived, the watch,
  // and what it says. Written after paint and read once a second, never on
  // the hot path.
  const lastWordsAtRef = useRef<number | null>(null);
  const lastLevelAtRef = useRef<number | null>(null);
  const speechDbRef = useRef<number | null>(null);
  const watchRef = useRef(new ConnectionWatch());
  const watchGameRef = useRef<string | null>(null);
  const [alarm, setAlarm] = useState<Alarm | null>(null);
  // The idle stop (pre-launch audit H4): listening ends on its own after long
  // quiet or a very long stretch, and the screen says why until Listen.
  const idleRef = useRef(new IdleWatch());
  const [idleStop, setIdleStop] = useState<IdleReason | null>(null);
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
  // Each player's card lines with tonight in them, by the player object the
  // cards are put up with. Rebuilt after paint when live stats change, and
  // only read, never computed, when a card goes up.
  const statLinesRef = useRef<CardStatLines>(NO_LINES);

  // The game lives in localStorage, which React cannot see. Reading it through
  // a store means the server renders "no game" and the browser swaps in the
  // real one on the first paint, with no hydration mismatch.
  const game = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getServerGameSnapshot);

  const watchlist = game ? game.watchlist : NO_WATCHLIST;
  const keyterms = game ? game.keyterms : NO_KEYTERMS;
  const gameId = game?.gameId ?? null;

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

  // How each side's number slabs look: its colour, the ink on it, and the
  // away team's hatching and school code (docs/CARD_SPEC.md). Settled once
  // per game, so the hot path only passes an object along.
  const looks: SideLooks = useMemo(
    () =>
      sideLooks(
        { color: game?.home.color ?? null, school: game?.home.name ?? "" },
        { color: game?.away.color ?? null, school: game?.away.name ?? "" },
      ),
    [game],
  );

  // The diagonal behind the cards, away's colour on the left and home's on
  // the right (V2's, back on Oct 5). Settled per game; null is plain grey.
  const stageBackground = useMemo(
    () => (game ? splitBackground(game.away.color ?? null, game.home.color ?? null) : null),
    [game],
  );

  /**
   * Every write to the cards goes through here, so the players last put up are
   * always known. HOT PATH on one of its callers: one ref assignment and one
   * call, passing an array the engine already made and looks settled when
   * the game was built.
   */
  const showPlayers = (players: WatchlistPlayer[]) => {
    lastShownRef.current = players;
    nameDisplayRef.current?.show(players, looks, statLinesRef.current);
  };

  // Every player the cards can show, by the key live stats uses for them.
  const byKey = useMemo(() => playersByKey(watchlist), [watchlist]);

  // Live stats changed: rebuild the lines the cards read, then, after paint,
  // rewrite the hero's lines if it is up. Never puts a card up, takes one down
  // or reorders anything: the lines are only text, and only NameDisplay.restat
  // writes them (G3).
  useEffect(() => {
    if (!stats) return;
    const rebuild = () => {
      const lines = linesForCards(stats.lines(), byKey);
      statLinesRef.current = lines;
      afterPaint(() => {
        nameDisplayRef.current?.restat(lines);
        bump((counts) => ({ ...counts, stats: stats.counts() }));
      });
    };
    rebuild();
    return stats.subscribe(rebuild);
    // bump reads the current game through its closure and changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, byKey]);

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
    // Every big line this game can put up, fitted to the card once the font is in.
    nameDisplayRef.current?.prepare(watchlist.flatMap((entry) => entry.players ?? []));
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
    if (readGameSnapshot() === null) router.replace("/home");
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
    // Any result with words is Deepgram hearing: what the silence alarm waits for.
    if (text.length > 0) lastWordsAtRef.current = arrivedAt;
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
    // Live stats read what was said, numbered the way the log numbers it. Last,
    // and on its own: a throw in stats code must never cost this result its
    // log rows, counts or transcript line (G4, pre-launch audit L5).
    if (stats && results.is_final && text.length > 0) {
      try {
        stats.heard(text, arrivedAt);
      } catch {
        console.warn("[Spotter] Live stats could not take a line.");
      }
    }
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
        // A new card on screen is a new thing to be right or wrong about, and
        // the last correction is no longer what the screen is about.
        if (outcome.display) setFlash(null);
      }
    });
  };

  const connection = useDeepgramStream({
    graph: mic.graph,
    enabled: hasApiKey,
    keyterms,
    boost: mic.source === "room",
    // Once a second, never on the hot path: the header's readout, the too-quiet
    // warning, and every fifth report into the browser log.
    onLevel: (next) => {
      lastLevelAtRef.current = Date.now();
      speechDbRef.current = next.speechDb;
      setLevel({ speechDb: Math.round(next.speechDb), gainDb: Math.round(next.gainDb) });
      setTooQuiet(quietWatchRef.current.update(next, Date.now()));
      if (game && ++levelReportsRef.current % 5 === 0) {
        logWriter().push({
          kind: "audio",
          gameId: game.gameId,
          at: Date.now(),
          speechDb: Math.round(next.speechDb * 10) / 10,
          gainDb: Math.round(next.gainDb * 10) / 10,
          source: mic.source,
        });
      }
    },
    onResults: handleResults,
  });

  const micOn = mic.status === "on";

  // X, 1, 2 and 3, and with live stats on, Enter, Backspace and U. No
  // dependency array on purpose: the handler closes over the current engine
  // and watchlist, and swapping one listener per render costs nothing next to
  // a stale one taking the wrong card down.
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
        statsKeys: stats?.keysLive() ?? false,
      });
      keyStateRef.current = state;
      if (!handled) return;
      event.preventDefault();
      if (action.type === "removeCard") takeDown(action.slot, action.key);
      else if (action.type === "okPlay") stats?.key("ok");
      else if (action.type === "discardPlay") stats?.key("discard");
      else if (action.type === "undoStat") stats?.key("undo");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // The laptop dozing mid-game cuts the mic, so the screen is held awake for
  // as long as the mic is open. Nowhere near the hot path.
  const wakeLock = useWakeLock(micOn);

  // The silence alarm (Oct 4). Once a second while a game is open, and on
  // every change below, the watch is told what the screen knows and says what
  // to do: its events go to the browser log, a raise plays one tone and asks
  // for a reconnect with a fresh token (the mic first when the mic is the
  // problem), and it clears itself when words come back. A quiet booth never
  // sets it off: it needs speech-level sound at the mic with nothing coming
  // back, a mic that stopped, or a socket that stays closed.
  const hidden = useSyncExternalStore(subscribeVisibility, getHidden, getServerHidden);
  const micEnded = mic.status === "error";
  const micMuted = mic.muted;
  const socketOpen = connection.status === "open";
  const socketCode = connection.status === "reconnecting" ? (connection.code ?? null) : null;
  const wakeLockHeld = wakeLock === "held";
  useEffect(() => {
    if (gameId === null) return;
    const watch = watchRef.current;
    if (watchGameRef.current !== gameId) {
      watchGameRef.current = gameId;
      watch.reset();
      idleRef.current.reset();
    }
    const tick = () => {
      const now = Date.now();
      // The idle stop first: when it says stop, the mic goes off, which closes
      // the socket, lets the wake lock go and takes the alarm down, so the
      // alarm is not asked anything this time round.
      const idle = idleRef.current.update({ listening: micOn, lastWordsAt: lastWordsAtRef.current }, now);
      if (idle) {
        logWriter().push({ kind: "connection", gameId, at: now, event: "idle_stop", idle: idle.reason, ms: Math.round(idle.ms) });
        setIdleStop(idle.reason);
        if (micOn) mic.toggle();
        return;
      }
      const out = watch.update(
        {
          listening: micOn,
          lastWordsAt: lastWordsAtRef.current,
          lastLevelAt: lastLevelAtRef.current,
          speechDb: speechDbRef.current,
          micEnded,
          micMuted,
          socketOpen,
          socketCode,
          hidden,
          wakeLockHeld,
        },
        now,
      );
      if (out.events.length > 0) {
        const log = logWriter();
        for (const event of out.events) log.push({ kind: "connection", gameId, at: now, ...event });
      }
      if (out.raised) playAlarmTone(mic.graph?.context ?? null);
      // The same object while it stays up, so React skips the no-change ticks.
      setAlarm(out.alarm);
      if (out.reconnect) {
        if (out.reconnect.micFirst) mic.restart();
        else connection.reconnect(`Not hearing you: ${out.alarm ? ALARM_WORDS[out.alarm.reason] : "trying again"}`);
      }
    };
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, WATCH_TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
    // mic and connection are new objects every render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, micOn, micEnded, micMuted, socketOpen, socketCode, hidden, wakeLockHeld]);

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
    if (!window.confirm("End this game? The counts are saved and the live screen clears. The log stays in this browser; a copy with last names kept and first names and schools taken out is sent if sharing is on.")) {
      return;
    }
    setEnding(true);
    endingRef.current = true;
    if (micOn) mic.toggle();
    // One last read of what was said since the last one, so a play called in
    // the final seconds still counts before the counts and the log close.
    if (stats) await stats.finish();

    const open = micOnSinceRef.current;
    micOnSinceRef.current = null;
    const counted = open === null ? countsRef.current : countMicStretch(countsRef.current, (Date.now() - open) / 1000);
    const final = stats ? { ...counted, stats: stats.counts() } : counted;
    await logWriter().flush();
    await endGame(game, final);
    // The feedback goes on the game's row, so a game whose row never wrote has nothing to attach it to.
    if (game.recorded) setFinished({ gameId: game.gameId, title: gameTitle(game) });
    else router.replace("/home");
  };

  const toggleListening = () => {
    setTranscript(EMPTY_TRANSCRIPT);
    setIdleStop(null);
    mic.toggle();
  };

  const transcriptionDown =
    hasApiKey && micOn && (connection.status === "reconnecting" || connection.status === "failed");

  const nameCount = watchlist.length;

  const placeholder = !hasApiKey
    ? "Name spotting is off: speech recognition is not available"
    : micOn
      ? `Listening for ${nameCount} ${nameCount === 1 ? "name" : "names"}`
      : "Start listening to spot names";

  // The game is over and its counts are written. Before the menu, one card.
  if (finished) {
    return <FeedbackCard gameId={finished.gameId} title={finished.title} onDone={() => router.replace("/home")} />;
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
          <p className="text-2xl font-black text-neutral-600">Loading the game...</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-white text-black">
      {!hasApiKey && <MissingKeyBanner />}

      {/* Every control, in one thin row at the top (Jed, Oct 3). Menus open downward. */}
      <header className="flex items-center gap-4 border-b border-neutral-200 px-4 py-2">
        <ListenButton status={mic.status} disabled={!hasApiKey} onToggle={toggleListening} />
        <ConnectionStatus state={connection} micOn={micOn} hasApiKey={hasApiKey} />
        <LevelMeter analyser={mic.graph?.analyser ?? null} />
        <span className="flex-1" />
        {statsMenu}
        <BarMenu label="Audio" title="Input device, where the sound comes from, and the screen">
          <DevicePicker
            devices={mic.devices}
            labelsHidden={mic.labelsHidden}
            value={mic.deviceId}
            activeLabel={mic.activeLabel}
            onChange={mic.selectDevice}
          />
          <MicSource source={mic.source} onChange={mic.selectSource} level={mic.status === "on" ? level : null} />
          <ScreenAwake state={wakeLock} />
        </BarMenu>
        <RefreshRosters game={game} onRefreshed={onRefreshed} />
        <button
          type="button"
          disabled={ending}
          title={game.recorded ? "Saves the counts and goes to the menu" : "Clears the screen"}
          onClick={(event) => {
            event.currentTarget.blur();
            void finishGame();
          }}
          className="h-9 shrink-0 cursor-pointer rounded-md border border-neutral-300 bg-white/80 px-3 text-sm font-semibold text-neutral-800 hover:border-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400"
        >
          {ending ? "Ending..." : "End game"}
        </button>
        <BarMenu label="⋯" title="The game, the keys, and the rest of Spotter" warn={!game.recorded}>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Game</span>
            <span className="text-sm font-black tracking-wider">{gameTitle(game)}</span>
            {!game.recorded && (
              <p className="text-sm font-semibold text-amber-700">This game&apos;s counts are not being saved.</p>
            )}
          </div>
          <ShareToggle gameId={game.gameId} />
          <WrongCardKeys />
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/games" className="text-neutral-600 hover:text-neutral-900">
              Past games
            </Link>
            <Link href="/home" className="text-neutral-600 hover:text-neutral-900">
              Menu
            </Link>
            <SignOutButton />
          </nav>
        </BarMenu>
      </header>

      {alarm && (
        <div
          role="alert"
          data-testid="not-hearing"
          className="flex items-center justify-center gap-4 bg-red-600 px-6 py-3 text-center text-2xl font-black text-white"
        >
          <span className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-white" />
          NOT HEARING YOU · {ALARM_WORDS[alarm.reason]} · reconnecting
        </div>
      )}

      {!alarm && transcriptionDown && (
        <div
          role="alert"
          className="flex items-center justify-center gap-4 bg-red-600 px-6 py-3 text-center text-2xl font-black text-white"
        >
          <span className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-white" />
          {connection.status === "failed"
            ? `SPEECH RECOGNITION FAILED · ${speechFailureMessage(connection.reason)}`
            : `SPEECH RECOGNITION DOWN · RECONNECTING (attempt ${connection.attempt})`}
        </div>
      )}

      {idleStop && !micOn && (
        <div role="status" data-testid="idle-stop" className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-lg font-semibold text-amber-800">
          {IDLE_WORDS[idleStop]}
        </div>
      )}

      {!micOn && <BrowserCheck />}

      {mic.error && (
        <div role="alert" className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-lg font-semibold text-amber-700">
          {mic.error}
        </div>
      )}

      {micOn && (wakeLock === "denied" || wakeLock === "unsupported") && (
        <div role="alert" className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-base font-semibold text-amber-700">
          Screen may sleep. Set this computer to never sleep while you call.
        </div>
      )}

      {micOn && tooQuiet && level && (
        <div role="alert" className="border-b border-amber-300 bg-amber-50 px-6 py-3 text-lg font-semibold text-amber-700">
          Too quiet to hear the names: speech is reaching speech recognition at {level.speechDb + level.gainDb} dB
          {level.gainDb > 0 ? ` even with a +${level.gainDb} dB boost` : ""}, and it needs about {TOO_QUIET_DB} dB.{" "}
          <span className="font-normal">
            {mic.source === "headset"
              ? "If the sound is coming from a TV or speaker, set Sound from to the room."
              : "Move the laptop closer to the TV or turn the TV up, and turn up the microphone input volume in your system sound settings."}
          </span>
        </div>
      )}

      {/* The stage: the cards, on grey, and nothing else. */}
      <main className="relative min-h-0 flex-1">
        <NameDisplay ref={nameDisplayRef} dimmed={!micOn} placeholder={placeholder} tonight={stats !== undefined} background={stageBackground} />
        {flash && <RemovedFlash name={flash.name} />}
      </main>

      {/* What was heard on the left, the latest stat on the right. */}
      <footer className="flex items-center gap-4 border-t border-neutral-200 px-4 py-2">
        <TranscriptLine transcript={transcript} />
        {statsLatest}
      </footer>
    </div>
  );
}
