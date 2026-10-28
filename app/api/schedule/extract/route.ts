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
import { readUpload, type RosterUpload } from "@/lib/rosters/readUpload";
import type { ReadRoute } from "@/lib/rosters/types";
import { extractSchedule, SCHEDULE_TIMEOUT_MS, type ScheduleSource } from "@/lib/schedule/extractSchedule";
import type { ScheduleExtractResponse } from "@/lib/schedule/review";
import { isCalendarDate } from "@/lib/schedule/types";
import { todayIso } from "@/lib/stats/review";
import { readFormBody } from "@/lib/usage/body";
import { UsageMeter } from "@/lib/usage/prices";
import { beginUsage, finishUsage } from "@/lib/server/usage";
import { getScheduleTeam } from "@/lib/server/repo/schedule";

// One model call over a whole season's schedule.
export const maxDuration = 150;

const NO_STORE = { "Cache-Control": "no-store" };

/** The largest body any format can legitimately send. */
const MAX_BODY_BYTES = Math.max(MAX_PDF_BYTES, MAX_IMAGES * MAX_IMAGE_BYTES) + MULTIPART_SLACK_BYTES;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads a team's schedule (docs/V3_DEFINITION.md 6.7) from a paste, a PDF, an
 * image or a saved web page, in any format, and returns its games as rows for
 * the review table: date (a year the source left off worked out from the
 * team's season), opponent, site, both scores, league or not, and why to look
 * at a row the model was unsure of. Saving is a separate step, after the
 * announcer has checked them, through PUT /api/rosters/[id]/schedule.
 *
 * The body carries the upload exactly as the roster import sends it (see
 * lib/rosters/readUpload.ts) plus `roster_id`, and `today`, the announcer's
 * own date, which the server cannot know. The team's name, sport and season
 * are loaded here, scoped to the signed-in account.
 *
 * Counted by the spend guard as a stats import, as "Other info" is: the same
 * kind of call, and a new route name would mean changing usage_begin and its
 * table's check.
 *
 * PRIVACY: the upload is parsed in memory and dropped when this function
 * returns. Nothing is written to disk or to the database, and neither the bytes,
 * the text, nor the model's reply is ever logged.
 */
export async function POST(request: Request) {
  // Only Spotter's own page may import, not another site open in the browser.
  if (!isSameOrigin(request)) return fail("cross_origin");

  // Reading a schedule is paid model time: signed-in accounts only.
  const gate = await requireVerifiedUser();
  if (!gate.ok) return gate.response;

  const usage = await beginUsage(gate.user.id, "stats_import");
  if (!usage.ok) return usage.response;

  const meter = new UsageMeter();
  let response: Response | null = null;
  try {
    response = await readSchedule(request, gate.user.id, meter);
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

async function readSchedule(request: Request, ownerId: string, meter: UsageMeter): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return fail("missing_key");

  const body = await readFormBody(request, MAX_BODY_BYTES);
  if (body.kind === "too_large") return fail("too_large");
  if (body.kind !== "ok") return fail("unreadable_upload");

  const form = body.value;
  const teamId = form.get("roster_id");
  if (typeof teamId !== "string" || !UUID.test(teamId)) return fail("no_team");
  const sent = form.get("today");
  const today = typeof sent === "string" && isCalendarDate(sent) ? sent : todayIso();

  let upload: RosterUpload;
  try {
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

  let team: Awaited<ReturnType<typeof getScheduleTeam>>;
  try {
    team = await getScheduleTeam(ownerId, teamId);
  } catch {
    return fail("roster_unreadable", "Could not load this team. Check the connection and try again.");
  }
  // Gone, or another account's: the same answer either way.
  if (!team) return fail("team_missing");

  const client = createOpenRouterClient(apiKey);
  const signal = AbortSignal.timeout(SCHEDULE_TIMEOUT_MS);
  const { source, route } = sourceOf(upload);
  const startedAt = Date.now();

  try {
    const read = await extractSchedule(client, source, team, { season: team.season, today }, signal, meter);
    // Counts only.
    console.info(
      `[Spotter] Schedule read in ${Date.now() - startedAt} ms: ${read.games.length} games, ${read.outputTokens} output tokens.`,
    );
    if (read.games.length === 0) return fail("no_games");

    const answer: ScheduleExtractResponse = { games: read.games, warnings: read.warnings, format: upload.format, route, pages };
    return Response.json(answer, { headers: NO_STORE });
  } catch (error) {
    const failure = error instanceof ExtractionError ? error : toExtractionError(error);
    console.info(`[Spotter] Schedule read stopped after ${Date.now() - startedAt} ms.`);
    return fail(failure.code, WORDING[failure.code] ?? failure.message);
  }
}

/** The roster import's messages name a roster. These say what went wrong with this read. */
const WORDING: Partial<Record<ExtractFailureCode, string>> = {
  claude_timeout: "The reader took too long to read this schedule. Try again, or import a shorter piece.",
  roster_too_long: "There were too many games to write in one pass. Import one season at a time.",
  bad_reply: "The reader's answer was not a schedule StatCast could read. Try again.",
  claude_refused: "The reader declined to read this file. Check it is this team's schedule.",
};

/** A PDF is always its pages, so the result and site columns survive (a schedule is a table). */
function sourceOf(upload: RosterUpload): { source: ScheduleSource; route: ReadRoute } {
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
  console.error(`[Spotter] Schedule import rejected at the "${failure.code}" check (HTTP ${failure.status}).`);
  return Response.json({ error: failure.message, code: failure.code }, { status: failure.status, headers: NO_STORE });
}
