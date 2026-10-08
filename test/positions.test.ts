import { describe, expect, it } from "vitest";
import { allowedGroups, positionAllows, positionGroups, requiredSide, unitOf } from "@/lib/livestats/positions";

// What a roster's position text means to the stat check. Positions are free
// text as printed, so the reading has to cope with codes, words and lists.

describe("positionGroups", () => {
  it("reads the codes a roster prints", () => {
    expect(positionGroups("QB")).toEqual(["qb"]);
    expect(positionGroups("rb")).toEqual(["skill"]);
    expect(positionGroups("TE")).toEqual(["skill"]);
    expect(positionGroups("C")).toEqual(["ol"]);
    expect(positionGroups("DE")).toEqual(["dl"]);
    expect(positionGroups("OLB")).toEqual(["lb"]);
    expect(positionGroups("CB")).toEqual(["db"]);
    expect(positionGroups("PK")).toEqual(["k"]);
    expect(positionGroups("P")).toEqual(["p"]);
    expect(positionGroups("LS")).toEqual(["ls"]);
  });

  it("reads spelled-out positions, most specific first", () => {
    expect(positionGroups("Wide Receiver")).toEqual(["skill"]);
    expect(positionGroups("Defensive Tackle")).toEqual(["dl"]);
    expect(positionGroups("Offensive Tackle")).toEqual(["ol"]);
    expect(positionGroups("Strong Safety")).toEqual(["db"]);
    expect(positionGroups("Place Kicker")).toEqual(["k"]);
    expect(positionGroups("Quarterback")).toEqual(["qb"]);
  });

  it("keeps every group a list names, and gives unknown when it names none", () => {
    expect(positionGroups("OL/DL")).toEqual(["ol", "dl"]);
    expect(positionGroups("WR, CB")).toEqual(["skill", "db"]);
    expect(positionGroups("ATH")).toEqual(["unknown"]);
    expect(positionGroups("")).toEqual(["unknown"]);
    expect(positionGroups(null)).toEqual(["unknown"]);
  });

  it("knows which side of the ball each group plays on", () => {
    expect(unitOf("qb")).toBe("offense");
    expect(unitOf("db")).toBe("defense");
    expect(unitOf("p")).toBe("special");
    expect(unitOf("unknown")).toBeNull();
  });
});

describe("what each action allows", () => {
  it("passes a position nobody wrote and a position that fits, and fails one that does not", () => {
    expect(positionAllows("ATH", allowedGroups("pass_complete"))).toBe(true);
    expect(positionAllows(null, allowedGroups("tackle"))).toBe(true);
    expect(positionAllows("QB", allowedGroups("pass_complete"))).toBe(true);
    expect(positionAllows("WR", allowedGroups("pass_complete"))).toBe(false);
    expect(positionAllows("CB", allowedGroups("reception"))).toBe(false);
    expect(positionAllows("WR/CB", allowedGroups("reception"))).toBe(true);
    expect(positionAllows("OL", allowedGroups("rush"))).toBe(false);
    expect(positionAllows("QB", allowedGroups("tackle"))).toBe(false);
    expect(positionAllows("K", allowedGroups("tackle"))).toBe(false);
    expect(positionAllows("OL", allowedGroups("tackle"))).toBe(true);
    expect(positionAllows("P", allowedGroups("punt"))).toBe(true);
    expect(positionAllows("K", allowedGroups("punt"))).toBe(true);
    expect(positionAllows("RB", allowedGroups("punt"))).toBe(false);
    expect(positionAllows("P", allowedGroups("field_goal"))).toBe(true);
    expect(positionAllows("DL", allowedGroups("fumble_recovery"))).toBe(true);
  });

  it("puts each action on a side of the ball", () => {
    expect(requiredSide("rush", "home")).toBe("home");
    expect(requiredSide("punt", "away")).toBe("away");
    expect(requiredSide("tackle", "home")).toBe("away");
    expect(requiredSide("punt_return", "home")).toBe("away");
    expect(requiredSide("kick_return", "away")).toBe("home");
    expect(requiredSide("fumble_recovery", "home")).toBeNull();
  });
});
