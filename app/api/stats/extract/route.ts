import { requireVerifiedUser } from "@/lib/server/auth";
import { isSameOrigin } from "@/lib/server/request";
import { openPdf } from "@/lib/pdf";
import { createAnthropicClient, ExtractionError, toExtractionError } from "@/lib/rosters/extractWithClaude";
import {
  extractFailure,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MULTIPART_SLACK_BYTES,
  type ExtractFailureCode,
} from "@/lib/rosters/extractErrors";
import { readUpload, type RosterUpload } from "@/lib/rosters/readUpload";
import type { ReadRoute } from "@/lib/rosters/types";
import { extractStats, STATS_TIMEOUT_MS, type StatsSource } from "@/lib/stats/extractStats";
import { statsKindFor, type StatsExtractResponse } from "@/lib/stats/types";
import { readFormBody } from "@/lib/usage/body";
import { UsageMeter } from "@/lib/usage/prices";
import { beginUsage, finishUsage } from "@/lib/server/usage";
import { getRosterForStats } from "@/lib/server/repo/rosters";

// One Claude call over a whole stats sheet, which is longer than a roster.
export const maxDuration = 150;

const NO_STORE = { "Cache-Control": "no-store" };

/** The largest body any format can legitimately send. */
const MAX_BODY_BYTES = Math.max(MAX_PDF_BYTES, MAX_IMAGES * MAX_IMAGE_BYTES) + MULTIPART_SLACK_BYTES;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads a team's season stats sheet, in any of the four roster formats
 * (docs/V3_DEFINITION.md 6.4), and returns numbers for a football team or
 * lines for any other sport. Saving is a separate step, in the browser, after
 * the announcer has checked them, through set_season_stats.
 *
 * The body carries the upload exactly as the roster import sends it (see
 * lib/rosters/readUpload.ts) plus `roster_id`. The team's roster is loaded here
 * rather than sent by the browser: it is what Claude matches against, so it
 * has to be the one actually saved. Row level security decides whose team it is.
 *
 * PRIVACY: the upload is parsed in memory and dropped when this function
 * returns. Nothing is written to disk or to the database, and neither the bytes,
 * the sheet's text, nor Claude's reply is ever logged. Analytics are the
 * browser's job (prep.import_finished); this route records only the call's
 * token counts and estimated cost, in public.usage (lib/usage/).
 */
export async function POST(request: Request) {
  // Only Spotter's own page may import, not another site open in the browser.
  if (!isSameOrigin(request)) return fail("cross_origin");

  // Reading a stats sheet is Anthropic time: signed-in accounts only.
  const gate = await requireVerifiedUser();
  if (!gate.ok) return gate.response;

  // A few imports a minute at most, so many a day, and the dollar caps
  // (public.usage_begin). A refusal is a 429 the import panel shows as it is.
  const usage = await beginUsage(gate.user.id, "stats_import");
  if (!usage.ok) return usage.response;

  // Every Claude reply, failed ones included, is added up here and recorded.
  const meter = new UsageMeter();
  let response: Response | null = null;
  try {
    response = await importStats(request, gate.user.id, meter);
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

async function importStats(request: Request, ownerId: string, meter: UsageMeter): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return fail("missing_key");

  // Read into a capped buffer, counting real bytes, then parsed: a body that
  // leaves out content-length is held to the same limit.
  const body = await readFormBody(request, MAX_BODY_BYTES);
  if (body.kind === "too_large") return fail("too_large");
  if (body.kind !== "ok") return fail("unreadable_upload");

  let rosterId: string;
  let upload: RosterUpload;
  try {
    const form = body.value;
    const id = form.get("roster_id");
    if (typeof id !== "string" || !UUID.test(id)) return fail("no_team");
    rosterId = id;
    upload = await readUpload(form);
  } catch (error) {
    if (error instanceof ExtractionError) return fail(error.code, error.message);
    // Almost always the body being cut short in transit.
    return fail("unreadable_upload");
  }

  // Page count only. The text layer is deliberately not read: see StatsSource.
  let pages = 0;
  if (upload.format === "pdf") {
    try {
      const pdf = await openPdf(upload.bytes);
      pages = pdf.numPages;
    } catch {
      return fail("bad_pdf");
    }
    if (pages > MAX_PDF_PAGES) {
      return fail("too_many_pages", `That PDF has ${pages} pages. Import a stats sheet of ${MAX_PDF_PAGES} pages or fewer.`);
    }
  } else if (upload.format === "image") {
    pages = upload.images.length;
  }

  // Only this account's team (lib/server/repo/rosters.ts scopes it by owner).
  let team: Awaited<ReturnType<typeof getRosterForStats>>;
  try {
    team = await getRosterForStats(ownerId, rosterId);
  } catch {
    return fail("roster_unreadable");
  }
  if (!team || team.players.length === 0) return fail("no_roster");
  const players = team.players;

  const client = createAnthropicClient(apiKey, STATS_TIMEOUT_MS);
  const signal = AbortSignal.timeout(STATS_TIMEOUT_MS);
  const kind = statsKindFor(team.sport);
  const { source, route } = sourceOf(upload);
  const startedAt = Date.now();

  try {
    const { usage, ...extracted } = await extractStats(
      client,
      source,
      players.map((player) => ({ jersey: player.jersey, first_name: player.first_name, last_name: player.last_name })),
      kind,
      signal,
      meter,
    );

    // Counts only: how long a real sheet takes, and how much Claude wrote.
    console.info(
      `[Spotter] Stats read in ${Date.now() - startedAt} ms, ${usage.calls} ${usage.calls === 1 ? "call" : "calls"}, ${usage.outputTokens} output tokens.`,
    );

    if (extracted.blocks.length === 0) return fail("no_stats");

    const body: StatsExtractResponse = {
      ...extracted,
      roster: players.map((player) => ({ id: player.id, jersey: player.jersey, last_name: player.last_name })),
      format: upload.format,
      route,
      pages,
    };
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    const failure = error instanceof ExtractionError ? error : toExtractionError(error);
    console.info(`[Spotter] Stats read stopped after ${Date.now() - startedAt} ms.`);
    return fail(failure.code, STATS_WORDING[failure.code] ?? failure.message);
  }
}

/**
 * The roster import's messages name a roster. These say what actually went
 * wrong with a stats sheet, and what to do about it.
 */
const STATS_WORDING: Partial<Record<ExtractFailureCode, string>> = {
  claude_timeout:
    "Claude took too long to read this stats sheet. Try again, or import only the pages with the stats you need.",
  roster_too_long: "This stats sheet was too long to read in one pass. Import only the pages with the stats you need.",
  bad_reply: "Claude's answer was not stats Spotter could read. Try again.",
  claude_refused: "Claude declined to read this file. Check it is this team's stats sheet.",
};

/** Every format as what Claude reads. A PDF is always its pages, never its text. */
function sourceOf(upload: RosterUpload): { source: StatsSource; route: ReadRoute } {
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

/**
 * One response and one log line per guard. The log names the check and nothing
 * else: no file name, no bytes, no text, no part of Claude's answer.
 */
function fail(code: ExtractFailureCode, detail?: string) {
  const failure = extractFailure(code, detail);
  console.error(`[Spotter] Stats import rejected at the "${failure.code}" check (HTTP ${failure.status}).`);
  return Response.json({ error: failure.message, code: failure.code }, { status: failure.status, headers: NO_STORE });
}
