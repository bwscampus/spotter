import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// =============================================================================
// main has no live stats (Jed, Nov 1: "Take live stats off of main", once the
// first outside announcer started using thestatcast.com; the same closing as
// Oct 20's, undone on Oct 28). The engine (lib/livestats/, components/livestats/)
// and its offline tools stay in the repo, so testrun2 and main share it and a
// testrun2 merge stays small, but nothing a user can reach on main leads to it:
// no switch on game setup, no stats loop around the live screen, and no route
// that reads a play or spends money on one.
//
// This file lives on main only. A merge from testrun2 that brings a door back
// fails here; keep main's side of these files. Bringing main into testrun2
// goes the other way: keep testrun2's side of them, and leave this file out.
// =============================================================================

const ROOT = new URL("..", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, ROOT), "utf8");
/** What a file imports, comments aside: every module named after a `from` or in an import(). */
const imports = (path: string) => [...source(path).matchAll(/(?:from\s+|import\()\s*["']([^"']+)["']/g)].map((match) => match[1]);

describe("main has no live stats", () => {
  it("has no live stats routes", () => {
    expect(existsSync(new URL("app/api/livestats", ROOT))).toBe(false);
  });

  it("renders the names-only live screen, never the stats loop", () => {
    expect(imports("app/live/page.tsx")).toContain("@/components/game/LiveNamesGame");
    expect(imports("app/live/page.tsx").filter((name) => name.includes("livestats"))).toEqual([]);
    expect(imports("components/game/LiveNamesGame.tsx")).toContain("@/components/live/LiveScreen");
    expect(imports("components/game/LiveNamesGame.tsx").filter((name) => name.includes("livestats"))).toEqual([]);
    // The live screen gets no stats bridge, Stats menu or latest stat.
    expect(source("components/game/LiveNamesGame.tsx")).not.toMatch(/statsMenu=|statsLatest=|\bstats=/);
  });

  it("offers no switch at game setup, and starts every game with stats off", () => {
    const setup = source("components/game/GameSetup.tsx");
    expect(setup).not.toMatch(/components\/livestats|LiveStatsSwitch|OutTonight/);
    expect(setup).toMatch(/const statsEnabled = false;/);
  });

  it("leaves no product file importing the stats folders but the unused wrapper", () => {
    // Only components/livestats/LiveGame.tsx (testrun2's live page) imports the loop,
    // and nothing on main imports LiveGame.
    for (const path of [
      "app/live/page.tsx",
      "components/game/LiveNamesGame.tsx",
      "components/game/GameSetup.tsx",
      "components/game/CurrentGame.tsx",
      "app/games/new/page.tsx",
      "app/home/page.tsx",
    ]) {
      if (existsSync(new URL(path, ROOT))) expect(imports(path).filter((name) => /livestats|LiveGame$/.test(name)), path).toEqual([]);
    }
  });

  it("previews cards without the TONIGHT section no game on main can have", () => {
    expect(source("components/cards/CardsPreview.tsx")).toMatch(/<PlayerCard [^>]*tonight=\{false\}/);
  });

  it("does not describe live stats to users", () => {
    for (const path of ["app/privacy/page.tsx", "app/terms/page.tsx", "app/page.tsx", "components/game/CurrentGame.tsx"]) {
      expect(source(path), path).not.toMatch(/live stats/i);
    }
  });
});
