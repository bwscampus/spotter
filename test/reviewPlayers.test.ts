import { describe, expect, it } from "vitest";
import { FIXABLE_FLAGS, reviewRoster } from "@/lib/rosters/reviewPlayers";
import type { RosterPlayer } from "@/lib/rosters/types";

const player = (over: Partial<RosterPlayer>): RosterPlayer => ({
  jersey: "6",
  first_name: "Ada",
  last_name: "Tremaine",
  position: null,
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
  ...over,
});

describe("reviewRoster", () => {
  it("recomputes spoken forms as the surname is edited", () => {
    const [review] = reviewRoster([player({ last_name: "Sanchez-Greenfield" })], "volleyball");
    expect(review.forms).toEqual(["sanchezgreenfield", "sanchez", "greenfield"]);
  });

  it("flags both players sharing a jersey", () => {
    const reviews = reviewRoster(
      [player({ jersey: "6", last_name: "Tremaine" }), player({ jersey: "6", last_name: "Okonkwo" })],
      "volleyball",
    );
    expect(reviews.every((review) => review.flags.includes("duplicate_jersey"))).toBe(true);
  });

  it("flags a number that can be heard as another on the roster", () => {
    const reviews = reviewRoster(
      [player({ jersey: "15", last_name: "Torres" }), player({ jersey: "50", last_name: "Delgado" })],
      "basketball",
    );
    expect(reviews.every((review) => review.flags.includes("similar_jersey"))).toBe(true);
    expect(reviews[0].reasons[reviews[0].flags.indexOf("similar_jersey")]).toContain("#15 can be misheard as #50");
  });

  it("leaves a number alone when its partner is not on the roster", () => {
    const reviews = reviewRoster([player({ jersey: "15", last_name: "Torres" })], "basketball");
    expect(reviews[0].flags).not.toContain("similar_jersey");
  });

  it("flags an ambiguous surname and explains the fix", () => {
    const [review] = reviewRoster([player({ first_name: "Marli", last_name: "Richardson Barnes" })], "volleyball");
    expect(review.flags).toContain("ambiguous_last_name");
    expect(review.reasons[review.flags.indexOf("ambiguous_last_name")]).toContain("one word or two");
  });

  it("names the common word in the reason", () => {
    const [review] = reviewRoster([player({ last_name: "Reilly" })], "volleyball");
    expect(review.flags).toContain("common_word_close");
    expect(review.reasons.join(" ")).toContain("really");
  });

  it("flags a missing jersey", () => {
    const [review] = reviewRoster([player({ jersey: null })], "volleyball");
    expect(review.flags).toContain("missing_jersey");
  });

  it("marks only the offensive line in football", () => {
    const reviews = reviewRoster(
      [player({ position: "OL" }), player({ position: "DL" }), player({ position: "OL/DL" }), player({ position: null })],
      "football",
    );
    expect(reviews.map((review) => review.offensiveLineman)).toEqual([true, false, false, false]);
  });

  it("keeps a baseball catcher", () => {
    const [review] = reviewRoster([player({ position: "C" })], "baseball");
    expect(review.offensiveLineman).toBe(false);
  });

  it("keeps the flags Claude set", () => {
    const [review] = reviewRoster([player({ flags: ["unreadable"] })], "volleyball");
    expect(review.flags).toContain("unreadable");
  });

  it("flags Sept 25's common phrases with the real matcher", () => {
    const [longhi, aragon, piesik] = reviewRoster(
      [
        player({ jersey: "5", last_name: "Longhi" }),
        player({ jersey: "44", last_name: "Aragon" }),
        player({ jersey: "2", last_name: "Piesik" }),
      ],
      "football",
    );
    expect(longhi.flags).toContain("common_phrase_fire");
    expect(longhi.commonPhrases.hits.map((hit) => hit.word)).toContain("long");
    expect(aragon.flags).toContain("common_phrase_fire");
    expect(aragon.commonPhrases.hits.map((hit) => hit.word)).toEqual(expect.arrayContaining(["are gonna", "oregon"]));
    // "be sick" comes close on Piesik without clearing the line on its own.
    expect(piesik.flags.some((flag) => flag === "common_phrase_fire" || flag === "common_phrase_close")).toBe(true);
    expect(piesik.commonPhrases.hits.map((hit) => hit.word)).toContain("be sick");
    expect(piesik.reasons.join(" ")).toContain('"be sick"');
  });

  it("leaves a surname that sounds like nothing said during play", () => {
    const [review] = reviewRoster([player({ last_name: "Ossuetta" })], "football");
    expect(review.flags).not.toContain("common_phrase_fire");
    expect(review.flags).not.toContain("common_phrase_close");
  });

  it("pairs look-alike surnames on the same roster, Bargas and Vargas", () => {
    const reviews = reviewRoster(
      [
        player({ jersey: "8", last_name: "Bargas" }),
        player({ jersey: "21", last_name: "Vargas" }),
        player({ jersey: "22", last_name: "Langan" }),
      ],
      "football",
    );
    expect(reviews[0].lookAlikes).toEqual(["Vargas"]);
    expect(reviews[1].lookAlikes).toEqual(["Bargas"]);
    expect(reviews[2].lookAlikes).toEqual([]);
    expect(reviews[0].reasons.join(" ")).toContain("Can be heard as Vargas");
  });

  it("leaves a player set to off out of the look-alike check", () => {
    const reviews = reviewRoster(
      [player({ jersey: "8", last_name: "Bargas", spot_mode: "off" }), player({ jersey: "21", last_name: "Vargas" })],
      "football",
    );
    expect(reviews.map((review) => review.lookAlikes)).toEqual([[], []]);
  });

  it("does not call two players who share a surname look-alikes", () => {
    const reviews = reviewRoster(
      [player({ jersey: "10", last_name: "Williams" }), player({ jersey: "23", last_name: "Williams" })],
      "football",
    );
    expect(reviews.every((review) => review.lookAlikes.length === 0)).toBe(true);
  });

  it("notes a single-digit jersey, and only a single digit", () => {
    const reviews = reviewRoster(
      [player({ jersey: "0" }), player({ jersey: "9" }), player({ jersey: "00" }), player({ jersey: "12" })],
      "football",
    );
    expect(reviews.map((review) => review.flags.includes("single_digit"))).toEqual([true, true, false, false]);
    expect(reviews[0].reasons.join(" ")).toContain('"number"');
  });

  it("offers the one-click fixes only on common-phrase and look-alike warnings", () => {
    expect(FIXABLE_FLAGS).toEqual(["common_phrase_fire", "common_phrase_close", "look_alike"]);
  });

  it("says a word once, as the phrase, when it is both", () => {
    const [aragon] = reviewRoster([player({ jersey: "44", last_name: "Aragon" })], "football");
    expect(aragon.flags).toContain("common_phrase_fire");
    expect(aragon.flags).not.toContain("common_word_fire");
    expect(aragon.flags).not.toContain("common_word_close");
  });

  it("spares a player set to off the sound-alike warnings", () => {
    const [review] = reviewRoster([player({ jersey: "5", last_name: "Longhi", spot_mode: "off" })], "football");
    expect(review.flags.some((flag) => flag.startsWith("common_"))).toBe(false);
    // Still worth knowing about the number, which a stat could still be credited by.
    expect(review.flags).toContain("single_digit");
  });
});
