import { requireVerifiedUser } from "@/lib/server/auth";
import { isSameOrigin } from "@/lib/server/request";
import { openPdf } from "@/lib/pdf";
import { createOpenRouterClient } from "@/lib/ai/openrouter";
import { ExtractionError, toExtractionError } from "@/lib/rosters/extractRoster";
import {
  extractFailure,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MULTIPART_SLACK_BYTES,
  type ExtractFailureCode,
} from "@/lib/rosters/extractErrors";
import { extractStorylines, STORYLINES_TIMEOUT_MS, type StorylineSource } from "@/lib/rosters/extractStorylines";
import { readUpload, type RosterUpload } from "@/lib/rosters/readUpload";
import { readStorylinePlayers, type StorylinePlayer, type StorylinesResponse } from "@/lib/rosters/storylines";
import type { ReadRoute } from "@/lib/rosters/types";
import { readFormBody } from "@/lib/usage/body";
import { UsageMeter } from "@/lib/usage/prices";
import { beginUsage, finishUsage } from "@/lib/server/usage";

// One model call over whatever the announcer dropped in.
export const maxDuration = 150;

const NO_STORE = { "Cache-Control": "no-store" };

/** The largest body any format can legitimately send, and the player list beside it. */
const MAX_BODY_BYTES = Math.max(MAX_PDF_BYTES, MAX_IMAGES * MAX_IMAGE_BYTES) + MULTIPART_SLACK_BYTES + 128 * 1024;

/** The team's name as the page sends it, for the model's context only. */
const MAX_TEAM_CHARS = 120;

/**
 * Reads "Other info" (Jed, Oct 8): any file or text about a team, an article,
 * a box score, a coach's notes, and returns one storyline for each player it
 * says something about. Saving is the team page's own Save, after the
 * announcer has picked which ones to keep.
 *
 * The body carries the upload exactly as the roster import sends it (see
 * lib/rosters/readUpload.ts) plus `players`, the team's table as JSON
 * (StorylinePlayer), and `team`, its name. The players come from the page
 * rather than the database because the table may not be saved yet, and
 * nothing here writes anywhere: the model only hands back the row keys it was
 * given.
 *
 * Counted by the spend guard as a stats import: the same kind of call, and a
 * new route name would mean changing usage_begin and its table's check.
 *
 * PRIVACY: the upload is parsed in memory and dropped when this function
 * returns. Nothing is written to disk or to Supabase, and neither the bytes,
 * the text, the players nor the model's reply is ever logged.
 */
export async function POST(request: Request) {
  // Only Spotter's own page may import, not another site open in the browser.
  if (!isSameOrigin(request)) return fail("cross_origin");

  // Reading a file is paid model time: signed-in accounts only.
  const gate = await requireVerifiedUser();
  if (!gate.ok) return gate.response;

  const usage = await beginUsage(gate.user.id, "stats_import");
  if (!usage.ok) return usage.response;

  const meter = new UsageMeter();
  let response: Response | null = null;
  try {
    response = await readStorylines(request, meter);
    return response;
  } finally {
    const spent = meter.usage;
    await finishUsage(gate.user.id, usage.ticket, {
      ok: response?.ok ?? false,
      provider: "openrouter",
      inputTokens: spent.inputTokens,
      outputTokens: spent.outputTokens,
      cachedTokens: spent.cachedTokens,
      costUsd: spent.costUsd,
    });
  }
}

async function readStorylines(request: Request, meter: UsageMeter): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return fail("missing_key");

  const body = await readFormBody(request, MAX_BODY_BYTES);
  if (body.kind === "too_large") return fail("too_large");
  if (body.kind !== "ok") return fail("unreadable_upload");

  let players: StorylinePlayer[];
  let teamName: string | null;
  let upload: RosterUpload;
  try {
    const form = body.value;
    const read = readStorylinePlayers(form.get("players"));
    if (!read) return fail("bad_players");
    players = read;
    const team = form.get("team");
    teamName = typeof team === "string" && team.trim().length > 0 ? team.trim().slice(0, MAX_TEAM_CHARS) : null;
    upload = await readUpload(form);
  } catch (error) {
    if (error instanceof ExtractionError) return fail(error.code, error.message);
    return fail("unreadable_upload");
  }

  let pages = 0;
  if (upload.format === "pdf") {
    try {
      const pdf = await openPdf(upload.bytes);
      pages = pdf.numPages;
    } catch {
      return fail("bad_pdf");
    }
    if (pages > MAX_PDF_PAGES) {
      return fail("too_many_pages", `That PDF has ${pages} pages. Import ${MAX_PDF_PAGES} pages or fewer.`);
    }
  } else if (upload.format === "image") {
    pages = upload.images.length;
  }

  const client = createOpenRouterClient(apiKey);
  const signal = AbortSignal.timeout(STORYLINES_TIMEOUT_MS);
  const { source, route } = sourceOf(upload);
  const startedAt = Date.now();

  try {
    const read = await extractStorylines(client, source, players, teamName, signal, meter);
    // Counts only.
    console.info(
      `[Spotter] Other info read in ${Date.now() - startedAt} ms: ${read.suggestions.length} of ${players.length} players, ${read.outputTokens} output tokens.`,
    );
    if (read.suggestions.length === 0) return fail("no_storylines");

    const answer: StorylinesResponse = {
      suggestions: read.suggestions,
      notes: read.notes,
      format: upload.format,
      route,
      pages,
    };
    return Response.json(answer, { headers: NO_STORE });
  } catch (error) {
    const failure = error instanceof ExtractionError ? error : toExtractionError(error);
    console.info(`[Spotter] Other info read stopped after ${Date.now() - startedAt} ms.`);
    return fail(failure.code, WORDING[failure.code] ?? failure.message);
  }
}

/** The roster import's messages name a roster. These say what went wrong with this read. */
const WORDING: Partial<Record<ExtractFailureCode, string>> = {
  claude_timeout: "The reader took too long to read this. Try again, or import a shorter piece.",
  roster_too_long: "There was too much to write in one pass. Import a shorter piece.",
  bad_reply: "The reader's answer was not storylines Spotter could read. Try again.",
  claude_refused: "The reader declined to read this file. Check it is about this team.",
};

/** A PDF is always its pages, so a box score's columns survive. */
function sourceOf(upload: RosterUpload): { source: StorylineSource; route: ReadRoute } {
  if (upload.format === "pdf") {
    return { source: { kind: "pdf", base64: Buffer.from(upload.bytes).toString("base64") }, route: "vision" };
  }
  if (upload.format === "image") {
    return {
      source: {
        kind: "images",
        images: upload.images.map((image) => ({
          mediaType: image.mediaType,
          base64: Buffer.from(image.bytes).toString("base64"),
        })),
      },
      route: "vision",
    };
  }
  return { source: { kind: "text", text: upload.text }, route: "text" };
}

/** One response and one log line per guard: the check's name and nothing else. */
function fail(code: ExtractFailureCode, detail?: string) {
  const failure = extractFailure(code, detail);
  console.error(`[Spotter] Other info rejected at the "${failure.code}" check (HTTP ${failure.status}).`);
  return Response.json({ error: failure.message, code: failure.code }, { status: failure.status, headers: NO_STORE });
}
