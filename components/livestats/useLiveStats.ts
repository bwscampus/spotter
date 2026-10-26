"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { track } from "@/lib/analytics/track";
import { StatsController, type ExtractReply, type SegmentReply, type StatsView } from "@/lib/livestats/controller";
import type { SegmentRequest } from "@/lib/livestats/extract/request";
import type { ExtractStatsRequest, StatsRosterPlayer, StatsUsage, TeamWords } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";

// =============================================================================
// Live stats on the live screen: the loop (lib/livestats/controller.ts) with
// the real network, the browser log and analytics plugged in. Football games
// with the switch on only; every other game gets nothing from here and the
// live screen is names only, exactly as before.
//
// Nothing here is on the hot path. The loop runs on a timer and on finals the
// live screen hands it after paint.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** How often the loop checks the one minute cadence. A down and distance call asks straight away. */
const CHECK_EVERY_MS = 2_000;

/**
 * How long the browser waits for the route: 25 s an attempt through
 * OpenRouter (lib/livestats/openrouter.ts), asked again up to three times
 * when nothing answered, it took too long or it was rate limited, none
 * starting after 60 s (Oct 26, lib/livestats/retry.ts), plus the sign-in
 * check and the round trip, inside the route's 95 s and the proxy's ~100 s.
 * Past this the call has failed.
 */
const CLIENT_TIMEOUT_MS = 92_000;

/**
 * Null: after five failures in a row the loop stops until the switch goes off
 * and on (spec 8.8). A number tries again this long after the last call
 * instead, for an unattended test game where nobody is there to flip it.
 */
const RETRY_AFTER_STOP_MS: number | null = null;

/**
 * How long the browser waits for the halftime check's route (Part 8): the
 * model's 90 s (HALFTIME_TIMEOUT_MS) plus the round trip, under the ~100 s
 * the proxy allows.
 */
const HALFTIME_CLIENT_TIMEOUT_MS = 96_000;

/**
 * How long the browser waits for the segment route (v7): two readers and a
 * tie-break of 12 s each, inside the route's 45 s.
 */
const SEGMENT_CLIENT_TIMEOUT_MS = 42_000;

/**
 * Which engine reads the plays (lib/livestats/settings.ts liveStatsPipeline):
 * set at build time by next.config.ts from the server's LIVE_STATS_PIPELINE,
 * because the browser cannot read the server's environment. v6 unless it
 * says v7.
 */
export const PIPELINE: "v6" | "v7" = process.env.NEXT_PUBLIC_LIVE_STATS_PIPELINE === "v7" ? "v7" : "v6";

// =============================================================================

const NO_ROSTER: StatsRosterPlayer[] = [];
const NO_OUT: string[] = [];
const wallClock = () => Date.now();
const noSubscribe = () => () => undefined;
const noView = () => null;

/** POST /api/livestats/extract. Never throws: anything that goes wrong comes back as a code. */
export function extractFromRoute(request: ExtractStatsRequest): Promise<ExtractReply> {
  return postRoute("/api/livestats/extract", request, CLIENT_TIMEOUT_MS);
}

/** POST /api/livestats/halftime (Part 8): the same shape, a longer wait, a stronger model on the server. */
export function halftimeFromRoute(request: ExtractStatsRequest): Promise<ExtractReply> {
  return postRoute("/api/livestats/halftime", request, HALFTIME_CLIENT_TIMEOUT_MS);
}

/** POST /api/livestats/segment (v7): one play's segment through the readers. Never throws. */
export async function segmentFromRoute(request: SegmentRequest): Promise<SegmentReply> {
  try {
    const response = await fetch("/api/livestats/segment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(SEGMENT_CLIENT_TIMEOUT_MS),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
    if (!response.ok) return { ok: false, code: typeof record?.code === "string" ? record.code : "bad_response" };
    if (!record) return { ok: false, code: "bad_response" };
    if (record.ok === false) return { ok: false, code: typeof record.code === "string" ? record.code : "bad_response" };
    if (record.ok !== true || typeof record.answer !== "object" || record.answer === null) return { ok: false, code: "bad_response" };
    return record as unknown as SegmentReply;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, code: name === "TimeoutError" || name === "AbortError" ? "claude_timeout" : "network" };
  }
}

async function postRoute(path: string, request: ExtractStatsRequest, timeoutMs: number): Promise<ExtractReply> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
    if (!response.ok) return { ok: false, code: typeof record?.code === "string" ? record.code : "bad_response" };
    if (!record || !Array.isArray(record.plays)) return { ok: false, code: "bad_response" };
    return { ok: true, plays: record.plays, statLines: Array.isArray(record.statLines) ? record.statLines : [], usage: usageOf(record.usage) };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, code: name === "TimeoutError" || name === "AbortError" ? "claude_timeout" : "network" };
  }
}

function usageOf(value: unknown): StatsUsage {
  const usage = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const count = (key: string) => {
    const number = usage[key];
    return typeof number === "number" && Number.isFinite(number) && number > 0 ? number : 0;
  };
  return {
    inputTokens: count("inputTokens"),
    outputTokens: count("outputTokens"),
    cacheWriteTokens: count("cacheWriteTokens"),
    cacheReadTokens: count("cacheReadTokens"),
    costUsd: count("costUsd"),
  };
}

/**
 * The browser log, handed in by components/livestats/LiveGame.tsx. The log
 * module reaches the match log's types, so this folder takes it as a value
 * rather than importing it, and stays clear of the card path
 * (test/cardPathIsolation.test.ts). Stable for the page's life.
 */
export interface StatsLogIO {
  write(record: StatsRecord): void;
  /** Everything in this game's log, what is still buffered included. */
  read(gameId: string): Promise<readonly { kind: string }[]>;
}

/**
 * What the loop needs of the game in this browser (lib/game/snapshot.ts).
 * Named here rather than imported, because the snapshot also carries the
 * engine's team cues and this folder stays clear of the card path.
 */
export interface StatsGame {
  gameId: string;
  builtAt: string;
  sport: string | null;
  statsEnabled?: boolean;
  /** Every play counts as it is read (Jed, Oct 8). Absent on a game built before, which waits for an OK on each. */
  statsAuto?: boolean;
  statsRoster?: StatsRosterPlayer[];
  /** The team names and the words that name them (lib/livestats/types.ts TeamWords), for the game state block. */
  teams?: TeamWords | null;
  /** Players marked out tonight, by playerId (snapshot.out, Part 3). */
  out?: string[];
}

/** The stats loop for this game, or nothing when the game has stats off. */
export function useLiveStats(
  game: StatsGame | null,
  io: StatsLogIO,
): { controller: StatsController | null; view: StatsView | null } {
  const gameId = game && game.statsEnabled && game.sport === "football" ? game.gameId : null;
  const roster = game?.statsRoster ?? NO_ROSTER;
  const teams = game?.teams ?? null;
  const out = game?.out ?? NO_OUT;

  // One loop per game. A Refresh rosters hands it the new rosters rather than
  // starting a new loop, so the line and the decisions carry on.
  const controller = useMemo(() => {
    if (gameId === null || !game) return null;
    const builtAt = Date.parse(game.builtAt);
    return new StatsController({
      gameId,
      startedAt: Number.isFinite(builtAt) ? builtAt : null,
      roster,
      // Counted as read, as if Enter had been pressed on it, unless the
      // announcer ticked "Check each play before it counts" at setup (spec 8.6).
      autoOk: game.statsAuto === true,
      retryAfterStopMs: RETRY_AFTER_STOP_MS,
      pipeline: PIPELINE,
      deps: {
        extract: extractFromRoute,
        extractSegment: segmentFromRoute,
        halftime: halftimeFromRoute,
        log: (record) => io.write(record),
        readLog: () => io.read(gameId),
        track,
        now: wallClock,
      },
    });
    // Keyed on the game alone: a refresh is a new snapshot for the same game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  useEffect(() => {
    if (!controller) return;
    void controller.start();
    const timer = setInterval(() => controller.tick(), CHECK_EVERY_MS);
    return () => {
      clearInterval(timer);
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    controller?.setRoster(roster);
  }, [controller, roster]);

  useEffect(() => {
    controller?.setTeams(teams);
  }, [controller, teams]);

  // Who is out follows the snapshot, the way the roster does: the Out menu writes the snapshot and this hands it on.
  useEffect(() => {
    controller?.setOut(out);
  }, [controller, out]);

  const view = useSyncExternalStore(
    controller ? controller.subscribe : noSubscribe,
    controller ? controller.getView : noView,
    noView,
  );

  return { controller, view };
}
