import { describe, expect, it } from "vitest";
import { flagDuplicateJerseys } from "@/lib/rosters/duplicateJerseys";

describe("flagDuplicateJerseys", () => {
  it("flags both players who share a jersey", () => {
    expect(flagDuplicateJerseys([{ jersey: "6" }, { jersey: "10" }, { jersey: "6" }])).toEqual([true, false, true]);
  });

  it("treats 0 and 00 as different jerseys", () => {
    expect(flagDuplicateJerseys([{ jersey: "0" }, { jersey: "00" }])).toEqual([false, false]);
  });

  it("ignores players with no jersey", () => {
    expect(flagDuplicateJerseys([{ jersey: null }, { jersey: null }, { jersey: "" }])).toEqual([false, false, false]);
  });

  it("flags all three when three share a number", () => {
    expect(flagDuplicateJerseys([{ jersey: "7" }, { jersey: "7" }, { jersey: "7" }])).toEqual([true, true, true]);
  });

  it("ignores stray whitespace", () => {
    expect(flagDuplicateJerseys([{ jersey: " 6" }, { jersey: "6 " }])).toEqual([true, true]);
  });
});
