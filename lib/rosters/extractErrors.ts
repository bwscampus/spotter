// =============================================================================
// Every way reading a roster can fail, with the limits the guards enforce.
//
// One code per guard. The code is what the browser shows in small type, what
// the terminal logs, and what lands in usage_events, so a failed upload can be
// traced to the exact check that turned it away instead of a shared "could not
// read this file". Codes are short enums by design: sanitizeProps drops any
// string over 40 characters, and none of these carry roster content.
// =============================================================================

import { MISSING_ANTHROPIC_KEY_MESSAGE } from "@/lib/messages";

// -----------------------------------------------------------------------------
// TUNING: what Spotter will accept as a roster. docs/V3_DEFINITION.md 6.2.
// A MaxPreps printout is one or two pages and well under a megabyte. The limits
// are generous enough for a scan and small enough that a misdropped file fails
// fast instead of costing a minute of Claude time.
//
// Vercel refuses any request body over 4.5 MB before it reaches the route, so
// on the deployed site a PDF between that and MAX_PDF_BYTES fails with a 413
// from Vercel rather than from here. Images are shrunk in the browser first
// (lib/rosters/importFiles.ts), so they stay well under it.
// -----------------------------------------------------------------------------

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;

/** Screenshots or photos in one import. */
export const MAX_IMAGES = 5;

/** One image as it arrives, after the browser has shrunk and re-encoded it. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Pasted text, and spreadsheet rows once they are turned into text. */
export const MAX_TEXT_CHARS = 50_000;

/**
 * What the browser lets itself send at once, under Vercel's 4.5 MB body limit.
 * Images are shrunk until they fit in this between them.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** Multipart adds boundaries and headers around the file; allow for them before reading the body. */
export const MULTIPART_SLACK_BYTES = 64 * 1024;

/**
 * The most utterances the play feed may send in one call. The loop caps its own
 * window well below this; the guard is here so a bug in the loop costs a 413
 * rather than a very large bill.
 */
export const MAX_PLAY_UTTERANCES = 60;

// -----------------------------------------------------------------------------

/** In the order POST /api/rosters/extract checks them. */
export type ExtractFailureCode =
  // The request itself
  | "cross_origin"
  | "signed_out"
  | "missing_key"
  // The upload
  | "no_team"
  | "bad_format"
  | "too_large"
  | "no_file"
  | "unreadable_upload"
  | "not_pdf"
  | "not_image"
  | "too_many_images"
  | "image_too_large"
  | "no_text"
  | "too_much_text"
  // The PDF
  | "too_many_pages"
  | "bad_pdf"
  // The Claude call
  | "claude_key_rejected"
  | "claude_no_model_access"
  | "claude_model_missing"
  | "claude_bad_request"
  | "claude_rate_limited"
  | "claude_unreachable"
  | "claude_timeout"
  | "claude_refused"
  | "claude_overloaded"
  // The team a stats sheet is for
  | "no_roster"
  | "roster_unreadable"
  // The play feed's own request, in POST /api/plays/extract
  | "bad_play_request"
  | "play_window_too_long"
  // Claude's answer
  | "roster_too_long"
  | "bad_reply"
  | "no_players"
  | "no_stats"
  | "unknown";

export interface ExtractFailure {
  code: ExtractFailureCode;
  status: number;
  /** What the announcer sees. Says what to do, never quotes the file. */
  message: string;
}

const FAILURES: Record<ExtractFailureCode, { status: number; message: string }> = {
  cross_origin: {
    status: 403,
    message: "That upload did not come from Spotter. Reload the page and try again.",
  },
  signed_out: {
    status: 401,
    message: "Your session ended. Sign in again and import the roster again.",
  },
  missing_key: {
    status: 503,
    // The same sentence the red banner shows, so the two cannot drift apart.
    message: MISSING_ANTHROPIC_KEY_MESSAGE,
  },
  bad_format: {
    status: 400,
    message: "That import did not say what kind of roster it was. Reload the page and try again.",
  },
  too_large: {
    status: 413,
    message: `That PDF is over ${MAX_PDF_BYTES / (1024 * 1024)} MB. Export a smaller one and try again.`,
  },
  no_file: {
    status: 400,
    message: "Choose a file to import.",
  },
  unreadable_upload: {
    status: 400,
    message: "The upload did not arrive whole. Try again, and check the file is under 10 MB.",
  },
  not_pdf: {
    status: 400,
    message: "That file is not a PDF. Pick the PDF, or use the image, paste or spreadsheet import instead.",
  },
  not_image: {
    status: 400,
    message: "That is not a PNG, JPG, WebP or iPhone photo. Take a screenshot of the roster and import that.",
  },
  too_many_images: {
    status: 400,
    message: `Import up to ${MAX_IMAGES} images at a time.`,
  },
  image_too_large: {
    status: 413,
    message: "One of those images is too large to send. Take a screenshot of just the roster and try again.",
  },
  no_text: {
    status: 400,
    message: "There is nothing to read. Paste the roster, or pick a spreadsheet with players in it.",
  },
  too_much_text: {
    status: 413,
    message: `That is more than ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters. Paste just the roster table.`,
  },
  too_many_pages: {
    status: 400,
    message: `Upload a roster of ${MAX_PDF_PAGES} pages or fewer.`,
  },
  bad_pdf: {
    status: 400,
    message: "Could not open that PDF. It may be damaged or password protected.",
  },
  claude_key_rejected: {
    status: 502,
    message: "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local and restart.",
  },
  claude_no_model_access: {
    status: 502,
    message: "This Anthropic API key cannot use the Claude model Spotter needs.",
  },
  claude_model_missing: {
    status: 502,
    message:
      "Anthropic does not know the model Spotter asked for. Check EXTRACTION_MODEL in lib/rosters/extractWithClaude.ts.",
  },
  claude_bad_request: {
    status: 502,
    message: "Anthropic rejected Spotter's request.",
  },
  claude_rate_limited: {
    status: 503,
    message: "Anthropic is rate limiting requests. Wait a minute and try again.",
  },
  claude_unreachable: {
    status: 502,
    message: "Could not reach Anthropic. Check the network and try again.",
  },
  claude_timeout: {
    status: 504,
    message: "Claude took too long to read this roster. Try again.",
  },
  claude_refused: {
    status: 502,
    message: "Claude declined to read this file. Try a different roster.",
  },
  claude_overloaded: {
    status: 503,
    message: "Anthropic is overloaded right now. Wait a moment and try again.",
  },
  roster_too_long: {
    status: 502,
    message: "This roster was too long to read in one pass. Split the PDF and try again.",
  },
  bad_reply: {
    status: 502,
    message: "Claude's answer was not a roster Spotter could read. Try again.",
  },
  no_team: {
    status: 400,
    message: "That upload did not say which team it was for. Reload the page and try again.",
  },
  no_roster: {
    status: 409,
    message: "Import this team's roster before its stats. Stats are matched to players by jersey number.",
  },
  roster_unreadable: {
    status: 502,
    message: "Could not load this team's roster to match the stats against. Check the connection and try again.",
  },
  no_stats: {
    status: 422,
    message:
      "Claude read this but found no stats for anyone on the roster. Check it is this team's stats sheet.",
  },
  no_players: {
    status: 422,
    message:
      "Claude read this but found no players on it. Check it is a team roster and not a schedule or a blank page.",
  },
  bad_play_request: {
    status: 400,
    message: "The play feed sent something this route could not read.",
  },
  play_window_too_long: {
    status: 413,
    message: `The play feed sent more than ${MAX_PLAY_UTTERANCES} utterances at once.`,
  },
  unknown: {
    status: 502,
    message: "Could not read a roster from this import.",
  },
};

/** Every code, for the analytics vocabulary (prep.import_finished's fail_code). */
export const EXTRACT_FAILURE_CODES = Object.keys(FAILURES) as ExtractFailureCode[];

/**
 * Builds the failure for one guard. `detail` replaces the stock message when
 * the guard knows something more specific, such as the actual page count.
 */
export function extractFailure(code: ExtractFailureCode, detail?: string | null): ExtractFailure {
  const { status, message } = FAILURES[code];
  return { code, status, message: detail?.trim() ? detail.trim() : message };
}
