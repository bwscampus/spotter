import { describe, expect, it } from "vitest";
import { spokenForms } from "@/lib/rosters/spokenForms";

describe("spokenForms", () => {
  it("returns the full surname first, then each hyphen part", () => {
    expect(spokenForms("Sanchez-Greenfield")).toEqual(["sanchezgreenfield", "sanchez", "greenfield"]);
  });

  it("drops the apostrophe", () => {
    expect(spokenForms("O'Garro")).toEqual(["ogarro"]);
  });

  it("handles a plain surname", () => {
    expect(spokenForms("Tremaine")).toEqual(["tremaine"]);
  });

  it("joins a two-word surname the way the matcher does", () => {
    expect(spokenForms("Richardson Barnes")).toEqual(["richardsonbarnes"]);
  });

  it("strips generational suffixes and trailing periods", () => {
    expect(spokenForms("Smith Jr.")).toEqual(["smith"]);
    expect(spokenForms("Smith, Jr")).toEqual(["smith"]);
    expect(spokenForms("Okafor III")).toEqual(["okafor"]);
    expect(spokenForms("Vance IV")).toEqual(["vance"]);
  });

  it("keeps a surname that only looks like a suffix", () => {
    expect(spokenForms("Ivy")).toEqual(["ivy"]);
  });

  it("skips hyphen parts under two letters", () => {
    expect(spokenForms("A-Rodriguez")).toEqual(["arodriguez", "rodriguez"]);
  });

  it("reads an en dash as a hyphen", () => {
    expect(spokenForms("Sanchez–Greenfield")).toEqual(["sanchezgreenfield", "sanchez", "greenfield"]);
  });

  it("folds accents so the form matches what the matcher compares", () => {
    expect(spokenForms("Muñoz")).toEqual(["munoz"]);
  });

  it("returns nothing usable for a blank surname", () => {
    expect(spokenForms("   ")).toEqual([]);
  });

  it("does not repeat a part that equals the whole name", () => {
    expect(spokenForms("Lee")).toEqual(["lee"]);
  });
});
