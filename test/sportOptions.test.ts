import { describe, expect, it } from "vitest";
import { MORE_SPORTS, sportOptions, startingSport } from "@/lib/rosters/sportOptions";
import { SPORTS } from "@/lib/rosters/types";

// A new team's Sport list (Nov 3): the announcer's own sports first, "Other
// sports..." for the rest, and one sport starts picked.

const values = (options: ReturnType<typeof sportOptions>) => options.map((option) => option.value);

describe("the Sport list on a new team", () => {
  it("is every sport, as before, for an announcer who picked none", () => {
    expect(values(sportOptions([], "", false))).toEqual([...SPORTS]);
    expect(startingSport([])).toBe("");
  });

  it("lists the announcer's sports first, in the usual order, then Other sports", () => {
    const options = sportOptions(["basketball", "football"], "", false);
    expect(values(options)).toEqual(["football", "basketball", MORE_SPORTS]);
    expect(options.at(-1)?.label).toBe("Other sports...");
  });

  it("opens the full list after Other sports, the announcer's still first", () => {
    const all = values(sportOptions(["volleyball", "soccer"], "", true));
    expect(all.slice(0, 2)).toEqual(["volleyball", "soccer"]);
    expect([...all].sort()).toEqual([...SPORTS].sort());
    expect(all).not.toContain(MORE_SPORTS);
  });

  it("always shows the sport the team has, even one the announcer did not pick", () => {
    expect(values(sportOptions(["football"], "lacrosse", false))).toEqual(["football", "lacrosse", MORE_SPORTS]);
  });

  it("starts a new team on the announcer's one sport, and on none for two or more", () => {
    expect(startingSport(["football"])).toBe("football");
    expect(startingSport(["football", "basketball"])).toBe("");
  });

  it("needs no Other sports option when every sport is already listed", () => {
    expect(values(sportOptions([...SPORTS], "", false))).toEqual([...SPORTS]);
  });
});
