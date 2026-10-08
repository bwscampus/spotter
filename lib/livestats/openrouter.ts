// Server only: imported by app/api/livestats/extract/route.ts and by the replay
// harness (scripts/replay-livestats.ts), and nothing else. OPENROUTER_API_KEY
// must never reach a client component.
import { ExtractionError } from "@/lib/rosters/extractWithClaude";
import { usageFromOpenRouter } from "./cost";
import { volatileContent } from "./extract";
import { STATS_SCHEMA, STATS_SYSTEM_PROMPT } from "./prompt";
import { rostersForPrompt } from "./roster";
import { NO_USAGE, type ExtractStatsRequest, type ExtractStatsResponse } from "./types";
import { validatePlays } from "./validate";

// =============================================================================
// The live stats call through OpenRouter (Jed, Oct 5: Sonnet cost about $1 a
// game, so testrun reads plays with Gemini 3.8 Flash). The same prompt, the
// same schema, the same validation: only the model and the wire differ, so
// what comes back goes through validatePlays exactly like Claude's did.
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

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const OPENROUTER_STATS_MODEL = "google/gemini-3.8-flash";

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
const REASONING = { effort: "minimal" } as const;

/**
 * One call's budget on this wire. Gemini takes about 5 s for a window and now
 * and then 14 s, so the 15 s Claude gets (STATS_TIMEOUT_MS) timed out good
 * reads. The route allows 30 s in all, and the loop has one call in flight at
 * a time, so a slow one only delays the next.
 */
export const OPENROUTER_TIMEOUT_MS = 25_000;

// =============================================================================

type Fetch = typeof fetch;

interface ChatReply {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
}

/** The request body. Exported so a test can read exactly what is sent. */
export function openRouterBody(request: ExtractStatsRequest) {
  return {
    model: OPENROUTER_STATS_MODEL,
    max_tokens: MAX_TOKENS,
    // No temperature: Gemini 3.8 does not take one, and with
    // require_parameters on, that leaves no provider (404).
    reasoning: REASONING,
    messages: [
      {
        role: "system",
        content: [
          { type: "text", text: STATS_SYSTEM_PROMPT },
          // Identical for the whole game, so it is cached; what follows moves every call.
          { type: "text", text: rostersForPrompt(request.rosters), cache_control: { type: "ephemeral" } },
        ],
      },
      { role: "user", content: volatileContent(request) },
    ],
    response_format: { type: "json_schema", json_schema: { name: "plays", strict: true, schema: STATS_SCHEMA } },
    // Only providers that keep nothing and do not train on it, or no answer.
    provider: { zdr: true, data_collection: "deny", require_parameters: true },
    usage: { include: true },
  };
}

/** HTTP statuses as the codes the live screen already knows. */
function failureFor(status: number): ExtractionError {
  if (status === 401) return new ExtractionError("claude_key_rejected");
  if (status === 402 || status === 403) return new ExtractionError("claude_no_model_access");
  // Also what OpenRouter says when no provider satisfies the data policy.
  if (status === 404) return new ExtractionError("claude_model_missing");
  if (status === 400 || status === 422) return new ExtractionError("claude_bad_request");
  if (status === 408 || status === 504) return new ExtractionError("claude_timeout");
  if (status === 429) return new ExtractionError("claude_rate_limited");
  if (status >= 500) return new ExtractionError("claude_overloaded");
  return new ExtractionError("unknown");
}

/**
 * Reads the finished plays out of one window of play-by-play with Gemini
 * through OpenRouter. Same contract as extractStatsPlays: a truncated or
 * unreadable answer is a bad window with no plays, never an error the live
 * screen learns about; a refusal or a transport failure is a code.
 */
export async function extractStatsPlaysOpenRouter(
  apiKey: string,
  request: ExtractStatsRequest,
  signal: AbortSignal,
  fetcher: Fetch = fetch,
): Promise<ExtractStatsResponse> {
  if (request.utterances.length === 0) return { plays: [], usage: NO_USAGE };

  let response: Response;
  try {
    response = await fetcher(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Spotter" },
      body: JSON.stringify(openRouterBody(request)),
      signal,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") throw new ExtractionError("claude_timeout");
    throw new ExtractionError("claude_unreachable");
  }

  if (!response.ok) throw failureFor(response.status);

  let reply: ChatReply;
  try {
    reply = (await response.json()) as ChatReply;
  } catch {
    console.error("[Spotter] Live stats came back from OpenRouter without JSON. No plays from this window.");
    return { plays: [], usage: NO_USAGE };
  }

  const usage = usageFromOpenRouter(reply.usage ?? {});
  const choice = reply.choices?.[0];

  if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new ExtractionError("claude_refused");
  // Not an error: the next window covers the same plays.
  if (choice?.finish_reason === "length") {
    console.error('[Spotter] Live stats stopped at the "max_tokens" cap. No plays from this window.');
    return { plays: [], usage };
  }

  const text = choice?.message?.content;
  if (typeof text !== "string" || text.length === 0) {
    console.error("[Spotter] Live stats came back with no text.");
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
