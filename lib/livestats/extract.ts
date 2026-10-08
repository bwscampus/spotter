// Server only: imported by app/api/livestats/extract/route.ts, by
// lib/livestats/openrouter.ts (which shares its prompt text) and by the replay
// harness (scripts/replay-livestats.ts), and nothing else. ANTHROPIC_API_KEY
// must never reach a client component. This is the Claude path; the default
// reader is Gemini through OpenRouter (provider.ts).
import type Anthropic from "@anthropic-ai/sdk";
import { ExtractionError, toExtractionError } from "@/lib/rosters/extractWithClaude";
import { usageFrom } from "./cost";
import { STATS_SCHEMA, STATS_SYSTEM_PROMPT, STATS_USER_PROMPT } from "./prompt";
import { rostersForPrompt } from "./roster";
import { NO_USAGE, type ExtractStatsRequest, type ExtractStatsResponse } from "./types";
import { validatePlays } from "./validate";

export { MAX_EVIDENCE_WORDS, validatePlays } from "./validate";

// =============================================================================
// TUNING: the Claude call that reads plays out of play-by-play.
// docs/V3_DEFINITION.md 8.8 and 8.9.
// =============================================================================

export const STATS_MODEL = "claude-sonnet-5";

/** One call's budget (spec 8.8). The route aborts at the same figure, so neither outlives the other. */
export const STATS_TIMEOUT_MS = 15_000;

/**
 * Room for about ten plays with their events. A window that produced more than
 * that is a window that went wrong, and a cap is cheaper than finding out how
 * wrong.
 */
const MAX_TOKENS = 3_000;

// =============================================================================

/**
 * Reads the finished plays out of one window of play-by-play.
 *
 * messages.create, not messages.parse: parse runs JSON.parse before anything
 * can look at stop_reason, so a refusal or a truncated answer surfaces as a
 * parser error rather than the real reason. It would also put a slice of the
 * model's output into the thrown message, and the transcript names minors.
 */
export async function extractStatsPlays(
  client: Anthropic,
  request: ExtractStatsRequest,
  signal: AbortSignal,
): Promise<ExtractStatsResponse> {
  if (request.utterances.length === 0) return { plays: [], usage: NO_USAGE };

  let response;
  try {
    response = await client.messages.create(
      {
        model: STATS_MODEL,
        max_tokens: MAX_TOKENS,
        // Off (spec 8.9): a play is read off the page rather than reasoned
        // about, thinking tokens bill as output, and the loop has fifteen
        // seconds before the announcer has moved on anyway.
        thinking: { type: "disabled" },
        system: [
          { type: "text", text: STATS_SYSTEM_PROMPT },
          {
            type: "text",
            text: rostersForPrompt(request.rosters),
            // The breakpoint. Everything above it is identical for the whole
            // game and is read back at a tenth of the price; everything below
            // moves every call. Sonnet 5 caches a prefix from 1024 tokens, and
            // the instructions plus two rosters clear that comfortably.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: volatileContent(request) }],
        output_config: { format: { type: "json_schema", schema: STATS_SCHEMA } },
      },
      { signal },
    );
  } catch (error) {
    throw toExtractionError(error);
  }

  const usage = usageFrom(response.usage);

  if (response.stop_reason === "refusal") throw new ExtractionError("claude_refused");
  // Not an error. A truncated answer is a bad window, and the live screen must
  // never learn about it: the next window will cover the same plays.
  if (response.stop_reason === "max_tokens") {
    console.error('[Spotter] Live stats stopped at the "max_tokens" cap. No plays from this window.');
    return { plays: [], usage };
  }

  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) {
    console.error("[Spotter] Live stats came back with no text block.");
    return { plays: [], usage };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Deliberately nothing from the reply in the log: it quotes the transcript.
    console.error("[Spotter] Live stats did not return JSON. No plays from this window.");
    return { plays: [], usage };
  }

  return { plays: validatePlays(raw, request), usage };
}

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
