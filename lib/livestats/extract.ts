// Shared by lib/livestats/openrouter.ts (the call) and the replay harness
// (scripts/replay-livestats.ts): what moves between calls, below the cache
// breakpoint. Pure, so a test can read it.
import { renderGameState } from "./gameStateBlock";
import { STATS_USER_PROMPT } from "./prompt";
import type { ExtractStatsRequest, RecentPlay } from "./types";

export { MAX_EVIDENCE_WORDS, validatePlays } from "./validate";

/**
 * Everything that changes between calls, below the cache breakpoint. The order
 * is fixed, so a diff between two calls is genuinely the new utterances rather
 * than a reshuffle.
 */
export function volatileContent(request: ExtractStatsRequest): string {
  const parts: string[] = [];
  const reread = request.look === "drive" || request.look === "halftime";
  const line = (play: RecentPlay) => `${play.playId ? `- ${play.playId}  ${play.summary}` : `- ${play.summary}`}${play.detail ? `\n    credited: ${play.detail}` : ""}`;
  parts.push(
    request.recentPlays.length > 0
      ? (reread
          ? `PLAYS ALREADY APPLIED FOR THIS ${request.look === "drive" ? "DRIVE" : "HALF"}\nEach line is an id, then the play as it stands, then who was credited. To correct one, return it with updates set to its id and the whole play as it stands now. To take one out, return it with updates set to its id and remove true.\n`
          : "PLAYS ALREADY APPLIED\nEach line is an id, then the play. Do not return these as new plays. To add to one (yards said later, a tackler, a kick's result, a touchdown, a flag that wiped it out), return it with updates set to its id.\n") +
          request.recentPlays.map(line).join("\n")
      : reread
        ? `PLAYS ALREADY APPLIED FOR THIS ${request.look === "drive" ? "DRIVE" : "HALF"}\nNone.`
        : "PLAYS ALREADY APPLIED\nNone yet.",
  );
  // What the code believes so far (Part 2): after the applied plays, before
  // the lines, and never in the cached prefix above.
  const state = request.gameState ? renderGameState(request.gameState) : "";
  if (state) parts.push(state);
  parts.push(
    `THE TRANSCRIPT\nEach line is: seq, what was said.\n\n${request.utterances
      .map((utterance) => `${utterance.seq}\t${utterance.text}`)
      .join("\n")}`,
  );
  parts.push(
    request.look === "second" ? SECOND_LOOK_PROMPT : request.look === "drive" ? DRIVE_REREAD_PROMPT : request.look === "halftime" ? HALFTIME_PROMPT : STATS_USER_PROMPT,
  );
  return parts.join("\n\n");
}

/**
 * The drive re-read's closing lines (Part 7): the whole drive, with the plays
 * counted for it, and corrections only.
 */
export const DRIVE_REREAD_PROMPT =
  "DRIVE RE-READ: the transcript is one whole drive, from its first snap to a few lines after it gave the ball up, and the plays listed above are what was counted for it. " +
  "Read the drive again with everything the booth said, the recaps and the down and distance calls included, since they settle the yards. " +
  "Return corrections only: a play already applied whose player, stat, yards or result stands differently now (updates set to its id, the whole play as it stands now); " +
  "a play the drive missed (updates empty); a play that was not a play at all (updates set to its id, remove true). Return nothing for a play that stands as it is. " +
  "Never change who had the ball on a play, and never invent a play the words do not describe.";

/** The halftime check's closing lines (Part 8): the whole first half, the same way. */
export const HALFTIME_PROMPT =
  "HALFTIME CHECK: the transcript is the whole first half, and the plays listed above are everything counted for it. " +
  "Read the half again carefully, with everything the booth said: recaps, replays, stat updates, corrections and the down and distance calls that settle the yards. " +
  "Return corrections only: a play already applied whose player, stat, yards or result stands differently now (updates set to its id, the whole play as it stands now); " +
  "a play the half missed (updates empty); a play that was not a play at all (updates set to its id, remove true). Return nothing for a play that stands as it is. " +
  "Never change who had the ball on a play, and never invent a play the words do not describe.";

/** The second look's one-line note (Part 5), in place of the usual closing line. */
export const SECOND_LOOK_PROMPT =
  "SECOND LOOK: these lines may describe a play that the first read returned nothing for. Read them again. Return the play if there is one, or nothing.";
