// Server only: the one wire every model call goes over. Imported by the
// extraction code behind the paid routes (rosters, stats, storylines, live
// stats) and the replay harness, and nothing else. OPENROUTER_API_KEY must
// never reach a client component.
import { ExtractionError } from "@/lib/rosters/extractErrors";
import type { UsageSink } from "@/lib/usage/prices";

// =============================================================================
// Every model call goes through OpenRouter, the one key (Jed, Oct 8). Live
// stats moved first, on Oct 5, to Gemini, because Sonnet cost about $1 a game.
// The imports came over the same day as Gemini, then went to Claude on this
// wire ("only use the OpenRouter key but an Anthropic model"): see IMPORT_MODEL.
// Since Oct 10 live stats is Claude too (Haiku 5.5): no call goes to Gemini.
//
// PRIVACY: rosters, stats sheets and transcripts name minors. Every request
// tells OpenRouter to route only to providers that keep nothing (zdr) and do
// not collect or train on prompts (data_collection: deny). If no provider
// matches, the call fails rather than going somewhere that does. Nothing in
// the request or the reply is stored or logged; a failure is its code.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Roster, season stats and storyline imports: Claude through OpenRouter (Jed,
 * Oct 8: "only use the OpenRouter key but an Anthropic model"). Gemini read
 * them from Oct 8 until a 7-page stats PDF failed twice, and there is no
 * Anthropic key in Railway any more, so Claude comes over this wire too.
 */
export const IMPORT_MODEL = "anthropic/claude-sonnet-5";

/**
 * Live stats: Claude Haiku 5.5 (Jed, Oct 10: "switch all gemini calls to
 * claude haiku 5.5"). Gemini 3.8 Flash read the plays from Oct 5, when Sonnet
 * cost about $1 a game; Haiku 5.5 is $0.10 in and $0.50 out per million
 * tokens, under Gemini's $0.75 and $3.75.
 */
export const LIVE_STATS_MODEL = "anthropic/claude-haiku-5.5";

// =============================================================================

/**
 * How hard the model may think, as OpenRouter's reasoning.effort. Claude's
 * levels start at "low"; "minimal" was Gemini 3.8's least (it would not run
 * with thinking off) and no caller sends it now. Thinking bills as output and
 * counts against max_tokens on this wire.
 */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export type ContentPart =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export function textPart(text: string): ContentPart {
  return { type: "text", text };
}

export function imagePart(mediaType: string, base64: string): ContentPart {
  return { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } };
}

/** A PDF, which the model reads natively, page images included, so a table's columns survive. */
export function pdfPart(base64: string): ContentPart {
  return { type: "file", file: { filename: "upload.pdf", file_data: `data:application/pdf;base64,${base64}` } };
}

export interface ChatRequest {
  /** IMPORT_MODEL or LIVE_STATS_MODEL. */
  model: string;
  system: string | ContentPart[];
  content: string | ContentPart[];
  /** A strict JSON schema: every object closed, every property required. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxTokens: number;
  reasoning: ReasoningEffort;
}

/** The usage block of an OpenRouter reply, as far as cost goes. */
export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** What OpenRouter charged, in dollars. */
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
}

export interface ChatReply {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  usage?: OpenRouterUsage;
}

/**
 * How one call ended. `text` is the model's JSON, unparsed; the callers decide
 * what a cut-off or empty answer means, because live stats shrugs one off and
 * an import fails on it.
 */
export type ChatOutcome =
  | { kind: "text"; text: string; usage: OpenRouterUsage }
  | { kind: "length"; usage: OpenRouterUsage }
  | { kind: "empty"; usage: OpenRouterUsage };

export interface OpenRouterClient {
  apiKey: string;
  fetch: typeof fetch;
}

export function createOpenRouterClient(apiKey: string, fetcher: typeof fetch = fetch): OpenRouterClient {
  return { apiKey, fetch: fetcher };
}

/** The request body. Exported so a test can read exactly what is sent. */
export function chatBody(request: ChatRequest) {
  const hasPdf = Array.isArray(request.content) && request.content.some((part) => part.type === "file");
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    // No temperature: Claude with thinking on does not take one, and with
    // require_parameters on, that leaves no provider (404).
    reasoning: { effort: request.reasoning },
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: request.schemaName, strict: true, schema: request.schema },
    },
    // A PDF goes to the model as itself, never through OpenRouter's own text
    // or OCR parsers: a stats table's meaning is in its columns.
    ...(hasPdf ? { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] } : {}),
    // Only providers that keep nothing and do not train on it, or no answer.
    provider: { zdr: true, data_collection: "deny", require_parameters: true },
    usage: { include: true },
  };
}

/** HTTP statuses as the codes the import panels and the live screen already know. */
export function failureFor(status: number): ExtractionError {
  if (status === 401) return new ExtractionError("claude_key_rejected");
  if (status === 402 || status === 403) return new ExtractionError("claude_no_model_access");
  // Also what OpenRouter says when no provider satisfies the data policy.
  if (status === 404) return new ExtractionError("claude_model_missing");
  if (status === 400 || status === 413 || status === 422) return new ExtractionError("claude_bad_request");
  if (status === 408 || status === 504) return new ExtractionError("claude_timeout");
  if (status === 429) return new ExtractionError("claude_rate_limited");
  if (status >= 500) return new ExtractionError("claude_overloaded");
  return new ExtractionError("unknown");
}

/**
 * One call. Transport failures, HTTP errors and refusals throw an
 * ExtractionError with a code; nothing from the request or the reply goes in
 * it. `meter`, when given, is told about every reply that arrives, the refused
 * and cut-off ones too, because those are paid for.
 */
export async function chat(
  client: OpenRouterClient,
  request: ChatRequest,
  signal: AbortSignal,
  meter?: UsageSink,
): Promise<ChatOutcome> {
  let response: Response;
  try {
    response = await client.fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${client.apiKey}`, "Content-Type": "application/json", "X-Title": "Spotter" },
      body: JSON.stringify(chatBody(request)),
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
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") throw new ExtractionError("claude_timeout");
    return { kind: "empty", usage: {} };
  }

  const usage = reply.usage ?? {};
  meter?.add(usage);

  const choice = reply.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === "content_filter") throw new ExtractionError("claude_refused");
  if (choice?.finish_reason === "length") return { kind: "length", usage };

  const text = choice?.message?.content;
  if (typeof text !== "string" || text.length === 0) return { kind: "empty", usage };
  return { kind: "text", text, usage };
}
