import { requireVerifiedUser } from "@/lib/server/auth";
import { isSameOrigin } from "@/lib/server/request";
import {
  createAnthropicClient,
  EXTRACTION_TIMEOUT_MS,
  ExtractionError,
  toExtractionError,
} from "@/lib/rosters/extractWithClaude";
import {
  extractFailure,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_PDF_BYTES,
  MULTIPART_SLACK_BYTES,
  type ExtractFailureCode,
} from "@/lib/rosters/extractErrors";
import { noPlayersMessage } from "@/lib/rosters/noPlayers";
import { readRoster } from "@/lib/rosters/readRoster";
import { readUpload, type RosterUpload } from "@/lib/rosters/readUpload";
import type { ExtractResponse } from "@/lib/rosters/types";
import { readFormBody } from "@/lib/usage/body";
import { UsageMeter } from "@/lib/usage/prices";
import { beginUsage, finishUsage } from "@/lib/server/usage";

// The limits live in lib/rosters/extractErrors.ts, next to the message each one
// produces, so a limit and the sentence explaining it cannot drift apart.

// Two Claude calls plus parsing. The route's own budget is EXTRACTION_TIMEOUT_MS.
export const maxDuration = 150;

const NO_STORE = { "Cache-Control": "no-store" };

/** The largest body any format can legitimately send. */
const MAX_BODY_BYTES = Math.max(MAX_PDF_BYTES, MAX_IMAGES * MAX_IMAGE_BYTES) + MULTIPART_SLACK_BYTES;

/**
 * Reads a roster in any of the four formats (docs/V3_DEFINITION.md 6.2) and
 * returns the players on it for the review screen. Saving is a separate step,
 * in the browser, through save_roster.
 *
 * Every way this can fail has its own code, returned to the browser with the
 * message and logged here as one line naming the check. Analytics are the
 * browser's job (prep.import_finished), so this route records nothing.
 *
 * PRIVACY: the upload is parsed in memory and dropped when this function
 * returns. Nothing is written to disk or to the database, and neither the bytes,
 * the text, nor Claude's reply is ever logged. Only the call's token counts
 * and estimated cost are recorded, in public.usage (lib/usage/).
 */
export async function POST(request: Request) {
  // Only Spotter's own page may import, not another site open in the browser.
  if (!isSameOrigin(request)) return fail("cross_origin");

  // Reading a roster is Anthropic time: signed-in accounts only.
  const gate = await requireVerifiedUser();
  if (!gate.ok) return gate.response;

  // A few imports a minute at most, so many a day, and the dollar caps
  // (public.usage_begin). A refusal is a 429 the import panel shows as it is.
  const usage = await beginUsage(gate.user.id, "roster_import");
  if (!usage.ok) return usage.response;

  // Every Claude reply, failed ones included, is added up here and recorded.
  const meter = new UsageMeter();
  let response: Response | null = null;
  try {
    response = await importRoster(request, meter);
    return response;
  } finally {
    const spent = meter.usage;
    await finishUsage(gate.user.id, usage.ticket, {
      ok: response?.ok ?? false,
      provider: "anthropic",
      inputTokens: spent.inputTokens,
      outputTokens: spent.outputTokens,
      cachedTokens: spent.cachedTokens,
      costUsd: spent.costUsd,
    });
  }
}

async function importRoster(request: Request, meter: UsageMeter): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return fail("missing_key");

  // Read into a capped buffer, counting real bytes, then parsed: a body that
  // leaves out content-length is held to the same limit.
  const body = await readFormBody(request, MAX_BODY_BYTES);
  if (body.kind === "too_large") return fail("too_large");
  if (body.kind !== "ok") return fail("unreadable_upload");

  let upload: RosterUpload;
  try {
    upload = await readUpload(body.value);
  } catch (error) {
    if (error instanceof ExtractionError) return fail(error.code, error.message);
    // Almost always the body being cut short in transit.
    return fail("unreadable_upload");
  }

  const client = createAnthropicClient(apiKey);
  const signal = AbortSignal.timeout(EXTRACTION_TIMEOUT_MS);

  try {
    const { roster, route, pages } = await readRoster(client, upload, signal, meter);

    // Nobody on it. The review screen would open on an empty table with
    // nothing to say, so name the outcome instead.
    if (roster.players.length === 0) return fail("no_players", noPlayersMessage(roster.warnings));

    const body: ExtractResponse & { pages: number } = {
      team: roster.team,
      players: roster.players,
      warnings: roster.warnings,
      format: upload.format,
      route,
      pages,
    };
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    const failure = error instanceof ExtractionError ? error : toExtractionError(error);
    return fail(failure.code, failure.message);
  }
}

/**
 * One response and one log line per guard. The log names the check and nothing
 * else: no file name, no bytes, no text, no part of Claude's answer.
 */
function fail(code: ExtractFailureCode, detail?: string) {
  const failure = extractFailure(code, detail);
  console.error(`[Spotter] Roster import rejected at the "${failure.code}" check (HTTP ${failure.status}).`);
  return Response.json({ error: failure.message, code: failure.code }, { status: failure.status, headers: NO_STORE });
}
