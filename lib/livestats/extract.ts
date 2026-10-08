// Shared by lib/livestats/openrouter.ts (the call) and the replay harness
// (scripts/replay-livestats.ts): what moves between calls, below the cache
// breakpoint. Pure, so a test can read it.
import { STATS_USER_PROMPT } from "./prompt";
import type { ExtractStatsRequest } from "./types";

export { MAX_EVIDENCE_WORDS, validatePlays } from "./validate";

/**
 * Everything that changes between calls, below the cache breakpoint. The order
 * is fixed, so a diff between two calls is genuinely the new utterances rather
 * than a reshuffle.
 */
export function volatileContent(request: ExtractStatsRequest): string {
  const parts: string[] = [];
  parts.push(
    request.recentPlays.length > 0
      ? "PLAYS ALREADY APPLIED\nEach line is an id, then the play. Do not return these as new plays. To add to one (yards said later, a tackler, a kick's result, a touchdown, a flag that wiped it out), return it with updates set to its id.\n" +
          request.recentPlays.map((play) => (play.playId ? `- ${play.playId}  ${play.summary}` : `- ${play.summary}`)).join("\n")
      : "PLAYS ALREADY APPLIED\nNone yet.",
  );
  parts.push(
    `THE TRANSCRIPT\nEach line is: seq, what was said.\n\n${request.utterances
      .map((utterance) => `${utterance.seq}\t${utterance.text}`)
      .join("\n")}`,
  );
  parts.push(STATS_USER_PROMPT);
  return parts.join("\n\n");
}
