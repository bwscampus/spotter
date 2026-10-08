import { describe, expect, it } from "vitest";
import { OUR_SIDE_MESSAGE } from "@/lib/messages";
import {
  EXTRACT_FAILURE_CODES,
  extractFailure,
  MAX_IMAGES,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  type ExtractFailureCode,
} from "@/lib/rosters/extractErrors";

// Every guard in POST /api/rosters/extract and POST /api/livestats/extract, in the
// order the routes check them.
// A code missing from this list is a guard whose failure would reach the
// announcer unnamed, which is the thing this module exists to prevent.
const ALL_CODES: ExtractFailureCode[] = [
  "cross_origin",
  "signed_out",
  "missing_key",
  "no_team",
  "bad_format",
  "too_large",
  "no_file",
  "unreadable_upload",
  "not_pdf",
  "not_image",
  "too_many_images",
  "image_too_large",
  "no_text",
  "too_much_text",
  "too_many_pages",
  "bad_pdf",
  "no_roster",
  "roster_unreadable",
  "claude_key_rejected",
  "claude_no_model_access",
  "claude_model_missing",
  "claude_bad_request",
  "claude_rate_limited",
  "claude_unreachable",
  "claude_timeout",
  "claude_refused",
  "claude_overloaded",
  "bad_play_request",
  "play_window_too_long",
  "roster_too_long",
  "bad_reply",
  "no_players",
  "no_stats",
  "unknown",
  "rate_limited",
  "daily_cap",
  "global_cap",
  "usage_unavailable",
];

describe("extractFailure", () => {
  it("gives every guard the user can act on its own message", () => {
    // The setup failures only the operator can fix share one ("on our side");
    // the code tells them apart in the log.
    const shared = ALL_CODES.filter((code) => extractFailure(code).message === OUR_SIDE_MESSAGE);
    expect(shared).toEqual(["missing_key", "claude_key_rejected", "claude_no_model_access", "claude_model_missing", "claude_bad_request"]);
    const messages = ALL_CODES.filter((code) => !shared.includes(code)).map((code) => extractFailure(code).message);
    expect(new Set(messages).size).toBe(ALL_CODES.length - shared.length);
  });

  it("returns the code it was asked for", () => {
    for (const code of ALL_CODES) {
      expect(extractFailure(code).code).toBe(code);
    }
  });

  it("uses a status the browser can act on", () => {
    for (const code of ALL_CODES) {
      const { status } = extractFailure(code);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it("keeps every code short enough to survive sanitizeProps", () => {
    // usage_events drops any string over 40 characters, so a long code would
    // vanish from usage_failures exactly when it was needed.
    for (const code of ALL_CODES) {
      expect(code.length).toBeLessThanOrEqual(40);
    }
  });

  it("never puts a file name or roster text in a message", () => {
    for (const code of ALL_CODES) {
      expect(extractFailure(code).message).not.toMatch(/\.pdf/i);
    }
  });

  it("quotes the limit the guard enforces", () => {
    expect(extractFailure("too_large").message).toContain(`${MAX_PDF_BYTES / (1024 * 1024)} MB`);
    expect(extractFailure("too_many_pages").message).toContain(`${MAX_PDF_PAGES} pages`);
    expect(extractFailure("too_many_images").message).toContain(`${MAX_IMAGES} images`);
    expect(extractFailure("too_much_text").message).toContain(MAX_TEXT_CHARS.toLocaleString("en-US"));
  });

  it("lets a guard say something more specific", () => {
    const failure = extractFailure("too_many_pages", "That PDF has 42 pages. Upload a roster of 10 pages or fewer.");
    expect(failure.code).toBe("too_many_pages");
    expect(failure.status).toBe(400);
    expect(failure.message).toContain("42 pages");
  });

  it("falls back to the stock message when the detail is blank", () => {
    expect(extractFailure("bad_pdf", "   ").message).toBe(extractFailure("bad_pdf").message);
    expect(extractFailure("bad_pdf", null).message).toBe(extractFailure("bad_pdf").message);
  });

  it("says a configuration problem is on our side, and never shows the provider's own words", () => {
    // Pre-launch audit H12: a stranger must not be told about .env.local or a
    // model constant. The code still names the check in the route's log.
    for (const code of ["missing_key", "claude_key_rejected", "claude_no_model_access", "claude_model_missing", "claude_bad_request"] as const) {
      const failure = extractFailure(code, "Some provider said: model claude-x does not exist");
      expect(failure.code).toBe(code);
      expect(failure.message).toBe(OUR_SIDE_MESSAGE);
    }
    for (const code of EXTRACT_FAILURE_CODES) {
      expect(extractFailure(code).message, code).not.toMatch(/\.env|localhost|EXTRACTION_MODEL|API_KEY|\.ts\b|Anthropic/);
    }
  });

  it("separates an empty read from an unreadable one", () => {
    // 422 rather than 502: the file was fine, there were just no players on it.
    expect(extractFailure("no_players").status).toBe(422);
    expect(extractFailure("bad_reply").status).toBe(502);
  });
});
