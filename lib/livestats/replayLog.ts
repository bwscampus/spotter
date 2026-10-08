import type { WatchlistEntry } from "@/lib/watchlist";
import { rosterFromWatchlist } from "./roster";
import type { StatsRosterPlayer, StatsUtterance } from "./types";

// =============================================================================
// A downloaded browser log (lib/log/records.ts, ReplayFile, format
// "spotter-v3-log" version 1) as the replay harness needs it: what was said, in
// order, and which rosters were loaded when it was said.
//
// Read structurally rather than by importing the log's types, so live stats
// stays clear of the card path's modules (G3, test/cardPathIsolation.test.ts).
// Pure, so a test can hand it a made-up log.
//
// Three things about the log shape this:
//   - Utterances carry no seq. They are numbered here by the order they were
//     written, which is the order they were said. The live loop (item 13) has
//     to number them the same way, or a replay and a game disagree about seqs.
//   - offsetMs restarts near zero on every Refresh rosters, because it counts
//     from when the game was built. The clock here is the wall clock (`at`)
//     from the first utterance, which only moves forward.
//   - A game record holds the watchlist, which has already dropped every
//     player whose spotting is off. If a game record also carries statsRoster
//     (both full rosters, the shape of StatsRosterPlayer), that is used
//     instead; until the live screen logs it, linemen cannot be credited in a
//     replay, and `fullRoster` says so.
// =============================================================================

export interface ReplayUtterance extends StatsUtterance {
  /** Wall clock when it was said, ms. */
  at: number;
  /** Which of ReplayGame.rosters was loaded when it was said. */
  roster: number;
}

export interface ReplayRoster {
  players: StatsRosterPlayer[];
  /** True when the log carried both full rosters, spotting-off players included. */
  fullRoster: boolean;
}

export interface ReplayGame {
  gameId: string;
  home: string;
  away: string;
  sport: string | null;
  /** Every roster the game ran with, in order. A Refresh rosters adds one. */
  rosters: ReplayRoster[];
  utterances: ReplayUtterance[];
}

/** Why a file cannot be replayed, in words for the terminal. */
export class ReplayLogError extends Error {}

export function readReplayLog(raw: unknown): ReplayGame {
  if (!isRecord(raw) || raw.format !== "spotter-v3-log" || !Array.isArray(raw.records)) {
    throw new ReplayLogError("This is not a Spotter V3 browser log. Use Download on the game in Past games.");
  }
  if (raw.version !== 1) throw new ReplayLogError(`This log is version ${String(raw.version)}; this harness reads version 1.`);

  const game: ReplayGame = {
    gameId: typeof raw.gameId === "string" ? raw.gameId : "",
    home: "",
    away: "",
    sport: null,
    rosters: [],
    utterances: [],
  };

  let firstAt: number | null = null;
  let lastOffset = 0;
  for (const record of raw.records) {
    if (!isRecord(record)) continue;

    if (record.kind === "game" && isRecord(record.snapshot)) {
      const snapshot = record.snapshot;
      game.home = teamName(snapshot.home) ?? game.home;
      game.away = teamName(snapshot.away) ?? game.away;
      game.sport = typeof snapshot.sport === "string" ? snapshot.sport : game.sport;
      game.rosters.push(rosterOf(snapshot));
      continue;
    }

    if (record.kind === "utterance" && typeof record.text === "string" && typeof record.at === "number") {
      const text = record.text.trim();
      if (text.length === 0) continue;
      firstAt ??= record.at;
      // Never backwards, even if two tabs or a clock change wrote out of order.
      lastOffset = Math.max(lastOffset, record.at - firstAt);
      game.utterances.push({
        seq: game.utterances.length,
        text,
        offsetMs: lastOffset,
        at: record.at,
        roster: Math.max(0, game.rosters.length - 1),
      });
    }
  }

  if (game.rosters.length === 0) throw new ReplayLogError("This log has no game record, so there is no roster to read plays against.");
  if (game.utterances.length === 0) throw new ReplayLogError("This log has nothing said in it.");
  return game;
}

function rosterOf(snapshot: Record<string, unknown>): ReplayRoster {
  if (Array.isArray(snapshot.statsRoster)) {
    const players = snapshot.statsRoster.filter(isStatsRosterPlayer);
    if (players.length > 0) return { players, fullRoster: true };
  }
  const watchlist = Array.isArray(snapshot.watchlist) ? (snapshot.watchlist as WatchlistEntry[]) : [];
  return { players: rosterFromWatchlist(watchlist), fullRoster: false };
}

function isStatsRosterPlayer(value: unknown): value is StatsRosterPlayer {
  return (
    isRecord(value) &&
    typeof value.playerId === "string" &&
    (value.side === "home" || value.side === "away") &&
    typeof value.last === "string"
  );
}

function teamName(team: unknown): string | null {
  return isRecord(team) && typeof team.name === "string" ? team.name : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
