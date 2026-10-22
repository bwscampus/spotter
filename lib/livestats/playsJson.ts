import type { StatChange } from "@/lib/cards/tonight";
import type { LoggedDrop, PlayStatus } from "@/lib/log/statsLog";
import type { SegmentDetail } from "./v7";
import type { LiveReplayResult } from "./liveReplay";
import { isInside } from "./score";
import { settingLabel } from "./settings";
import type { BoothStatLine, StatsPlay, StatsUsage } from "./types";

// =============================================================================
// `npm run replay:stats -- <log.json> --plays-json <path>` (Oct 19): every
// play of a live replay as the loop left it, after updates, dedupe, the check
// and the stat rules, in the shape the log's stats_play and stats_update
// records carry, so another tool can read the plays without parsing the
// terminal. Opt in only: without the flag the replay writes nothing anywhere.
//
// Each play is the session's own (LiveReplayResult.session), so it is the
// final state by construction, whatever updated it after it was first read.
// `at` is when the call that first returned the play came back, on the
// replay's clock (the log's wall clock moved on by each call's real time):
// the `at` of the play's first stats_play record, as a live game would log it.
// `status` says whether the play counts: a re-read can take a play out
// (discarded), and its changes then count for nothing.
//
// PRIVACY: plays carry the reader's summary and the transcript words they were
// read from, which name players, minors at a high school game. The script
// refuses a path inside this repository (playsJsonPathProblem), the same rule
// the scorer keeps for its folder, so the file can never be committed.
// Pure: the script resolves the path and writes the file.
// =============================================================================

export const PLAYS_JSON_FORMAT = "spotter-replay-plays";

export interface ReplayPlayEntry {
  playId: string;
  /** Ms epoch, on the replay's clock, when the call that first returned this play came back. */
  at: number;
  /** Whether it counts: "applied", or "discarded" when a re-read took it out. A replay OKs every play, so never "pending" once the loop is idle. */
  status: PlayStatus;
  play: StatsPlay;
  changes: StatChange[];
  dropped: LoggedDrop[];
}

export interface ReplayPlaysFile {
  format: typeof PLAYS_JSON_FORMAT;
  /** The setting that read the plays, "Gemini 3.8 Flash minimal". */
  reader: string;
  /** "Away at Home", as the replay prints it. */
  game: string;
  plays: ReplayPlayEntry[];
  /** v7 (Oct 20): every segment the segmenter closed, with its lines and times, for the segmentation scorer. Absent under v6. */
  segments?: Array<{ id: string; lineStart: number; lineEnd: number; startedAt: number; lastLineAt: number; emittedAt: number; closedBy: string; playId: string | null }>;
  /** Every line's wall-clock time by seq, so a tool can place a play in time without the log. */
  lineTimes?: Record<string, number>;
  /** v7 (fix 1, Part 0): every request as it was sent and answered (lib/livestats/v7.ts SegmentDetail). Absent under v6. */
  segmentDetail?: SegmentDetail[];
  /** v7 (fix 1, Part 2): the segmenter's own counts, recaps joined to the play before among them. */
  segmenter?: import("./segment").SegmenterCounts;
  /** v6 (Oct 22): every model call as it was asked and answered, for `--recorded --replies`. Absent under v7. */
  calls?: RecordedCall[];
  /** Present and true when the replay stopped before the end of the log (Ctrl-C, a kill, or the cost cap). */
  partial?: true;
  /** Why it stopped early: "signal" or "max_cost". */
  stoppedBy?: string;
}

/**
 * One model call of a v6 replay (Oct 22) as it was asked and answered, so
 * `--recorded --replies <plays file>` (lib/livestats/recorded.ts
 * recordedReplies) can answer the same request again with no network, in the
 * order the loop got the replies back and on the same clock. The reply is
 * what the wire validated against the request.
 */
export interface RecordedCall {
  /** 1-based, in the order the calls were asked. */
  index: number;
  /** 1-based, in the order the loop got the replies back: several calls can be in flight at once. */
  done: number;
  /** "first", "second", "drive", "booth", "gap" or "halftime". */
  look: string;
  seqFrom: number | null;
  seqTo: number | null;
  /** Every line the request carried, by seq. */
  seqs: number[];
  /** When it was asked, on the replay's clock, in ms from the log's first line. */
  askedAtMs: number;
  /** How long the call itself took. */
  tookMs: number;
  /** From asking to the loop having the reply, on the replay's clock: the call, and any other call that landed meanwhile. */
  returnAfterMs: number;
  /**
   * How many calls had been asked when the loop got this reply back. Usually
   * this call's own index; more when the loop asked again first, as it does
   * when it gives up waiting on a slow re-read (DRIVE_REREAD_TIMEOUT_MS) or a
   * second look goes beside a re-read.
   */
  askedBefore?: number;
  /**
   * A re-read (drive, booth, gap) or halftime check that came back after the
   * loop had stopped waiting for it (DRIVE_REREAD_TIMEOUT_MS, HALFTIME_TIMEOUT_MS,
   * real time with the pace between calls): the loop never applied it.
   */
  late?: true;
  ok: boolean;
  /** A failed call's code. */
  code?: string;
  plays?: StatsPlay[];
  statLines?: BoothStatLine[];
  usage?: StatsUsage;
}

/** How a replay stopped short of the end of its log, for the plays file and the manifest. */
export interface PartialRun {
  stoppedBy: "signal" | "max_cost";
}

/** Every play of the replay, in the order it was read, as it finally stands. */
export function replayPlaysFile(result: LiveReplayResult, game: { away: string; home: string; utterances?: ReadonlyArray<{ seq: number; at: number }> }, partial: PartialRun | null = null): ReplayPlaysFile {
  const lineTimes: Record<string, number> = {};
  for (const line of game.utterances ?? []) lineTimes[String(line.seq)] = line.at;
  return {
    format: PLAYS_JSON_FORMAT,
    reader: settingLabel(result.setting),
    game: `${game.away || "Away"} at ${game.home || "Home"}`,
    plays: result.session.plays.map((play) => ({
      playId: play.playId,
      at: result.firstReturnedAt.get(play.playId) ?? play.readAt,
      status: play.status,
      play: play.play,
      changes: play.changes,
      dropped: play.dropped,
    })),
    ...(result.segments.length > 0 ? { segments: result.segments.map((segment) => ({ ...segment })) } : {}),
    ...(Object.keys(lineTimes).length > 0 ? { lineTimes } : {}),
    ...(result.segmentDetail.length > 0 ? { segmentDetail: result.segmentDetail.map((detail) => ({ ...detail })) } : {}),
    ...(result.segmenter ? { segmenter: { ...result.segmenter } } : {}),
    ...(result.callDetail.length > 0 ? { calls: result.callDetail.map((call) => ({ ...call })) } : {}),
    ...(partial ? { partial: true as const, stoppedBy: partial.stoppedBy } : {}),
  };
}

/**
 * Why the plays file may not be written at this path, or null when it may.
 * Both paths are absolute with links resolved (the script resolves them): a
 * file inside the repository could be committed, and it names players.
 */
export function playsJsonPathProblem(target: string, repoRoot: string): string | null {
  if (!isInside(target, repoRoot)) return null;
  return (
    `${target} is inside this repository. The plays name players (minors, at a high school game) and must never be committed, ` +
    "so --plays-json only writes outside the repo (for example ~/SpotterTestSet/plays.json)."
  );
}
