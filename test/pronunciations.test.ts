import { describe, expect, it } from "vitest";
import { parsePronunciations, writePronunciations } from "@/lib/rosters/pronunciations";
import { spokenForms, toSpokenForm } from "@/lib/rosters/spokenForms";

describe("parsePronunciations", () => {
  it("splits the box on commas and keeps the words as typed", () => {
    expect(parsePronunciations("win, nuh-goo-yen")).toEqual(["win", "nuh-goo-yen"]);
  });

  it("drops blanks, so a trailing comma while typing costs nothing", () => {
    expect(parsePronunciations("win, ")).toEqual(["win"]);
    expect(parsePronunciations(" , , ")).toEqual([]);
    expect(parsePronunciations("")).toEqual([]);
  });

  it("drops repeats without minding case", () => {
    expect(parsePronunciations("Win, win, WIN")).toEqual(["Win"]);
  });

  it("round trips through the box", () => {
    const said = parsePronunciations("win, nuh-goo-yen");
    expect(parsePronunciations(writePronunciations(said))).toEqual(said);
  });
});

describe("spokenForms with pronunciations", () => {
  it("adds what the announcer says the name sounds like", () => {
    expect(spokenForms("Nguyen", ["win"])).toEqual(["nguyen", "win"]);
  });

  it("keeps the printed surname first, whatever is added", () => {
    // buildGameWatchlist treats forms[0] as the identity of the group, so a
    // pronunciation must never displace the name itself.
    const forms = spokenForms("Ossuetta", ["oh sweater"]);
    expect(forms[0]).toBe("ossuetta");
  });

  it("normalizes a typed pronunciation the same way the matcher will", () => {
    // Multi-word input joins up, exactly as compileWatchlist builds its keys.
    expect(spokenForms("Nguyen", ["nuh goo yen"])).toEqual(["nguyen", "nuhgooyen"]);
    expect(toSpokenForm("nuh goo yen")).toBe("nuhgooyen");
  });

  it("keeps hyphen parts and pronunciations together, parts first", () => {
    expect(spokenForms("Sanchez-Greenfield", ["sanchez green"])).toEqual([
      "sanchezgreenfield",
      "sanchez",
      "greenfield",
      "sanchezgreen",
    ]);
  });

  it("ignores a pronunciation that is already a derived form", () => {
    expect(spokenForms("Kim", ["Kim"])).toEqual(["kim"]);
    expect(spokenForms("Sanchez-Greenfield", ["sanchez"])).toEqual([
      "sanchezgreenfield",
      "sanchez",
      "greenfield",
    ]);
  });

  it("ignores a pronunciation that normalizes to nothing", () => {
    expect(spokenForms("Kim", ["", "  ", "!!"])).toEqual(["kim"]);
  });

  it("behaves as before when none are given", () => {
    expect(spokenForms("Sanchez-Greenfield")).toEqual(["sanchezgreenfield", "sanchez", "greenfield"]);
  });
});
