import { describe, expect, it } from "vitest";
import { readSetupPicks, readSetupReturn, setupHref, stepHref } from "@/lib/game/setupReturn";

// Adding a team from game setup (docs/V3_DEFINITION.md 7.1): New game, the new
// team's roster, its season stats, and back with the team picked.

const AWAY = "0f8b7c3a-1d2e-4f5a-8b6c-7d8e9f0a1b2c";
const HOME = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const NEW = "11111111-2222-4333-8444-555555555555";

const params = (href: string) => Object.fromEntries(new URL(href, "https://spotter.test").searchParams);

describe("the way back to game setup", () => {
  it("goes from Add a team to the stats step and back, with the new team on its side", () => {
    const back = { side: "home" as const, away: AWAY, home: null };
    const roster = stepHref("/teams/new", back);
    expect(roster).toBe(`/teams/new?for=game&side=home&away=${AWAY}`);
    expect(readSetupReturn(params(roster))).toEqual(back);

    const stats = stepHref(`/teams/${NEW}/stats`, readSetupReturn(params(roster))!);
    const done = setupHref(readSetupReturn(params(stats))!, NEW);
    expect(done).toBe(`/games/new?away=${AWAY}&home=${NEW}`);
    expect(readSetupPicks(params(done))).toEqual({ away: AWAY, home: NEW });
  });

  it("replaces the side's old pick with the new team, and keeps the other side", () => {
    expect(setupHref({ side: "away", away: AWAY, home: HOME }, NEW)).toBe(`/games/new?away=${NEW}&home=${HOME}`);
  });

  it("goes back with the picks it had when nothing was added", () => {
    expect(setupHref({ side: "away", away: null, home: HOME })).toBe(`/games/new?home=${HOME}`);
    expect(setupHref({ side: "away", away: null, home: null })).toBe("/games/new");
  });

  it("is not there unless the page was reached from setup, with a side", () => {
    expect(readSetupReturn({})).toBeNull();
    expect(readSetupReturn({ side: "home" })).toBeNull();
    expect(readSetupReturn({ for: "game" })).toBeNull();
    expect(readSetupReturn({ for: "game", side: "middle" })).toBeNull();
  });

  it("keeps only real team ids, so nothing typed into the address reaches a query", () => {
    expect(readSetupPicks({ away: "1; drop table rosters", home: [HOME, AWAY] })).toEqual({ away: null, home: HOME });
  });
});
