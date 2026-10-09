// Server only: imported by app/api/livestats/extract/route.ts and by the replay
// harness (scripts/replay-livestats.ts), and nothing else. OPENROUTER_API_KEY
// must never reach a client component.
import { chat, chatBody, createOpenRouterClient, LIVE_STATS_MODEL, type ReasoningEffort } from "@/lib/ai/openrouter";
import { ExtractionError } from "@/lib/rosters/extractErrors";
import { usageFromOpenRouter } from "./cost";
import { volatileContent } from "./extract";
import { STATS_SCHEMA, STATS_SYSTEM_PROMPT } from "./prompt";
import { rostersForPrompt } from "./roster";
import { NO_USAGE, type ExtractStatsRequest, type ExtractStatsResponse } from "./types";
import { validatePlays } from "./validate";

// =============================================================================
// The live stats call (Jed, Oct 5: Sonnet cost about $1 a game, so plays are
// read with Gemini 3.8 Flash through OpenRouter; since Oct 8 every model call
// is, lib/ai/openrouter.ts). What comes back goes through validatePlays.
//
// PRIVACY: the transcript and both rosters name minors. Every request tells
// OpenRouter to route only to providers that keep nothing (zdr) and do not
// collect or train on prompts (data_collection: deny). If no provider matches,
// the call fails rather than going somewhere that does. Nothing in the request
// or the reply is stored or logged; a failure is its code.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

export const OPENROUTER_STATS_MODEL = LIVE_STATS_MODEL;

/**
 * Room for about ten plays with their events, plus whatever the model spends
 * thinking, which bills and counts as output on this wire.
 */
const MAX_TOKENS = 4_000;

/**
 * How hard it may think. Gemini 3.8 will not run with thinking off (a 400,
 * "Reasoning is mandatory for this endpoint"), so this is the least it takes:
 * "minimal" measured about a second faster than "low" and wrote 40% fewer
 * tokens, with the same play read (Oct 5).
 */
const REASONING: ReasoningEffort = "minimal";

/**
 * One call's budget. Gemini takes about 5 s for a window and now and then
 * 14 s, so the 15 s Claude used to get timed out good reads. The route allows
 * 30 s in all, and the loop has one call in flight at a time, so a slow one
 * only delays the next.
 */
export const OPENROUTER_TIMEOUT_MS = 25_000;

// =============================================================================

type Fetch = typeof fetch;

/** The request, as lib/ai/openrouter.ts's chatBody takes it. Exported so a test can read exactly what is sent. */
export function statsChatRequest(request: ExtractStatsRequest) {
  return {
    model: OPENROUTER_STATS_MODEL,
    system: [
      { type: "text" as const, text: STATS_SYSTEM_PROMPT },
      // Identical for the whole game, so it is cached; what follows moves every call.
      { type: "text" as const, text: rostersForPrompt(request.rosters), cache_control: { type: "ephemeral" as const } },
    ],
    content: volatileContent(request),
    schema: STATS_SCHEMA,
    schemaName: "plays",
    maxTokens: MAX_TOKENS,
    reasoning: REASONING,
  };
}

/** The body that goes over the wire. Exported so a test can read exactly what is sent. */
export function openRouterBody(request: ExtractStatsRequest) {
  return chatBody(statsChatRequest(request));
}

/**
 * Reads the finished plays out of one window of play-by-play with Gemini
 * through OpenRouter. A truncated or unreadable answer is a bad window with no
 * plays, never an error the live screen learns about; a refusal or a transport
 * failure is a code.
 */
export async function extractStatsPlaysOpenRouter(
  apiKey: string,
  request: ExtractStatsRequest,
  signal: AbortSignal,
  fetcher: Fetch = fetch,
): Promise<ExtractStatsResponse> {
  if (request.utterances.length === 0) return { plays: [], usage: NO_USAGE };

  let outcome;
  try {
    outcome = await chat(createOpenRouterClient(apiKey, fetcher), statsChatRequest(request), signal);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError("unknown");
  }

  const usage = usageFromOpenRouter(outcome.usage);
  // Not an error: the next window covers the same plays.
  if (outcome.kind === "length") {
    console.error('[Spotter] Live stats stopped at the "max_tokens" cap. No plays from this window.');
    return { plays: [], usage };
  }
  if (outcome.kind === "empty") {
    console.error("[Spotter] Live stats came back with no text.");
    return { plays: [], usage };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(outcome.text);
  } catch {
    // Deliberately nothing from the reply in the log: it quotes the transcript.
    console.error("[Spotter] Live stats did not return JSON. No plays from this window.");
    return { plays: [], usage };
  }

  return { plays: validatePlays(raw, request), usage };
}
