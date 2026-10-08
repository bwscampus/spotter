import type { TonightTally } from "@/lib/cards/tonight";
import { foldStats, type LoggedDrop, type PlayStatus } from "@/lib/log/statsLog";
import { advanceWatermark, NO_WATERMARK } from "@/lib/plays/window";
import { UPDATE_LOOKBACK } from "./merge";
import { discardPlay, EMPTY_SESSION, freshReads, okPlay, readPlays, restoreSession, talliesOf, type ReadContext, type SessionPlay, type StatsSession } from "./session";
import type { StatsPlay, StatsRosterPlayer } from "./types";

// =============================================================================
// Replaying a game's recorded replies with no network: the browser log keeps
// every play Claude returned (the stats_reply records), so the check and the
// stat rules can be run again over exactly what the reader said that night,
// and the totals compared with what the game counted at the time.
//
// "Before" is what the game counted: the plays as logged, with the decisions
// the announcer (or autoOk) made. "After" is the same replies through today's
// readPlays, with the same decisions applied by playId, so the only difference
// is the code. Pure, so a test can hand it a made-up log.
// =============================================================================

export interface RecordedNote {
  playId: string;
  summary: string;
  note: LoggedDrop;
}

export interface RecordedReplay {
  /** Replies that came back with plays. */
  replies: number;
  /** Plays the game read that night (stats_play records). */
  readByGame: number;
  /** The plays as today's code reads them, in order. */
  plays: SessionPlay[];
  before: Map<string, TonightTally>;
  after: Map<string, TonightTally>;
  /** Every event today's code moved, filled in, dropped or changed, with its rule. */
  notes: RecordedNote[];
}

export function replayRecorded(records: readonly { kind: string }[], roster: readonly StatsRosterPlayer[], context: ReadContext = {}): RecordedReplay {
  const logged = foldStats(records);
  const decided = new Map<string, PlayStatus>(logged.map((play) => [play.playId, play.status]));
  const before = talliesOf(restoreSession(logged));

  // What was said, numbered the way the live loop numbers it (every non-blank
  // final, in order), so the check reads each play's own lines. Each reply
  // sees only what had been said by the time it came back.
  const said: Array<{ seq: number; text: string; offsetMs: number; at: number }> = [];
  for (const record of records) {
    const utterance = record as { kind: string; text?: unknown; at?: unknown };
    if (utterance.kind !== "utterance" || typeof utterance.text !== "string" || typeof utterance.at !== "number") continue;
    if (utterance.text.trim().length === 0) continue;
    said.push({ seq: said.length, text: utterance.text, offsetMs: utterance.at - (said[0]?.at ?? utterance.at), at: utterance.at });
  }

  let session: StatsSession = EMPTY_SESSION;
  let watermark = NO_WATERMARK;
  let replies = 0;
  for (const record of records) {
    if (record.kind !== "stats_reply") continue;
    const reply = record as { ok?: boolean; plays?: unknown; at?: number };
    if (reply.ok !== true || !Array.isArray(reply.plays) || reply.plays.length === 0) continue;
    replies += 1;
    const plays = reply.plays as StatsPlay[];
    // The plays that call was sent: the last few read before it, as the live loop sends them.
    const recentIds = new Set(session.plays.filter((play) => play.status !== "discarded").slice(-UPDATE_LOOKBACK).map((play) => play.playId));
    const fresh = freshReads(plays, session, watermark, recentIds);
    watermark = advanceWatermark(watermark, plays);
    const at = typeof reply.at === "number" ? reply.at : 0;
    const utterances = context.utterances ?? said.filter((utterance) => utterance.at <= at);
    const read = readPlays(session, fresh, roster, at, { ...context, utterances });
    session = read.session;
    for (const play of read.added) {
      // The same decision the game made about this play; a play the game never
      // decided on counts, as autoOk would have counted it.
      const status = decided.get(play.playId) ?? "applied";
      if (status === "applied") session = okPlay(session, at, play.playId).session;
      else if (status === "discarded") session = discardPlay(session, at, play.playId).session;
    }
  }

  const notes: RecordedNote[] = [];
  for (const play of session.plays) for (const note of play.dropped) notes.push({ playId: play.playId, summary: play.play.summary, note });

  return {
    replies,
    readByGame: logged.length,
    plays: session.plays,
    before,
    after: talliesOf(session),
    notes,
  };
}
