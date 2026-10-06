import { describe, expect, it } from "vitest";
import { commonWordHits } from "@/lib/rosters/commonWordHits";
import { spokenForms } from "@/lib/rosters/spokenForms";

const report = (lastName: string) => commonWordHits(spokenForms(lastName));
const words = (lastName: string) => report(lastName).hits.map((hit) => hit.word);

describe("commonWordHits", () => {
  it("warns that Reilly sounds close to really", () => {
    const result = report("Reilly");
    expect(result.verdict).toBe("close");
    expect(words("Reilly")).toContain("really");
  });

  it("warns that Ward would fire on word and award", () => {
    const result = report("Ward");
    expect(result.verdict).toBe("would_fire");
    expect(words("Ward")).toEqual(expect.arrayContaining(["word", "award"]));
  });

  it("clears a surname that sounds like nothing common", () => {
    expect(report("Sanchez-Greenfield").verdict).toBeNull();
    expect(report("Tremaine").verdict).toBeNull();
  });

  it("lists only firing words once anything fires", () => {
    const result = report("Ward");
    expect(result.hits.every((hit) => hit.verdict === "would_fire")).toBe(true);
  });

  it("sorts the worst offender first", () => {
    const scores = report("Ward").hits.map((hit) => hit.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("handles a surname with no usable forms", () => {
    expect(commonWordHits([])).toEqual({ verdict: null, hits: [] });
  });

  it("checks every spoken form, not just the full surname", () => {
    // "Best" is a common word, so a hyphenated name containing it is flagged.
    expect(report("Okafor-Best").verdict).not.toBeNull();
  });
});
