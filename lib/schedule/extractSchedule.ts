// Server only: imported by app/api/schedule/extract/route.ts and nothing else.
// OPENROUTER_API_KEY must never reach a client component.
import {
  chat,
  type ContentPart,
  imagePart,
  IMPORT_MODEL,
  type OpenRouterClient,
  pdfPart,
  type ReasoningEffort,
  textPart,
} from "@/lib/ai/openrouter";
import { ExtractionError, type ImageMediaType } from "@/lib/rosters/extractRoster";
import type { UsageSink } from "@/lib/usage/prices";
import { normalizeSchedule, type ExtractedSchedule, type NormalizedSchedule, type ScheduleContext } from "./normalize";
import { SCHEDULE_SCHEMA, SCHEDULE_SYSTEM_PROMPT, scheduleUserPrompt, type ScheduleTeam } from "./schedulePrompt";

// =============================================================================
// TUNING: the call that reads a team's schedule (Claude through OpenRouter,
// lib/ai/openrouter.ts: the same model and wire the roster import uses).
// =============================================================================

/** A season's schedule reads in seconds; a ten page PDF of a whole league may not. Stays under the route's maxDuration. */
export const SCHEDULE_TIMEOUT_MS = 120_000;

/** Eighty games at about sixty tokens each, the warnings, and the thinking. */
const MAX_TOKENS = 8_000;

/** Reading, not writing: the same effort as the roster and stats reads. */
const REASONING: ReasoningEffort = "low";

// =============================================================================

/**
 * Anything a schedule can be: a PDF (its pages, so the result and site columns
 * survive), screenshots or photos, or text (pasted, a saved web page, a .txt
 * file, or spreadsheet rows the browser turned into text).
 */
export type ScheduleSource =
  | { kind: "pdf"; base64: string }
  | { kind: "images"; images: Array<{ mediaType: ImageMediaType; base64: string }> }
  | { kind: "text"; text: string };

/**
 * One call over the material. A refusal or a cut-off answer surfaces as
 * itself, and no slice of the material reaches an error message.
 */
export async function extractSchedule(
  client: OpenRouterClient,
  source: ScheduleSource,
  team: ScheduleTeam,
  context: ScheduleContext,
  signal: AbortSignal,
  meter?: UsageSink,
): Promise<NormalizedSchedule & { outputTokens: number }> {
  const outcome = await chat(
    client,
    {
      model: IMPORT_MODEL,
      system: SCHEDULE_SYSTEM_PROMPT,
      content: scheduleContent(source, scheduleUserPrompt(team)),
      schema: SCHEDULE_SCHEMA,
      schemaName: "schedule",
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
  if (!isExtractedSchedule(raw)) throw new ExtractionError("bad_reply");

  return { ...normalizeSchedule(raw, context), outputTokens: outcome.usage.completion_tokens ?? 0 };
}

/** The schema's shape, checked again: the reply is trusted for nothing. */
function isExtractedSchedule(raw: unknown): raw is ExtractedSchedule {
  if (typeof raw !== "object" || raw === null) return false;
  const reply = raw as Partial<ExtractedSchedule>;
  return Array.isArray(reply.games) && reply.games.every((game) => typeof game === "object" && game !== null) && Array.isArray(reply.warnings);
}

/** The material first, then the instruction. */
export function scheduleContent(source: ScheduleSource, instruction: string): ContentPart[] {
  if (source.kind === "text") {
    return [textPart(`The material:\n\n${source.text}\n\n---\n\n${instruction}`)];
  }
  if (source.kind === "images") {
    return [...source.images.map((image) => imagePart(image.mediaType, image.base64)), textPart(instruction)];
  }
  return [pdfPart(source.base64), textPart(instruction)];
}
