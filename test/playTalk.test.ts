import { describe, expect, it } from "vitest";
import { isPlayTalk, rosterNames } from "@/lib/livestats/playTalk";

// What is worth a call to Claude (Jed, Oct 4: live stats cost about $2 a
// game, nearly all of it calls that read nothing). Made-up names only.

const NAMES = rosterNames([{ last: "Fennimore" }, { last: "Quillon" }, { last: "Vanderkellen-Ruiz" }, { last: "De La Fuentevilla" }, { last: "Li" }]);

describe("the roster's names", () => {
  it("are every surname, and each part of a hyphenated or two-word one, lowercased", () => {
    expect([...NAMES].sort()).toEqual(["fennimore", "fuentevilla", "quillon", "ruiz", "vanderkellen"]);
  });
});

describe("football talk", () => {
  it("is a down and distance, a name off either roster, or a jersey cue", () => {
    expect(isPlayTalk("third and 4 at the 30", NAMES)).toBe(true);
    expect(isPlayTalk("fennimore up the middle", NAMES)).toBe(true);
    expect(isPlayTalk("ruiz on the outside", NAMES)).toBe(true);
    expect(isPlayTalk("number 22 again", NAMES)).toBe(true);
  });

  it("is a word plays are described with", () => {
    for (const said of ["brought down at the 40", "pass is incomplete", "flag on the play", "picked off", "a gain of 6", "touchdown", "the punt is fair caught"]) {
      expect(isPlayTalk(said, NAMES), said).toBe(true);
    }
  });

  it("is not an advert, the halftime show or small talk, numbers and all", () => {
    for (const said of [
      "this half is brought to you by the valley credit union",
      "open a checking account today with 0 percent for 12 months",
      "the band is taking the field now",
      "great crowd here tonight",
    ]) {
      expect(isPlayTalk(said, NAMES), said).toBe(false);
    }
  });

  it("does not take a two-letter surname from inside other words", () => {
    expect(isPlayTalk("lights are on", NAMES)).toBe(false);
  });
});
