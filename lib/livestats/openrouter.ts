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
// The live stats call through OpenRouter (lib/ai/openrouter.ts). Plays were
// read with Gemini 3.8 Flash from Oct 5, when Sonnet cost about $1 a game, and
// with Claude Haiku 5.5 since Oct 10 (Jed: "switch all gemini calls to claude
// haiku 5.5"). What comes back goes through validatePlays.
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
 * thinking, which bills and counts as output on this wire. 8,000 rather than
 * Gemini's 4,000: Claude's least effort still thinks a little, and a reply cut
 * off at the cap is a window with no plays. At Haiku's $0.50 per million out,
 * the room costs at most $0.004 a call, and only when it is used.
 */
const MAX_TOKENS = 8_000;

/**
 * How hard it may think: the least the model takes, as with Gemini, whose
 * "minimal" read the same plays as "low" a second sooner (Oct 5). Claude's
 * least is "low" (Haiku 5.5 defaults to "medium").
 */
const REASONING: ReasoningEffort = "low";

/**
 * One call's budget. Gemini took about 5 s for a window and now and then
 * 14 s, so the 15 s Claude used to get timed out good reads; the same 25 s
 * holds for Haiku. The route allows 30 s in all, and the loop has one call in
 * flight at a time, so a slow one only delays the next.
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
 * Reads the finished plays out of one window of play-by-play with Claude
 * Haiku through OpenRouter. A truncated or unreadable answer is a bad window with no
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
