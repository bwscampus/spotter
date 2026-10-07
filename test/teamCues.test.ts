import { describe, expect, it } from "vitest";
import { buildTeamCues } from "@/lib/game/teamCues";
import { findSimilarJerseys, teenTyPartner } from "@/lib/rosters/similarJerseys";

const home = { school: "Campbell Hall High School", mascot: "Vikings", wearing: "white" };
const away = { school: "Crossroads", mascot: "Roadrunners", wearing: null };

const phrases = (side: "H" | "A") =>
  buildTeamCues(home, away)
    .filter((cue) => cue.side === side)
    .map((cue) => cue.words.join(" "));

describe("buildTeamCues", () => {
  it("listens for the school, the school without its generic tail, the mascot and the colour", () => {
    expect(phrases("H")).toEqual(
      expect.arrayContaining(["campbell hall high school", "campbell hall", "vikings", "viking", "white"]),
    );
  });

  it("gives the away side its own words", () => {
    expect(phrases("A")).toEqual(expect.arrayContaining(["crossroads", "roadrunners"]));
  });

  it("drops a word both teams answer to, which would name neither", () => {
    const cues = buildTeamCues({ school: "Oak Park", mascot: "Eagles", wearing: null }, { school: "Elm", mascot: "Eagles", wearing: null });
    expect(cues.map((cue) => cue.words.join(" "))).not.toContain("eagles");
    expect(cues.map((cue) => cue.words.join(" "))).toContain("oak park");
  });

  it("matches longest first, so a school name beats a word inside it", () => {
    const cues = buildTeamCues(home, away);
    expect(cues[0].words.length).toBeGreaterThanOrEqual(cues[cues.length - 1].words.length);
  });

  it("folds a possessive, because announcers say \"the Vikings' 5\"", () => {
    expect(phrases("H")).toContain("vikings");
  });
});

describe("teenTyPartner", () => {
  it("pairs the eight numbers that get misheard", () => {
    expect(teenTyPartner("15")).toBe("50");
    expect(teenTyPartner("50")).toBe("15");
    expect(teenTyPartner("13")).toBe("30");
    expect(teenTyPartner("90")).toBe("19");
  });

  it("leaves everything else alone", () => {
    expect(teenTyPartner("5")).toBeNull();
    expect(teenTyPartner("12")).toBeNull();
    expect(teenTyPartner("00")).toBeNull();
    expect(teenTyPartner("10")).toBeNull();
    expect(teenTyPartner("20")).toBeNull();
  });
});

describe("findSimilarJerseys", () => {
  it("finds a pair split across the two rosters, which the roster review cannot see", () => {
    const pairs = findSimilarJerseys([{ jersey: "15", last_name: "Torres" }], [{ jersey: "50", last_name: "Delgado" }]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ a: { jersey: "15", side: "H" }, b: { jersey: "50", side: "A" } });
  });

  it("lists a pair once, not once each way round", () => {
    const pairs = findSimilarJerseys(
      [{ jersey: "15", last_name: "Torres" }, { jersey: "50", last_name: "Delgado" }],
      [],
    );
    expect(pairs).toHaveLength(1);
  });
});
