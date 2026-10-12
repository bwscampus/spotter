// Shared by lib/livestats/openrouter.ts (the call) and the replay harness
// (scripts/replay-livestats.ts): what moves between calls, below the cache
// breakpoint. Pure, so a test can read it.
import { renderGameState } from "./gameStateBlock";
import { STRIP_LABELS } from "./describe";
import { STATS_USER_PROMPT } from "./prompt";
import { isRereadLook, type BoothRereadLine, type ExtractStatsRequest, type FieldSpot, type GapRereadFacts, type RecentPlay, type Side } from "./types";

export { MAX_EVIDENCE_WORDS, validatePlays } from "./validate";

/**
 * Everything that changes between calls, below the cache breakpoint. The order
 * is fixed, so a diff between two calls is genuinely the new utterances rather
 * than a reshuffle.
 */
export function volatileContent(request: ExtractStatsRequest): string {
  const parts: string[] = [];
  const reread = isRereadLook(request.look);
  const span = request.look === "drive" ? "FOR THIS DRIVE" : request.look === "halftime" ? "FOR THIS HALF" : "IN THESE LINES";
  const line = (play: RecentPlay) => `${play.playId ? `- ${play.playId}  ${play.summary}` : `- ${play.summary}`}${play.detail ? `\n    credited: ${play.detail}` : ""}`;
  parts.push(
    request.recentPlays.length > 0
      ? (reread
          ? `PLAYS ALREADY APPLIED ${span}\nEach line is an id, then the play as it stands, then who was credited. To correct one, return it with updates set to its id and the whole play as it stands now. To take one out, return it with updates set to its id and remove true.\n`
          : "PLAYS ALREADY APPLIED\nEach line is an id, then the play. Do not return these as new plays. To add to one (yards said later, a tackler, a kick's result, a touchdown, a flag that wiped it out), return it with updates set to its id.\n") +
          request.recentPlays.map(line).join("\n")
      : reread
        ? `PLAYS ALREADY APPLIED ${span}\nNone.`
        : "PLAYS ALREADY APPLIED\nNone yet.",
  );
  if (request.look === "booth" && request.boothLine) parts.push(boothLineBlock(request.boothLine));
  if (request.look === "gap" && request.gap) parts.push(gapBlock(request.gap, request.gameState?.teams));
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
    request.look === "second"
      ? SECOND_LOOK_PROMPT
      : request.look === "drive"
        ? DRIVE_REREAD_PROMPT
        : request.look === "halftime"
          ? HALFTIME_PROMPT
          : request.look === "booth"
            ? BOOTH_REREAD_PROMPT
            : request.look === "gap"
              ? GAP_REREAD_PROMPT
              : STATS_USER_PROMPT,
  );
  return parts.join("\n\n");
}

/** The booth line a re-read is about (fix 6, Part 1, R42), in plain words. */
function boothLineBlock(line: BoothRereadLine): string {
  return (
    `BOOTH STAT LINE\nOn line ${line.seq} the booth read ${line.playerId}'s running total tonight as ${line.value} ${STRIP_LABELS[line.key]}. ` +
    `The plays applied above credit ${line.playerId} with ${line.spotter} ${STRIP_LABELS[line.key]} up to that line, so ${Math.abs(line.value - line.spotter)} ${line.value > line.spotter ? "are missing from" : "too many are in"} the plays.`
  );
}

/** The missing snap a gap re-read is about (fix 6, Part 3, R44), in plain words. */
function gapBlock(gap: GapRereadFacts, teams?: { home: string; away: string }): string {
  const name = (side: Side) => teams?.[side] ?? `the ${side} team`;
  const spot = (where: FieldSpot | null) => (where ? (where.territory === "midfield" || where.yardLine === 50 ? "midfield" : where.territory === "unknown" ? `the ${where.yardLine}` : `the ${name(where.territory)} ${where.yardLine}`) : null);
  const state = (facts: GapRereadFacts["before"]) => {
    const parts: string[] = [];
    if (facts.down !== null) parts.push(facts.distance !== null ? `${ordinal(facts.down)} and ${facts.distance}` : `${ordinal(facts.down)} down`);
    const at = spot(facts.spot);
    if (at) parts.push(`at ${at}`);
    return parts.length > 0 ? parts.join(" ") : "an unknown down";
  };
  return (
    `MISSING SNAP\nBetween the two plays applied above, ${name(gap.offense)} went from ${state(gap.before)} to ${state(gap.after)}` +
    `${gap.yards !== null ? `, so one snap of about ${gap.yards} yards is missing` : ", so one snap is missing"}.`
  );
}

function ordinal(down: number): string {
  return down === 1 ? "1st" : down === 2 ? "2nd" : down === 3 ? "3rd" : `${down}th`;
}

/**
 * The booth re-read's closing lines (fix 6, Part 1, R42): the lines behind a
 * booth stat line whose count the plays disagree with, for corrections only.
 */
export const BOOTH_REREAD_PROMPT =
  "BOOTH RE-READ: the booth's running total for one player disagrees with the plays counted for him in these lines, and the booth's total is the better evidence. " +
  "Read the lines again looking for that player's plays: one the transcript describes that was never counted (updates empty), one counted for the wrong player or as the wrong kind of play (updates set to its id, the whole play as it stands now), " +
  "or one that was not a play at all (updates set to its id, remove true). Return corrections only, and nothing for a play that stands as it is. " +
  "The totals already follow the booth's line; what you return fixes who did what on which play. Never invent a play the words do not describe.";

/** The gap re-read's closing lines (fix 6, Part 3, R44): the few lines where the downs say a snap was missed. */
export const GAP_REREAD_PROMPT =
  "MISSING SNAP: the down and distance say one snap was run between the two plays above and never counted. These are the lines between them, with a line or two each side. " +
  "If they describe that snap, return it as a new play (updates empty) with whatever the words say: who had the ball, the kind of play, the yards if said. If they do not describe it, return nothing. " +
  "Never invent a player or a play the words do not describe, and do not return the two plays already applied.";

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
