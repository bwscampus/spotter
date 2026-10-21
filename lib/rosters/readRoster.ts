// Server only: the one reading path every roster format goes through.
import type { OpenRouterClient } from "@/lib/ai/openrouter";
import { extractText } from "unpdf";
import { openPdf } from "@/lib/pdf";
import type { UsageSink } from "@/lib/usage/prices";
import { readLogoColor } from "./logoColors";
import { MAX_PDF_PAGES, MAX_TEXT_CHARS } from "./extractErrors";
import {
  EXTRACTION_TIMEOUT_MS,
  ExtractionError,
  extractRoster,
  MIN_RETRY_BUDGET_MS,
  type ExtractedRoster,
  type ExtractionSource,
} from "./extractRoster";
import { groundPlayers } from "./grounding";
import type { RosterUpload } from "./readUpload";
import { isTextUsable, joinPages } from "./textLayer";
import type { ReadRoute, Sport } from "./types";

// =============================================================================
// docs/V3_DEFINITION.md section 6.2. Every format becomes an ExtractionSource
// and goes to the same extractRoster call, with the same prompt, schema and
// failure codes:
//
//   pdf     text layer first; if it is empty (a scan), or reading it found
//           nobody, the PDF itself, which the model reads as page images
//   image   the screenshots or photos, as images
//   text    the pasted text
//   csv     the rows, as text ("a | b | c" per line)
//   xlsx    the same
//
// Grounding (is this surname really in the source?) runs wherever there was
// text to check against: a PDF's text layer, pasted text, spreadsheet rows.
//
// Volleyball (Jed, Oct 21) reads the season stats in the same call
// (lib/rosters/volleyballPrompt.ts). A PDF goes as the PDF itself, never its
// text layer alone, because a stats table's columns only line up on the
// page; the text layer, when there is one, still grounds the names. The
// browser says "volleyball" when the team is already one; when it does not,
// the usual read runs first and, if it finds a volleyball roster, the file is
// read once more for the stats.
// =============================================================================

/** Said under the review when a volleyball roster was read without its stats. */
export const VOLLEYBALL_STATS_UNREAD =
  "Season stats were not read from this file. Import them from the team's Season stats page once the roster is saved.";

export interface ReadResult {
  roster: ExtractedRoster;
  route: ReadRoute;
  /** Pages for a PDF, images for an image import, 0 otherwise. */
  pages: number;
  /** Only for a PDF: whether it had a text layer worth reading. */
  hadTextLayer: boolean;
}

/**
 * `meter`, when given, is told about every model reply (lib/usage/), so the
 * route can record what the import cost even when it fails. `sport` is what
 * the browser already knows the team to be; only "volleyball" changes the read.
 */
export async function readRoster(
  client: OpenRouterClient,
  upload: RosterUpload,
  signal: AbortSignal,
  meter?: UsageSink,
  { sport = null }: { sport?: Sport | null } = {},
): Promise<ReadResult> {
  if (sport === "volleyball") return readVolleyball(client, upload, signal, meter);

  const startedAt = Date.now();
  const read = await readAnySport(client, upload, signal, meter);
  if (read.roster.team.sport !== "volleyball") return read;

  // A volleyball roster the browser did not know was one: read it again for
  // its stats, when there is time, and keep the first read if that fails.
  const unread = { ...read, roster: { ...read.roster, warnings: [...read.roster.warnings, VOLLEYBALL_STATS_UNREAD] } };
  if (EXTRACTION_TIMEOUT_MS - (Date.now() - startedAt) < MIN_RETRY_BUDGET_MS) return unread;
  try {
    const again = await readVolleyball(client, upload, signal, meter);
    return again.roster.players.length > 0 ? again : unread;
  } catch {
    return unread;
  }
}

/** The read every sport has always had. */
async function readAnySport(
  client: OpenRouterClient,
  upload: RosterUpload,
  signal: AbortSignal,
  meter?: UsageSink,
): Promise<ReadResult> {
  if (upload.format === "pdf") return readPdf(client, upload.bytes, signal, meter);

  if (upload.format === "image") {
    const source: ExtractionSource = {
      kind: "images",
      images: upload.images.map((image) => ({
        mediaType: image.mediaType,
        base64: Buffer.from(image.bytes).toString("base64"),
      })),
    };
    const roster = await extractRoster(client, source, signal, meter);
    return { roster, route: "vision", pages: upload.images.length, hadTextLayer: false };
  }

  const prompt = upload.format === "text" ? "text" : "table";
  const roster = await extractRoster(client, { kind: "text", text: upload.text, prompt }, signal, meter);
  return {
    roster: { ...roster, players: groundPlayers(roster.players, upload.text) },
    route: "text",
    pages: 0,
    hadTextLayer: false,
  };
}

async function readPdf(client: OpenRouterClient, bytes: Uint8Array, signal: AbortSignal, meter?: UsageSink): Promise<ReadResult> {
  const pages = await pdfPages(bytes);

  // The crest in the header, when the page has one (lib/rosters/logoColors.ts,
  // from V2): the colour a school publishes, read in memory, never stored.
  // Read while the model reads the roster, on its own copy, given at most
  // COLOR_TIMEOUT_MS, and never fails the import.
  const colorRead = readLogoColor(bytes);

  const startedAt = Date.now();
  // Cut to the same length pasted text may be (H3): a real roster's text layer
  // is a few thousand characters, and anything past this is not a roster.
  const usableText = isTextUsable(pages) ? joinPages(pages).slice(0, MAX_TEXT_CHARS) : null;
  let roster: ExtractedRoster | null = null;
  let route: ReadRoute = "vision";

  if (usableText) {
    roster = await extractRoster(client, { kind: "text", text: usableText, prompt: "pdf_text" }, signal, meter);
    route = "text";
  }

  // No text layer, or a text layer that yielded nobody: read the pages as images.
  const budgetLeft = EXTRACTION_TIMEOUT_MS - (Date.now() - startedAt);
  const retry = roster !== null && roster.players.length === 0 && budgetLeft >= MIN_RETRY_BUDGET_MS;
  if (roster === null || retry) {
    const fromPages = await extractRoster(
      client,
      { kind: "pdf", base64: Buffer.from(bytes).toString("base64") },
      signal,
      meter,
    );
    // Keep the text result if the page images did no better.
    if (roster === null || fromPages.players.length > 0) {
      roster = fromPages;
      route = "vision";
    }
  }

  const players = route === "text" && usableText ? groundPlayers(roster.players, usableText) : roster.players;
  // The crest's own pixels when there are any; the model's read otherwise.
  const color = (await colorRead) ?? roster.team.color ?? null;
  return {
    roster: { ...roster, team: { ...roster.team, color }, players },
    route,
    pages: pages.length,
    hadTextLayer: usableText !== null,
  };
}

/** A PDF's text, page by page, once its page count has been checked. */
async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  try {
    // openPdf, never getDocumentProxy: PDF.js would empty `bytes`, and they
    // are needed again below if the text layer is not enough.
    const pdf = await openPdf(bytes);
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new ExtractionError(
        "too_many_pages",
        `That PDF has ${pdf.numPages} pages. Import a roster of ${MAX_PDF_PAGES} pages or fewer.`,
      );
    }
    return (await extractText(pdf, { mergePages: false })).text;
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError("bad_pdf");
  }
}

/**
 * A volleyball roster and its season stats, in one call. A PDF is sent as
 * itself, so the model sees the stats tables' columns as laid out, and its
 * text layer (when it has one) grounds the names; a scan has none to check
 * against. Images and text go as they do for every sport.
 */
async function readVolleyball(client: OpenRouterClient, upload: RosterUpload, signal: AbortSignal, meter?: UsageSink): Promise<ReadResult> {
  const options = { sport: "volleyball" as const };

  if (upload.format === "pdf") {
    const pages = await pdfPages(upload.bytes);
    const colorRead = readLogoColor(upload.bytes);
    const usableText = isTextUsable(pages) ? joinPages(pages).slice(0, MAX_TEXT_CHARS) : null;
    const roster = await extractRoster(
      client,
      { kind: "pdf", base64: Buffer.from(upload.bytes).toString("base64"), prompt: "pdf_document" },
      signal,
      meter,
      options,
    );
    const players = usableText ? groundPlayers(roster.players, usableText) : roster.players;
    const color = (await colorRead) ?? roster.team.color ?? null;
    return {
      roster: { ...roster, team: { ...roster.team, color }, players },
      // The model read a PDF with words in it as words: names were checked against them.
      route: usableText ? "text" : "vision",
      pages: pages.length,
      hadTextLayer: usableText !== null,
    };
  }

  if (upload.format === "image") {
    const source: ExtractionSource = {
      kind: "images",
      images: upload.images.map((image) => ({ mediaType: image.mediaType, base64: Buffer.from(image.bytes).toString("base64") })),
    };
    const roster = await extractRoster(client, source, signal, meter, options);
    return { roster, route: "vision", pages: upload.images.length, hadTextLayer: false };
  }

  const prompt = upload.format === "text" ? "text" : "table";
  const roster = await extractRoster(client, { kind: "text", text: upload.text, prompt }, signal, meter, options);
  return { roster: { ...roster, players: groundPlayers(roster.players, upload.text) }, route: "text", pages: 0, hadTextLayer: false };
}
