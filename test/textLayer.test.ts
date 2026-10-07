import { describe, expect, it } from "vitest";
import { isTextUsable, joinPages, MIN_LETTERS_PER_PAGE } from "@/lib/rosters/textLayer";

const letters = (count: number) => "a".repeat(count);

describe("isTextUsable", () => {
  it("accepts a page with plenty of text", () => {
    expect(isTextUsable([letters(MIN_LETTERS_PER_PAGE)])).toBe(true);
  });

  it("rejects a scan that yielded almost nothing", () => {
    expect(isTextUsable(["", "  ", "CH"])).toBe(false);
  });

  it("rejects no pages at all", () => {
    expect(isTextUsable([])).toBe(false);
  });

  it("averages across pages, so one dense page carries a sparse one", () => {
    expect(isTextUsable([letters(100), ""])).toBe(true);
    expect(isTextUsable([letters(100), "", "", ""])).toBe(false);
  });

  it("counts letters only, not jersey numbers or punctuation", () => {
    expect(isTextUsable(["12 · 00 · 7 · 23 · 4 · 10 · 99 · 6 · 15 · 21 · 3 · 8 · 11 · 5"])).toBe(false);
  });
});

describe("joinPages", () => {
  it("marks each page so the reader can see where a later table starts", () => {
    expect(joinPages(["Players", "Coaches"])).toBe("=== page 1 ===\nPlayers\n\n=== page 2 ===\nCoaches");
  });
});
