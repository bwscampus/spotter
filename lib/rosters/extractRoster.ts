// Server only: imported by app/api/rosters/extract/route.ts and nothing else.
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
import { normalizeHex } from "@/lib/game/colors";
import type { UsageSink } from "@/lib/usage/prices";
import { ExtractionError } from "./extractErrors";
import { EXTRACTION_SYSTEM_PROMPT, ROSTER_SCHEMA, USER_PROMPTS } from "./extractionPrompt";
import { withoutSuffix } from "./suffix";
import {
  CLAUDE_FLAGS,
  isGender,
  isLevel,
  isSport,
  type PlayerFlag,
  type RosterPlayer,
  type RosterTeam,
} from "./types";

// =============================================================================
// TUNING: the call that reads a roster (Claude through OpenRouter,
// lib/ai/openrouter.ts).
// =============================================================================

/**
 * Whole-request budget, shared by the text attempt and the PDF retry. Raised
 * from 60 s on the testrun branch, for college rosters of 130 and more, and
 * still inside the route's maxDuration of 150 s.
 */
export const EXTRACTION_TIMEOUT_MS = 140_000;

/** Below this much of the budget left, the PDF retry is skipped rather than started and cut off. */
export const MIN_RETRY_BUDGET_MS = 20_000;

/**
 * Room for about 200 players, plus what the model spends thinking, which
 * counts against the same cap on this wire. Anything longer is roster_too_long.
 */
const MAX_TOKENS = 32_000;

/** Copying names off a page is not a reasoning problem. */
const REASONING: ReasoningEffort = "low";

// =============================================================================

export { ExtractionError };

/** Image types the model reads. HEIC is converted to JPEG in the browser before it gets here. */
export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * Everything a roster can be read from. Every format the import accepts ends
 * up as one of these three and goes through extractRoster, so there is one
 * prompt, one schema and one set of failure codes for all of them.
 *
 * text: a PDF's text layer, pasted text, or spreadsheet rows. `prompt` only
 * changes the one-line instruction that rides with it.
 * pdf: a PDF with no usable text layer. The model reads its pages as images.
 * images: screenshots or photos, up to MAX_IMAGES.
 */
export type ExtractionSource =
  | { kind: "text"; text: string; prompt: "pdf_text" | "text" | "table" }
  | { kind: "pdf"; base64: string }
  | { kind: "images"; images: Array<{ mediaType: ImageMediaType; base64: string }> };

export interface ExtractedRoster {
  team: RosterTeam;
  players: RosterPlayer[];
  warnings: string[];
}

/**
 * Sends one roster to the model and returns what it read. A refusal, a reply
 * cut off at max_tokens and an unreadable reply each have their own code, and
 * no slice of the reply reaches an error or a log: roster text never does.
 */
export async function extractRoster(
  client: OpenRouterClient,
  source: ExtractionSource,
  signal: AbortSignal,
  meter?: UsageSink,
): Promise<ExtractedRoster> {
  const outcome = await chat(
    client,
    {
      model: IMPORT_MODEL,
      system: EXTRACTION_SYSTEM_PROMPT,
      content: buildContent(source),
      schema: ROSTER_SCHEMA,
      schemaName: "roster",
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
    // Deliberately no detail: the parser's message would quote the roster.
    throw new ExtractionError("bad_reply");
  }

  return normalizeRoster(raw);
}

export function buildContent(source: ExtractionSource): ContentPart[] {
  if (source.kind === "text") {
    return [textPart(`${USER_PROMPTS[source.prompt]}\n\n${source.text}`)];
  }
  if (source.kind === "images") {
    return [...source.images.map((image) => imagePart(image.mediaType, image.base64)), textPart(USER_PROMPTS.image)];
  }
  return [pdfPart(source.base64), textPart(USER_PROMPTS.pdf)];
}

/** Anything thrown on the way as a guard code. Never logs or echoes the uploaded file. */
export function toExtractionError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  const name = error instanceof Error ? error.name : "";
  // The only signal the routes pass is their own timeout, so an abort is one.
  if (name === "AbortError" || name === "TimeoutError") return new ExtractionError("claude_timeout");
  return new ExtractionError("unknown");
}

/**
 * Trusts the schema for shape but not for content: enum casing is not
 * guaranteed, and a flag outside the fixed set would confuse the review screen.
 */
function normalizeRoster(raw: unknown): ExtractedRoster {
  if (!isRecord(raw)) throw new ExtractionError("bad_reply");

  const team = isRecord(raw.team) ? raw.team : {};
  const sport = lowerOrNull(team.sport);
  const gender = lowerOrNull(team.gender);
  const level = lowerOrNull(team.level);

  const players: RosterPlayer[] = [];
  for (const entry of Array.isArray(raw.players) ? raw.players : []) {
    if (!isRecord(entry)) continue;
    const lastName = textOrNull(entry.last_name);
    if (!lastName) continue;
    // A suffix is not part of the surname: "Bates III" is saved as "Bates".
    const names = withoutSuffix(textOrNull(entry.first_name), lastName);
    players.push({
      jersey: textOrNull(entry.jersey),
      first_name: names.first_name,
      last_name: names.last_name,
      position: textOrNull(entry.position),
      grade: textOrNull(entry.grade),
      height: textOrNull(entry.height),
      weight: textOrNull(entry.weight),
      // The model is never asked to guess a pronunciation. The announcer types it.
      pronunciations: [],
      // The editor applies the offensive-line default once it knows the sport.
      spot_mode: "normal",
      flags: readFlags(entry.flags),
    });
  }

  const warnings = (Array.isArray(raw.warnings) ? raw.warnings : [])
    .map((warning) => textOrNull(warning))
    .filter((warning): warning is string => warning !== null);

  return {
    team: {
      school: textOrNull(team.school),
      mascot: textOrNull(team.mascot),
      sport: isSport(sport) ? sport : null,
      gender: isGender(gender) ? gender : null,
      level: isLevel(level) ? level : null,
      season: textOrNull(team.season),
      // The model's read of the team colour (Jed, Oct 8). Only a real #rrggbb counts.
      color: typeof team.color === "string" ? normalizeHex(team.color) : null,
    },
    players,
    warnings,
  };
}

function readFlags(value: unknown): PlayerFlag[] {
  if (!Array.isArray(value)) return [];
  const flags: PlayerFlag[] = [];
  for (const entry of value) {
    const flag = lowerOrNull(entry);
    if (flag && (CLAUDE_FLAGS as string[]).includes(flag) && !flags.includes(flag as PlayerFlag)) {
      flags.push(flag as PlayerFlag);
    }
  }
  return flags;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function lowerOrNull(value: unknown): string | null {
  return textOrNull(value)?.toLowerCase() ?? null;
}
