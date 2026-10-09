// Server only: imported by app/api/storylines/extract/route.ts and nothing else.
// ANTHROPIC_API_KEY must never reach a client component.
import type Anthropic from "@anthropic-ai/sdk";
import type { UsageSink } from "@/lib/usage/prices";
import { ExtractionError, toExtractionError, type ImageMediaType } from "./extractWithClaude";
import { STORYLINES_SCHEMA, STORYLINES_SYSTEM_PROMPT, storylinesUserPrompt } from "./storylinePrompt";
import { normalizeStorylines, type StorylinePlayer, type StorylineSuggestion } from "./storylines";

// =============================================================================
// TUNING: the Claude call that reads "Other info" for storylines.
// =============================================================================

export const STORYLINES_MODEL = "claude-sonnet-5";

/** An article or a box score reads in well under this; a ten page PDF of notes may not. Stays under the route's maxDuration. */
export const STORYLINES_TIMEOUT_MS = 120_000;

/** Room for a short line on every player of a big roster, and the notes. */
const MAX_TOKENS = 12_000;

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
 * One Claude call over the material and the roster. messages.create rather
 * than parse, for the same reason as extractRoster: a refusal or a cut-off
 * answer must surface as itself, and no slice of the material may reach an
 * error message.
 */
export async function extractStorylines(
  client: Anthropic,
  source: StorylineSource,
  players: readonly StorylinePlayer[],
  teamName: string | null,
  signal: AbortSignal,
  meter?: UsageSink,
): Promise<{ suggestions: StorylineSuggestion[]; notes: string[]; outputTokens: number }> {
  let response;
  try {
    response = await client.messages.create(
      {
        model: STORYLINES_MODEL,
        max_tokens: MAX_TOKENS,
        system: STORYLINES_SYSTEM_PROMPT,
        messages: [{ role: "user", content: storylineContent(source, storylinesUserPrompt(players, teamName)) }],
        output_config: { format: { type: "json_schema", schema: STORYLINES_SCHEMA } },
      },
      { signal },
    );
  } catch (error) {
    throw toExtractionError(error);
  }

  meter?.add(STORYLINES_MODEL, response.usage);

  if (response.stop_reason === "max_tokens") throw new ExtractionError("roster_too_long");
  if (response.stop_reason === "refusal") throw new ExtractionError("claude_refused");

  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new ExtractionError("bad_reply");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Deliberately no detail: the parser's message would quote the reply.
    throw new ExtractionError("bad_reply");
  }

  return { ...normalizeStorylines(raw, players), outputTokens: response.usage?.output_tokens ?? 0 };
}

/** The material first, then the instruction and the roster, the order Claude reads documents best in. */
export function storylineContent(source: StorylineSource, instruction: string): Anthropic.ContentBlockParam[] {
  if (source.kind === "text") {
    return [{ type: "text", text: `The material:\n\n${source.text}\n\n---\n\n${instruction}` }];
  }
  if (source.kind === "images") {
    return [
      ...source.images.map(
        (image): Anthropic.ContentBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.base64 },
        }),
      ),
      { type: "text", text: instruction },
    ];
  }
  return [
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: source.base64 } },
    { type: "text", text: instruction },
  ];
}
