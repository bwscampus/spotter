import { replayableLog, sharedLogProblem } from "@/lib/log/sharedReplay";
import type { WatchlistEntry } from "@/lib/watchlist";
import { rosterFromWatchlist } from "./roster";
import type { StatsRosterPlayer, StatsUtterance, TeamWords } from "./types";

// =============================================================================
// A downloaded browser log (lib/log/records.ts, ReplayFile, format
// "spotter-v3-log" version 1), or a shared one (scrub 3 and later), as the replay harness needs it: what was said, in
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
  /** The team names and cue phrases from the newest game record, for the game state block. */
  teams: TeamWords | null;
  /** Every roster the game ran with, in order. A Refresh rosters adds one. */
  rosters: ReplayRoster[];
  utterances: ReplayUtterance[];
  /** Who was out tonight, whole, each time it changed (the game record, then every stats_out record), in order. */
  outChanges: Array<{ at: number; playerIds: string[] }>;
}

/** Why a file cannot be replayed, in words for the terminal. */
export class ReplayLogError extends Error {}

export function readReplayLog(file: unknown): ReplayGame {
  // A log pulled from shared_game_logs reads the same, its tags as words (lib/log/sharedReplay.ts).
  const problem = sharedLogProblem(file);
  if (problem) throw new ReplayLogError(problem);
  const raw = replayableLog(file);
  if (!isRecord(raw) || raw.format !== "spotter-v3-log" || !Array.isArray(raw.records)) {
    throw new ReplayLogError("This is not a Spotter V3 browser log. Use Download on the game in Past games.");
  }
  if (raw.version !== 1) throw new ReplayLogError(`This log is version ${String(raw.version)}; this harness reads version 1.`);

  const game: ReplayGame = {
    gameId: typeof raw.gameId === "string" ? raw.gameId : "",
    home: "",
    away: "",
    sport: null,
    teams: null,
    rosters: [],
    utterances: [],
    outChanges: [],
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
      game.teams = teamsOf(snapshot) ?? game.teams;
      game.rosters.push(rosterOf(snapshot));
      if (game.outChanges.length === 0 && Array.isArray(snapshot.out) && typeof record.at === "number") {
        game.outChanges.push({ at: record.at, playerIds: snapshot.out.filter((id): id is string => typeof id === "string") });
      }
      continue;
    }

    if (record.kind === "stats_out" && Array.isArray(record.playerIds) && typeof record.at === "number") {
      game.outChanges.push({ at: record.at, playerIds: record.playerIds.filter((id): id is string => typeof id === "string") });
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

/** The team names and the cue phrases the game record carries, lowercased. */
function teamsOf(snapshot: Record<string, unknown>): TeamWords | null {
  const home = teamName(snapshot.home);
  const away = teamName(snapshot.away);
  if (home === null || away === null) return null;
  const phrases = (side: "H" | "A"): string[] => {
    if (!Array.isArray(snapshot.teamCues)) return [];
    const found: string[] = [];
    for (const cue of snapshot.teamCues) {
      if (!isRecord(cue) || cue.side !== side || !Array.isArray(cue.words)) continue;
      const phrase = cue.words.filter((word): word is string => typeof word === "string").join(" ").toLowerCase().trim();
      if (phrase) found.push(phrase);
    }
    return found;
  };
  return { home: { name: home, phrases: phrases("H") }, away: { name: away, phrases: phrases("A") } };
}

function teamName(team: unknown): string | null {
  return isRecord(team) && typeof team.name === "string" ? team.name : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
