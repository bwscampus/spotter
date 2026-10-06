import { describe, expect, it } from "vitest";
import { isOffensiveLineman } from "@/lib/rosters/isOffensiveLineman";

describe("isOffensiveLineman", () => {
  it("counts every offensive line code", () => {
    for (const position of ["OL", "OT", "OG", "C", "T", "G", "OL/OT", "C, G"]) {
      expect(isOffensiveLineman(position, "football"), position).toBe(true);
    }
  });

  it("no longer counts the defensive line or linebackers", () => {
    for (const position of ["DL", "DT", "DE", "NT", "NG", "LB", "MLB", "OLB", "DT, NT"]) {
      expect(isOffensiveLineman(position, "football"), position).toBe(false);
    }
  });

  it("keeps a player who also plays somewhere that gets named", () => {
    expect(isOffensiveLineman("OL/DL", "football")).toBe(false);
    expect(isOffensiveLineman("TE, OL", "football")).toBe(false);
    expect(isOffensiveLineman("C/LB", "football")).toBe(false);
  });

  it("keeps a player with no position listed", () => {
    expect(isOffensiveLineman("", "football")).toBe(false);
    expect(isOffensiveLineman("   ", "football")).toBe(false);
    expect(isOffensiveLineman(null, "football")).toBe(false);
  });

  it("reads spelled-out offensive line positions", () => {
    expect(isOffensiveLineman("Offensive Line", "football")).toBe(true);
    expect(isOffensiveLineman("Offensive Lineman", "football")).toBe(true);
    expect(isOffensiveLineman("Offensive Tackle", "football")).toBe(true);
    expect(isOffensiveLineman("Left Tackle", "football")).toBe(true);
    expect(isOffensiveLineman("Guard", "football")).toBe(true);
    expect(isOffensiveLineman("Center", "football")).toBe(true);
  });

  it("does not mistake a spelled-out defensive position for the offensive line", () => {
    expect(isOffensiveLineman("Defensive Line", "football")).toBe(false);
    expect(isOffensiveLineman("Defensive Tackle", "football")).toBe(false);
    expect(isOffensiveLineman("Nose Tackle", "football")).toBe(false);
    expect(isOffensiveLineman("Nose Guard", "football")).toBe(false);
    expect(isOffensiveLineman("Defensive End", "football")).toBe(false);
    expect(isOffensiveLineman("Wide Receiver", "football")).toBe(false);
  });

  it("only applies to football", () => {
    expect(isOffensiveLineman("C", "baseball")).toBe(false);
    expect(isOffensiveLineman("C", "softball")).toBe(false);
    expect(isOffensiveLineman("OL", "volleyball")).toBe(false);
    expect(isOffensiveLineman("C", null)).toBe(false);
  });

  it("is case and separator insensitive", () => {
    expect(isOffensiveLineman("ol", "football")).toBe(true);
    expect(isOffensiveLineman("OT  OG", "football")).toBe(true);
    expect(isOffensiveLineman("OT | OG", "football")).toBe(true);
  });
});
