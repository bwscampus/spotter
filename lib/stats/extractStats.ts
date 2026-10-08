// Server only: imported by app/api/stats/extract/route.ts and nothing else.
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
import {
  cleanFootballStats,
  FOOTBALL_KEY_GROUPS,
  FOOTBALL_STAT_KEYS,
  isEmptyStats,
  isFootballStatKey,
  type FootballStatKey,
  type FootballStats,
} from "@/lib/cards/statKeys";
import { ExtractionError, type ImageMediaType } from "@/lib/rosters/extractRoster";
import {
  FOOTBALL_STATS_SYSTEM_PROMPT,
  footballStatsSchema,
  footballStatsUserPrompt,
  MAX_STAT_LINES,
  MAX_STAT_LINE_LENGTH,
  STATS_SCHEMA,
  STATS_SYSTEM_PROMPT,
  STATS_USER_PROMPT,
  rosterForPrompt,
} from "./statsPrompt";
import { rowKey } from "./matchStats";
import type { LineBlock, NumberBlock, StatsKind } from "./types";

// =============================================================================
// TUNING: the call that reads a stats sheet (Gemini through OpenRouter,
// lib/ai/openrouter.ts).
// =============================================================================

/**
 * Longer than a roster's budget on purpose. A stats sheet is several pages of
 * dense tables read as images, and one real seven page sheet took 57 seconds.
 * The roster's 60 would have cut a ten page sheet off. Stays under the route's
 * maxDuration.
 */
export const STATS_TIMEOUT_MS = 120_000;

/**
 * Copying numbers off a page is not a reasoning problem, and thinking time is
 * the difference between a sheet that reads in time and one that does not.
 */
const STATS_EFFORT: ReasoningEffort = "low";

/** Room for a long roster's worth of numbers, and the thinking, which counts against the same cap. */
const MAX_TOKENS = 16_000;

// =============================================================================

export type ExtractedStats =
  | { kind: "numbers"; blocks: NumberBlock[]; warnings: string[] }
  | { kind: "lines"; blocks: LineBlock[]; warnings: string[] };

export interface RosterForStats {
  jersey: string | null;
  first_name: string | null;
  last_name: string;
}

/**
 * Everything a stats sheet can be read from, one per import format.
 *
 * pdf: the PDF itself, as a document block. Never its text layer: a stats
 * table's meaning is in its columns, and extracting the text drops the empty
 * cells that keep them aligned ("0 R. Sullivan (Sr) 4 2 0" against an eleven
 * column header is unalignable). Sent as a file, the model reads the page
 * images, where the columns still line up.
 * images: screenshots or photos of the sheet.
 * text: pasted text, or spreadsheet rows the browser turned into text. Both
 * keep their empty cells, so the columns survive.
 */
export type StatsSource =
  | { kind: "pdf"; base64: string }
  | { kind: "images"; images: Array<{ mediaType: ImageMediaType; base64: string }> }
  | { kind: "text"; text: string };

/** How the calls went, as counts. Logged by the route; never any content. */
export interface StatsUsage {
  calls: number;
  outputTokens: number;
}

/**
 * Sends one stats sheet to the model and returns numbers (football) or lines
 * (every other sport).
 *
 * Football is read in parallel, one call per group of keys (offense, defense,
 * special teams), because one call writing every player's every number took
 * longer than the route allows on a real seven page MaxPreps sheet. Each call
 * reads the same sheet and fills only its own keys, so the wait is the slowest
 * third rather than the whole. The pieces are joined by player afterwards.
 */
export async function extractStats(
  client: OpenRouterClient,
  source: StatsSource,
  roster: RosterForStats[],
  kind: StatsKind,
  signal: AbortSignal,
  meter?: UsageSink,
): Promise<ExtractedStats & { usage: StatsUsage }> {
  const rosterText = rosterForPrompt(roster);

  if (kind === "lines") {
    const { raw, outputTokens } = await readOnce(client, {
      system: STATS_SYSTEM_PROMPT,
      content: statsContent(source, `${STATS_USER_PROMPT}\n\n${rosterText}`),
      schema: STATS_SCHEMA,
      signal,
      meter,
    });
    return { ...normalizeLines(raw), usage: { calls: 1, outputTokens } };
  }

  // One failed group fails the import, and stops the others rather than
  // paying for answers that will be thrown away.
  const stop = new AbortController();
  const shared = AbortSignal.any([signal, stop.signal]);
  let results;
  try {
    results = await Promise.all(
      FOOTBALL_KEY_GROUPS.map(async (group) => {
        const { raw, outputTokens } = await readOnce(client, {
          system: FOOTBALL_STATS_SYSTEM_PROMPT,
          content: statsContent(source, `${footballStatsUserPrompt(group)}\n\n${rosterText}`),
          schema: footballStatsSchema(group.keys),
          signal: shared,
          meter,
        });
        return { read: normalizeNumbers(raw, group.keys), outputTokens };
      }),
    );
  } catch (error) {
    stop.abort();
    throw error;
  }

  const merged = mergeNumberReads(results.map((result) => result.read));
  const outputTokens = results.reduce((sum, result) => sum + result.outputTokens, 0);
  return { ...merged, usage: { calls: results.length, outputTokens } };
}

/** One call, parsed. Every failure becomes a guard code; nothing from the sheet reaches an error. */
async function readOnce(
  client: OpenRouterClient,
  request: {
    system: string;
    content: ContentPart[];
    schema: Record<string, unknown>;
    signal: AbortSignal;
    /** Told about every reply, the refused ones too, so the route can record the cost (lib/usage/). */
    meter?: UsageSink;
  },
): Promise<{ raw: unknown; outputTokens: number }> {
  const outcome = await chat(
    client,
    {
      system: request.system,
      content: request.content,
      schema: request.schema,
      schemaName: "stats",
      maxTokens: MAX_TOKENS,
      reasoning: STATS_EFFORT,
    },
    request.signal,
    request.meter,
  );

  if (outcome.kind === "length") throw new ExtractionError("roster_too_long");
  if (outcome.kind === "empty") throw new ExtractionError("bad_reply");

  try {
    return { raw: JSON.parse(outcome.text), outputTokens: outcome.usage.completion_tokens ?? 0 };
  } catch {
    // Deliberately no detail: the parser's message would quote the sheet.
    throw new ExtractionError("bad_reply");
  }
}

/**
 * Joins the groups' reads into one block per player. The keys are disjoint by
 * construction, so nothing is summed or chosen between; if a key did appear
 * twice the first read wins. Warnings are kept once each, in order.
 */
export function mergeNumberReads(reads: Array<Extract<ExtractedStats, { kind: "numbers" }>>): Extract<ExtractedStats, { kind: "numbers" }> {
  const byRow = new Map<string, NumberBlock>();
  for (const read of reads) {
    for (const block of read.blocks) {
      const key = rowKey(block);
      const existing = byRow.get(key);
      if (existing) existing.stats = { ...block.stats, ...existing.stats };
      else byRow.set(key, { ...block, stats: { ...block.stats } });
    }
  }
  const warnings = [...new Set(reads.flatMap((read) => read.warnings))];
  return { kind: "numbers", blocks: [...byRow.values()], warnings };
}

/** The sheet first, then the instruction and the roster. */
export function statsContent(source: StatsSource, instruction: string): ContentPart[] {
  if (source.kind === "text") {
    return [textPart(`${instruction}\n\nThe stats sheet:\n\n${source.text}`)];
  }
  if (source.kind === "images") {
    return [...source.images.map((image) => imagePart(image.mediaType, image.base64)), textPart(instruction)];
  }
  return [pdfPart(source.base64), textPart(instruction)];
}

/**
 * Trusts the schema for shape but not for content. A key outside the 9.2 list
 * or a value that is not a finite number is dropped, the same rule the
 * database applies, and a player left with nothing but zeros is skipped.
 */
export function normalizeNumbers(
  raw: unknown,
  allowed: readonly FootballStatKey[] = FOOTBALL_STAT_KEYS,
): Extract<ExtractedStats, { kind: "numbers" }> {
  if (!isRecord(raw)) throw new ExtractionError("bad_reply");

  const blocks: NumberBlock[] = [];
  for (const entry of Array.isArray(raw.players) ? raw.players : []) {
    if (!isRecord(entry)) continue;
    const lastName = textOrNull(entry.last_name);
    if (!lastName) continue;

    const pairs: Record<string, number> = {};
    for (const pair of Array.isArray(entry.stats) ? entry.stats : []) {
      // A key from another group's sections is that call's to read, not this one's.
      if (!isRecord(pair) || !isFootballStatKey(pair.key) || !allowed.includes(pair.key)) continue;
      // The first value for a key wins: a second would be a column misread.
      if (pair.key in pairs) continue;
      if (typeof pair.value === "number" && Number.isFinite(pair.value)) pairs[pair.key] = pair.value;
    }
    const stats: FootballStats | null = cleanFootballStats(pairs);
    if (!stats || isEmptyStats(stats)) continue;

    blocks.push({ jersey: textOrNull(entry.jersey), last_name: lastName, stats });
  }

  return { kind: "numbers", blocks, warnings: readWarnings(raw) };
}

/**
 * The line caps are enforced here rather than asked for in the prompt alone,
 * because a line too long for the card is a layout problem the announcer would
 * meet live.
 */
export function normalizeLines(raw: unknown): ExtractedStats {
  if (!isRecord(raw)) throw new ExtractionError("bad_reply");

  const blocks: LineBlock[] = [];
  for (const entry of Array.isArray(raw.players) ? raw.players : []) {
    if (!isRecord(entry)) continue;
    const lastName = textOrNull(entry.last_name);
    if (!lastName) continue;

    const lines = (Array.isArray(entry.lines) ? entry.lines : [])
      .map((line) => textOrNull(line))
      .filter((line): line is string => line !== null)
      .map((line) => line.slice(0, MAX_STAT_LINE_LENGTH).trim())
      .slice(0, MAX_STAT_LINES);

    // A player with nothing to say about them is not worth a card entry.
    if (lines.length === 0) continue;

    blocks.push({ jersey: textOrNull(entry.jersey), last_name: lastName, lines });
  }

  return { kind: "lines", blocks, warnings: readWarnings(raw) };
}

function readWarnings(raw: Record<string, unknown>): string[] {
  return (Array.isArray(raw.warnings) ? raw.warnings : [])
    .map((warning) => textOrNull(warning))
    .filter((warning): warning is string => warning !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
