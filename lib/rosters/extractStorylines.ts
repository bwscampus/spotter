// Server only: imported by app/api/storylines/extract/route.ts and nothing else.
// OPENROUTER_API_KEY must never reach a client component.
import {
  chat,
  imagePart,
  pdfPart,
  textPart,
  type ContentPart,
  type OpenRouterClient,
  type ReasoningEffort,
} from "@/lib/ai/openrouter";
import type { UsageSink } from "@/lib/usage/prices";
import { ExtractionError, type ImageMediaType } from "./extractRoster";
import { STORYLINES_SCHEMA, STORYLINES_SYSTEM_PROMPT, storylinesUserPrompt } from "./storylinePrompt";
import { normalizeStorylines, type StorylinePlayer, type StorylineSuggestion } from "./storylines";

// =============================================================================
// TUNING: the call that reads "Other info" for storylines (Gemini through
// OpenRouter, lib/ai/openrouter.ts).
// =============================================================================

/** An article or a box score reads in well under this; a ten page PDF of notes may not. Stays under the route's maxDuration. */
export const STORYLINES_TIMEOUT_MS = 120_000;

/** Room for a short line on every player of a big roster, the notes, and the thinking. */
const MAX_TOKENS = 12_000;

/** Unlike the roster and stats reads, this one writes: it picks what is worth saying about a player. */
const REASONING: ReasoningEffort = "medium";

// =============================================================================

/**
 * Anything "Other info" can be: a PDF (its pages, so a box score's columns
 * survive), screenshots or photos, or text (pasted, a .txt file, or spreadsheet
 * rows the browser turned into text).
 */
export type StorylineSource =
  | { kind: "pdf"; base64: string }
  | { kind: "images"; images: Array<{ mediaType: ImageMediaType; base64: string }> }
  | { kind: "text"; text: string };

/**
 * One call over the material and the roster. A refusal or a cut-off answer
 * surfaces as itself, and no slice of the material reaches an error message.
 */
export async function extractStorylines(
  client: OpenRouterClient,
  source: StorylineSource,
  players: readonly StorylinePlayer[],
  teamName: string | null,
  signal: AbortSignal,
  meter?: UsageSink,
): Promise<{ suggestions: StorylineSuggestion[]; notes: string[]; outputTokens: number }> {
  const outcome = await chat(
    client,
    {
      system: STORYLINES_SYSTEM_PROMPT,
      content: storylineContent(source, storylinesUserPrompt(players, teamName)),
      schema: STORYLINES_SCHEMA,
      schemaName: "storylines",
      maxTokens: MAX_TOKENS,
      reasoning: REASONING,
    },
    signal,
    meter,
  );

  if (outcome.kind === "length") throw new ExtractionError("roster_too_long");
  if (outcome.kind === "empty") throw new ExtractionError("bad_reply");

  let raw: unknown;
  try {
    raw = JSON.parse(outcome.text);
  } catch {
    // Deliberately no detail: the parser's message would quote the reply.
    throw new ExtractionError("bad_reply");
  }

  return { ...normalizeStorylines(raw, players), outputTokens: outcome.usage.completion_tokens ?? 0 };
}

/** The material first, then the instruction and the roster. */
export function storylineContent(source: StorylineSource, instruction: string): ContentPart[] {
  if (source.kind === "text") {
    return [textPart(`The material:\n\n${source.text}\n\n---\n\n${instruction}`)];
  }
  if (source.kind === "images") {
    return [...source.images.map((image) => imagePart(image.mediaType, image.base64)), textPart(instruction)];
  }
  return [pdfPart(source.base64), textPart(instruction)];
}
