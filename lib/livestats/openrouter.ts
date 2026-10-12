// Server only: imported by app/api/livestats/extract/route.ts and by the replay
// harness (scripts/replay-livestats.ts), and nothing else. OPENROUTER_API_KEY
// must never reach a client component.
import { chat, chatBody, createOpenRouterClient, LIVE_STATS_MODEL } from "@/lib/ai/openrouter";
import { ExtractionError } from "@/lib/rosters/extractErrors";
import { usageFromOpenRouter } from "./cost";
import { volatileContent } from "./extract";
import { STATS_SCHEMA, STATS_SYSTEM_PROMPT } from "./prompt";
import { rostersForPrompt } from "./roster";
import { HALFTIME_SETTING, liveStatsSetting, ratesFor, type LiveStatsSetting } from "./settings";
import { NO_USAGE, type ExtractStatsRequest, type ExtractStatsResponse } from "./types";
import { validatePlays } from "./validate";

// =============================================================================
// The live stats call through OpenRouter (lib/ai/openrouter.ts). Plays were
// read with Gemini 3.8 Flash from Oct 5, when Sonnet cost about $1 a game, and
// with Claude Haiku 5.5 on Oct 10, and with Gemini again since Oct 11, when
// replays of the Oct 10 college game had Gemini right on 88% of plays and
// Haiku on 53 to 61%. Every model gets the same prompt. What comes back goes
// through validatePlays.
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

/**
 * The default reader. Which model and effort a call uses is the server's
 * LIVE_STATS_MODEL and LIVE_STATS_EFFORT (./settings.ts, Oct 10), from a short
 * allow-list, Gemini 3.8 Flash at minimal when unset.
 */
export const OPENROUTER_STATS_MODEL = LIVE_STATS_MODEL;

/**
 * Room for about ten plays with their events, plus whatever the model spends
 * thinking, which bills and counts as output on this wire. 8,000 since Oct 10,
 * when Gemini's 4,000 went up for Haiku, whose least effort still thinks a
 * little; kept for Gemini, whose 88% replay ran with it, because a reply cut
 * off at the cap is a window with no plays. The room costs only when used.
 */
const MAX_TOKENS = 8_000;

/** The halftime check (Part 8) may correct a whole half: twice the room. */
const HALFTIME_MAX_TOKENS = 16_000;

/**
 * One call's budget. Gemini takes about 5 s for a window and now and then
 * 14 s, so the 15 s Claude used to get timed out good reads; the same 25 s
 * holds for every allowed model. The route allows 30 s in all, and the loop has one call in
 * flight at a time, so a slow one only delays the next.
 */
export const OPENROUTER_TIMEOUT_MS = 25_000;

// =============================================================================

type Fetch = typeof fetch;

/** The request, as lib/ai/openrouter.ts's chatBody takes it. Exported so a test can read exactly what is sent. */
export function statsChatRequest(request: ExtractStatsRequest, setting: LiveStatsSetting = liveStatsSetting()) {
  return {
    model: setting.model,
    system: [
      { type: "text" as const, text: STATS_SYSTEM_PROMPT },
      // Identical for the whole game, so it is cached; what follows moves every call.
      { type: "text" as const, text: rostersForPrompt(request.rosters), cache_control: { type: "ephemeral" as const } },
    ],
    content: volatileContent(request),
    schema: STATS_SCHEMA,
    schemaName: "plays",
    maxTokens: request.look === "halftime" ? HALFTIME_MAX_TOKENS : MAX_TOKENS,
    // How hard it may think: minimal by default, the least Gemini takes
    // (./settings.ts).
    reasoning: setting.effort,
  };
}

/** The body that goes over the wire. Exported so a test can read exactly what is sent. */
export function openRouterBody(request: ExtractStatsRequest, setting?: LiveStatsSetting) {
  return chatBody(statsChatRequest(request, setting));
}

/**
 * Reads the finished plays out of one window of play-by-play with the live
 * stats model (Gemini 3.8 Flash unless the server's settings say otherwise)
 * through OpenRouter. A truncated or unreadable answer is a bad window with no
 * plays, never an error the live screen learns about; a refusal or a transport
 * failure is a code.
 */
export async function extractStatsPlaysOpenRouter(
  apiKey: string,
  request: ExtractStatsRequest,
  signal: AbortSignal,
  fetcher: Fetch = fetch,
  setting: LiveStatsSetting = liveStatsSetting(),
): Promise<ExtractStatsResponse> {
  if (request.utterances.length === 0) return { plays: [], usage: NO_USAGE };

  let outcome;
  try {
    outcome = await chat(createOpenRouterClient(apiKey, fetcher), statsChatRequest(request, setting), signal);
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError("unknown");
  }

  const usage = usageFromOpenRouter(outcome.usage, ratesFor(setting.model));
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

/**
 * The halftime checkup's call (Part 8): the same request shape and the same
 * privacy routing, to Claude Sonnet 5.5 at low effort (HALFTIME_SETTING). If
 * no zero-retention provider serves it, OpenRouter answers 404 and the call
 * fails closed as claude_model_missing; the game carries on without it.
 */
export function extractHalftimeOpenRouter(apiKey: string, request: ExtractStatsRequest, signal: AbortSignal, fetcher: Fetch = fetch): Promise<ExtractStatsResponse> {
  return extractStatsPlaysOpenRouter(apiKey, { ...request, look: "halftime" }, signal, fetcher, HALFTIME_SETTING);
}
