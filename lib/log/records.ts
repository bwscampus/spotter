import type { DeepgramResults } from "@/lib/deepgram/config";
import type { ConnectionEvent } from "@/lib/game/connectionWatch";
import type { GameSnapshot } from "@/lib/game/snapshot";
import { logToCsv, type LogRow } from "@/lib/matching/matchLog";
import type { StatsRecord } from "./statsLog";

// =============================================================================
// What the browser log holds for one game, and the two files it downloads as.
//
// PRIVACY: this is a recording of somebody naming minors. It lives in this
// browser's IndexedDB (lib/log/gameLog.ts) and leaves only when the announcer
// presses Download. Nothing here is ever sent, logged to a console, or put in
// an analytics event. docs/V3_DEFINITION.md 9.3.
//
// Everything in this file is pure, so the shapes and the exports can be tested
// without a browser.
// =============================================================================

/** The game as it was built, written at the start and again on every refresh, so a replay knows which rosters each result was matched against. */
export interface GameRecord {
  kind: "game";
  gameId: string;
  at: number;
  snapshot: Pick<GameSnapshot, "home" | "away" | "sport" | "watchlist" | "keyterms" | "teamCues" | "statsEnabled" | "statsRoster">;
}

/** One Deepgram result exactly as it reached the card path: every word, its confidence and timing. */
export interface ResultRecord {
  kind: "result";
  gameId: string;
  /** Wall clock when the result arrived, in ms. What a replay passes the engine as its clock. */
  at: number;
  /** Which socket it came on. The engine keys interim retraction on it. */
  connectionId: number;
  is_final: boolean;
  speech_final: boolean;
  start: number;
  duration: number;
  transcript: string;
  confidence: number;
  words: Array<{ word: string; start: number; end: number; confidence: number }>;
}

/** A final's words, as a line of what was said. */
export interface UtteranceRecord {
  kind: "utterance";
  gameId: string;
  at: number;
  connectionId: number;
  text: string;
  /** How far into the game, from when it was built. Deepgram's clock restarts on every socket. */
  offsetMs: number;
}

/** One match log row, the same columns as V2's CSV. */
export interface RowRecord {
  kind: "row";
  gameId: string;
  at: number;
  row: LogRow;
}

/**
 * How loud the sound reaching Deepgram was, every few seconds (testrun, Oct 3),
 * so a log can say whether a game was loud enough to hear. Levels only, never
 * audio: the loudest recent speech before the boost, the boost, and the setting.
 */
export interface AudioLevelRecord {
  kind: "audio";
  gameId: string;
  at: number;
  speechDb: number;
  gainDb: number;
  source: "room" | "headset";
}

/**
 * connection: what happened to the socket, the mic, the tab, the wake lock and
 * the silence alarm (lib/game/connectionWatch.ts), so an outage leaves a
 * record (Oct 4: 25 minutes of nothing, and nothing in the export about it).
 * Pushed after paint, never from the hot path.
 */
export type ConnectionRecord = ConnectionEvent & {
  kind: "connection";
  gameId: string;
  at: number;
};

/** Live stats' own records (lib/log/statsLog.ts): replies, plays read, and the announcer's decisions. */
export type LogRecord = GameRecord | ResultRecord | UtteranceRecord | RowRecord | StatsRecord | AudioLevelRecord | ConnectionRecord;

/**
 * Anything written to the log carries the sequence IndexedDB gave it, which is
 * the order it happened in, and the account that wrote it (lib/game/viewer.ts),
 * which readGameLog takes off again before anything else sees the record.
 */
export type StoredRecord = LogRecord & { seq?: number; owner?: string };

export function gameRecord(snapshot: GameSnapshot, at: number): GameRecord {
  return {
    kind: "game",
    gameId: snapshot.gameId,
    at,
    snapshot: {
      home: snapshot.home,
      away: snapshot.away,
      sport: snapshot.sport,
      watchlist: snapshot.watchlist,
      keyterms: snapshot.keyterms,
      teamCues: snapshot.teamCues,
      statsEnabled: snapshot.statsEnabled,
      // Both full rosters, so a replay can credit the players the watchlist left out.
      statsRoster: snapshot.statsRoster,
    },
  };
}

/**
 * The result as the log keeps it. Copies the fields rather than the object:
 * Deepgram sends more than the card path reads (metadata, channel indexes),
 * and a replay needs exactly what process() saw.
 */
export function resultRecord(gameId: string, results: DeepgramResults, at: number, connectionId: number): ResultRecord {
  const alternative = results.channel.alternatives[0];
  return {
    kind: "result",
    gameId,
    at,
    connectionId,
    is_final: results.is_final,
    speech_final: results.speech_final,
    start: results.start,
    duration: results.duration,
    transcript: alternative?.transcript ?? "",
    confidence: alternative?.confidence ?? 0,
    words: (alternative?.words ?? []).map((word) => ({
      word: word.word,
      start: word.start,
      end: word.end,
      confidence: word.confidence,
    })),
  };
}

/** A logged result back in the shape SpotterEngine.process takes. What a replay feeds the card path. */
export function toDeepgramResults(record: ResultRecord): DeepgramResults {
  return {
    type: "Results",
    is_final: record.is_final,
    speech_final: record.speech_final,
    start: record.start,
    duration: record.duration,
    channel: {
      alternatives: [
        {
          transcript: record.transcript,
          confidence: record.confidence,
          words: record.words.map((word) => ({ ...word, punctuated_word: word.word })),
        },
      ],
    },
  };
}

/** The .json download: every record in the order it happened, for the replay harness. */
export interface ReplayFile {
  format: "spotter-v3-log";
  version: 1;
  gameId: string;
  exportedAt: string;
  records: LogRecord[];
}

function inOrder(records: StoredRecord[]): LogRecord[] {
  return [...records]
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || a.at - b.at)
    .map((record) => {
      const copy = { ...record };
      delete copy.seq;
      delete copy.owner;
      return copy;
    });
}

export function toReplayFile(gameId: string, records: StoredRecord[], exportedAt: Date): ReplayFile {
  return { format: "spotter-v3-log", version: 1, gameId, exportedAt: exportedAt.toISOString(), records: inOrder(records) };
}

/** The .csv download: the match log rows, in V2's columns, oldest first. */
export function toMatchLogCsv(records: StoredRecord[]): string {
  const rows = inOrder(records).flatMap((record) => (record.kind === "row" ? [record.row] : []));
  return logToCsv(rows);
}

/** "spotter-log-20260925-1903-ab12cd34.json", from the local time and the start of the game id. */
export function downloadName(kind: "log" | "matches" | "stats" | "report", gameId: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  const extension = kind === "log" ? "json" : kind === "report" ? "xlsx" : "csv";
  return `spotter-${kind}-${stamp}-${gameId.slice(0, 8)}.${extension}`;
}
