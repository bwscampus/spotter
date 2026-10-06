import { describe, expect, it } from "vitest";
import { isAmbiguousLastName, surnameSplits } from "@/lib/rosters/ambiguity";

describe("isAmbiguousLastName", () => {
  it("flags a three-word name with no hyphen", () => {
    expect(isAmbiguousLastName("Marli", "Richardson Barnes")).toBe(true);
  });

  it("leaves a two-word name alone", () => {
    expect(isAmbiguousLastName("Ada", "Tremaine")).toBe(false);
  });

  it("leaves a hyphenated name alone, however long", () => {
    expect(isAmbiguousLastName("Nia", "Sanchez-Greenfield")).toBe(false);
    expect(isAmbiguousLastName("Nia Rose", "Sanchez-Greenfield")).toBe(false);
  });

  it("counts a two-word first name too", () => {
    expect(isAmbiguousLastName("Mary Kate", "Olsen")).toBe(true);
  });

  it("copes with a missing first name", () => {
    expect(isAmbiguousLastName(null, "Richardson Barnes")).toBe(false);
  });
});

describe("surnameSplits", () => {
  it("offers the longest surname first", () => {
    expect(surnameSplits("Marli", "Richardson Barnes")).toEqual([
      { first: "Marli", last: "Richardson Barnes" },
      { first: "Marli Richardson", last: "Barnes" },
    ]);
  });

  it("leaves one word for the first name", () => {
    expect(surnameSplits("Ada", "Tremaine")).toEqual([{ first: "Ada", last: "Tremaine" }]);
  });
});
