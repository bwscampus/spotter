import { describe, expect, it } from "vitest";
import {
  describeTeam,
  GENDERS,
  GENDER_LABELS,
  LEVELS,
  LEVEL_LABELS,
  SPORTS,
  SPORT_LABELS,
  genderLabel,
  levelLabel,
  sportLabel,
} from "@/lib/rosters/types";

// The stored values stay lowercase, because team_key is built from them and the
// database's check constraints require it. These are display only.

describe("labels", () => {
  it("has one for every value the database allows", () => {
    for (const sport of SPORTS) expect(SPORT_LABELS[sport]).toBeTruthy();
    for (const gender of GENDERS) expect(GENDER_LABELS[gender]).toBeTruthy();
    for (const level of LEVELS) expect(LEVEL_LABELS[level]).toBeTruthy();
  });

  it("starts every label with a capital", () => {
    const all = [...Object.values(SPORT_LABELS), ...Object.values(GENDER_LABELS), ...Object.values(LEVEL_LABELS)];
    for (const label of all) expect(label[0]).toBe(label[0].toUpperCase());
  });

  it("keeps JV an initialism rather than capitalizing it", () => {
    expect(levelLabel("jv")).toBe("JV");
    expect(levelLabel("varsity")).toBe("Varsity");
    expect(levelLabel("freshman")).toBe("Freshman");
  });

  it("capitalizes gender", () => {
    expect(genderLabel("boys")).toBe("Boys");
    expect(genderLabel("girls")).toBe("Girls");
    expect(genderLabel("coed")).toBe("Coed");
  });

  it("keeps a multi-word sport reading as one", () => {
    expect(sportLabel("water_polo")).toBe("Water polo");
  });

  it("passes null through, so a missing field can be left out rather than shown blank", () => {
    expect(genderLabel(null)).toBeNull();
    expect(levelLabel(null)).toBeNull();
    expect(sportLabel(null)).toBeNull();
    expect(genderLabel("")).toBeNull();
  });

  it("capitalizes an unknown value rather than dropping it", () => {
    // A value added to the database's check constraint before this map still reads.
    expect(levelLabel("sophomore")).toBe("Sophomore");
    expect(sportLabel("curling")).toBe("Curling");
  });
});

describe("describeTeam", () => {
  it("reads as a capitalized line", () => {
    expect(
      describeTeam({
        school: "Campbell Hall",
        sport: "volleyball",
        gender: "girls",
        level: "varsity",
        season: "26-27",
      }),
    ).toBe("Campbell Hall Girls Varsity Volleyball 26-27");
  });

  it("leaves out what the roster did not say", () => {
    expect(
      describeTeam({ school: "Crossroads", sport: "football", gender: null, level: null, season: null }),
    ).toBe("Crossroads Football");
  });
});
