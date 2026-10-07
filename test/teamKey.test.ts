import { describe, expect, it } from "vitest";
import { teamKey } from "@/lib/rosters/teamKey";

describe("teamKey", () => {
  it("lowercases and joins the five parts", () => {
    expect(
      teamKey({
        school: "Campbell Hall",
        sport: "volleyball",
        gender: "girls",
        level: "varsity",
        season: "26-27",
      }),
    ).toBe("campbell hall|volleyball|girls|varsity|26-27");
  });

  it("keeps the position of missing parts so keys stay stable", () => {
    expect(
      teamKey({ school: "Crossroads", sport: "volleyball", gender: null, level: null, season: "26-27" }),
    ).toBe("crossroads|volleyball|||26-27");
  });

  it("trims whitespace the way the database does", () => {
    expect(
      teamKey({ school: "  Campbell Hall ", sport: "football", gender: "boys", level: "jv", season: " 26-27 " }),
    ).toBe("campbell hall|football|boys|jv|26-27");
  });
});
