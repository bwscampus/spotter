// Server only: imported by app/api/rosters/extract/route.ts and nothing else.
// ANTHROPIC_API_KEY must never reach a client component.
import Anthropic from "@anthropic-ai/sdk";
import { normalizeHex } from "@/lib/game/colors";
import type { UsageSink } from "@/lib/usage/prices";
import { extractFailure, type ExtractFailureCode } from "./extractErrors";
import { EXTRACTION_SYSTEM_PROMPT, ROSTER_SCHEMA, USER_PROMPTS } from "./extractionPrompt";
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
// TUNING: the Claude call that reads a roster.
// =============================================================================

export const EXTRACTION_MODEL = "claude-sonnet-5";

/**
 * Whole-request budget, shared by the text attempt and the PDF retry. Raised
 * from 60 s on the testrun branch, for college rosters of 130 and more, and
 * still inside the route's maxDuration of 150 s.
 */
export const EXTRACTION_TIMEOUT_MS = 140_000;

/** Below this much of the budget left, the PDF retry is skipped rather than started and cut off. */
export const MIN_RETRY_BUDGET_MS = 20_000;

/** Room for about 200 players (testrun: was 16,000, about 100). Anything longer comes back as a max_tokens error. */
const MAX_TOKENS = 32_000;

// =============================================================================

/**
 * An error carrying the code of the guard that fired, plus the status and
 * message the announcer should see. The code is what makes a failed upload
 * traceable: it reaches the browser, the terminal, and usage_events.
 */
export class ExtractionError extends Error {
  readonly code: ExtractFailureCode;
  readonly status: number;
  constructor(code: ExtractFailureCode, detail?: string | null) {
    const failure = extractFailure(code, detail);
    super(failure.message);
    this.name = "ExtractionError";
    this.code = failure.code;
    this.status = failure.status;
  }
}

/** Image types Claude reads. HEIC is converted to JPEG in the browser before it gets here. */
export const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * Everything a roster can be read from. Every format the import accepts ends
 * up as one of these three and goes through extractRoster, so there is one
 * prompt, one schema and one set of failure codes for all of them.
 *
 * text: a PDF's text layer, pasted text, or spreadsheet rows. `prompt` only
 * changes the one-line instruction that rides with it.
 * pdf: a PDF with no usable text layer. Claude reads its pages as images.
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

export function createAnthropicClient(apiKey: string, timeout = EXTRACTION_TIMEOUT_MS): Anthropic {
  // No retries: one attempt is one timeout, so the whole route stays inside its budget.
  return new Anthropic({ apiKey, timeout, maxRetries: 0 });
}

/**
 * Sends one roster to Claude and returns what it read.
 *
 * messages.create, not messages.parse: parse runs JSON.parse on the reply
 * before anything can look at stop_reason, so a refusal or a truncated answer
 * surfaces as a parser error instead of the real reason. It would also put a
 * slice of the model's output into the thrown message, and roster text must
 * never reach a log.
 */
export async function extractRoster(
  client: Anthropic,
  source: ExtractionSource,
  signal: AbortSignal,
  meter?: UsageSink,
): Promise<ExtractedRoster> {
  let response;
  try {
    response = await client.messages.create(
      {
        model: EXTRACTION_MODEL,
        max_tokens: MAX_TOKENS,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildContent(source) }],
        output_config: { format: { type: "json_schema", schema: ROSTER_SCHEMA } },
      },
      { signal },
    );
  } catch (error) {
    throw toExtractionError(error);
  }

  // Every reply is paid for, including the ones refused below (lib/usage/).
  meter?.add(EXTRACTION_MODEL, response.usage);

  if (response.stop_reason === "max_tokens") {
    throw new ExtractionError("roster_too_long");
  }
  if (response.stop_reason === "refusal") {
    throw new ExtractionError("claude_refused");
  }

  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new ExtractionError("bad_reply");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Deliberately no detail: the parser's message would quote the roster.
    throw new ExtractionError("bad_reply");
  }

  return normalizeRoster(raw);
}

export function buildContent(source: ExtractionSource): Anthropic.ContentBlockParam[] {
  if (source.kind === "text") {
    return [{ type: "text", text: `${USER_PROMPTS[source.prompt]}\n\n${source.text}` }];
  }
  if (source.kind === "images") {
    return [
      ...source.images.map(
        (image): Anthropic.ContentBlockParam => ({
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.base64 },
        }),
      ),
      { type: "text", text: USER_PROMPTS.image },
    ];
  }
  return [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: source.base64 },
    },
    { type: "text", text: USER_PROMPTS.pdf },
  ];
}

/** Maps SDK failures onto guard codes. Never logs or echoes the uploaded file. */
export function toExtractionError(error: unknown): ExtractionError {
  if (error instanceof ExtractionError) return error;
  if (error instanceof Anthropic.AuthenticationError) return new ExtractionError("claude_key_rejected");
  if (error instanceof Anthropic.PermissionDeniedError) return new ExtractionError("claude_no_model_access");
  if (error instanceof Anthropic.NotFoundError) {
    return new ExtractionError("claude_model_missing", withReason("claude_model_missing", error));
  }
  if (error instanceof Anthropic.RateLimitError) return new ExtractionError("claude_rate_limited");
  if (error instanceof Anthropic.BadRequestError) {
    // The only failure where Anthropic's own words help: a 400 describes the
    // shape of the request Spotter sent (a parameter this account cannot use,
    // a model that does not take PDFs), never the document inside it.
    return new ExtractionError("claude_bad_request", withReason("claude_bad_request", error));
  }
  // The only signal the route passes is its own timeout, so an abort is one.
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) {
    return new ExtractionError("claude_timeout");
  }
  if (error instanceof Anthropic.APIConnectionError) return new ExtractionError("claude_unreachable");
  if (error instanceof Anthropic.InternalServerError) return new ExtractionError("claude_overloaded");
  return new ExtractionError("unknown");
}

/** How much of Anthropic's reason to repeat. Long enough to name the parameter at fault. */
const MAX_REASON_LENGTH = 200;

/** "<stock message> Anthropic said: <reason>", or just the stock message when there is none. */
function withReason(code: ExtractFailureCode, error: { error?: unknown }): string | null {
  const body = error.error as { error?: { message?: unknown } } | undefined;
  const reason = body?.error?.message;
  if (typeof reason !== "string" || reason.trim().length === 0) return null;
  return `${extractFailure(code).message} Anthropic said: ${reason.trim().slice(0, MAX_REASON_LENGTH)}`;
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
    players.push({
      jersey: textOrNull(entry.jersey),
      first_name: textOrNull(entry.first_name),
      last_name: lastName,
      position: textOrNull(entry.position),
      grade: textOrNull(entry.grade),
      height: textOrNull(entry.height),
      weight: textOrNull(entry.weight),
      // Claude is never asked to guess a pronunciation. The announcer types it.
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
      // Claude's read of the team colour (Jed, Oct 8). Only a real #rrggbb counts.
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
