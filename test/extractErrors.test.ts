import { describe, expect, it } from "vitest";
import {
  extractFailure,
  MAX_IMAGES,
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_TEXT_CHARS,
  type ExtractFailureCode,
} from "@/lib/rosters/extractErrors";

// Every guard in POST /api/rosters/extract and POST /api/plays/extract, in the
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
];

describe("extractFailure", () => {
  it("gives every guard its own message", () => {
    const messages = ALL_CODES.map((code) => extractFailure(code).message);
    expect(new Set(messages).size).toBe(ALL_CODES.length);
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

  it("tells you where to look when a guard points at configuration", () => {
    // These three are the ones a fresh install actually hits, and each has to
    // name the file to open rather than blaming the PDF.
    expect(extractFailure("missing_key").message).toContain(".env.local");
    expect(extractFailure("claude_key_rejected").message).toContain(".env.local");
    expect(extractFailure("claude_model_missing").message).toContain("extractWithClaude.ts");
  });

  it("separates an empty read from an unreadable one", () => {
    // 422 rather than 502: the file was fine, there were just no players on it.
    expect(extractFailure("no_players").status).toBe(422);
    expect(extractFailure("bad_reply").status).toBe(502);
  });
});
