import { requireApprovedUser } from "@/lib/server/auth";
import { takeToken } from "@/lib/server/rateLimit";
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
import { readRoster } from "@/lib/rosters/readRoster";
import { readUpload, type RosterUpload } from "@/lib/rosters/readUpload";
import type { ExtractResponse } from "@/lib/rosters/types";

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
 * returns. Nothing is written to disk or to Supabase, and neither the bytes,
 * the text, nor Claude's reply is ever logged.
 */
export async function POST(request: Request) {
  // Only Spotter's own page may import, not another site open in the browser.
  if (!isSameOrigin(request)) return fail("cross_origin");

  // Reading a roster is Anthropic time: approved accounts only.
  const gate = await requireApprovedUser();
  if (!gate.ok) return gate.response;
  if (!takeToken("rosterExtract", gate.user.id)) return fail("rate_limited");

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return fail("missing_key");

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) return fail("too_large");

  let upload: RosterUpload;
  try {
    upload = await readUpload(await request.formData());
  } catch (error) {
    if (error instanceof ExtractionError) return fail(error.code, error.message);
    // Almost always the body being cut short in transit.
    return fail("unreadable_upload");
  }

  const client = createAnthropicClient(apiKey);
  const signal = AbortSignal.timeout(EXTRACTION_TIMEOUT_MS);

  try {
    const { roster, route, pages } = await readRoster(client, upload, signal);

    // Nobody on it. The review screen would open on an empty table with
    // nothing to say, so name the outcome instead.
    if (roster.players.length === 0) return fail("no_players");

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
