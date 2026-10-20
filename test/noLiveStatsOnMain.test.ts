import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// =============================================================================
// main has no live stats (Jed, Oct 20: "no live stats at all. Like not even an
// option. Live stats stays on testrun2."). The engine (lib/livestats/,
// components/livestats/) and its offline tools stay in the repo, so testrun2
// and main share it and a testrun2 merge stays small, but nothing a user can
// reach on main leads to it: no switch on game setup, no stats loop around the
// live screen, and no route that reads a play or spends money on one.
//
// This file lives on main only. A merge from testrun2 that brings a door back
// fails here; keep main's side of these files. Bringing main into testrun2
// goes the other way: keep testrun2's side of them, and leave this file out.
// =============================================================================

const ROOT = new URL("..", import.meta.url);
const source = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

describe("main has no live stats", () => {
  it("has no live stats routes", () => {
    expect(existsSync(new URL("app/api/livestats", ROOT))).toBe(false);
  });

  it("renders the names-only live screen, never the stats loop", () => {
    const page = source("app/live/page.tsx");
    expect(page).toMatch(/from "@\/components\/live\/LiveScreen"/);
    expect(page).not.toMatch(/components\/livestats/);
  });

  it("offers no switch at game setup, and starts every game with stats off", () => {
    const setup = source("components/game/GameSetup.tsx");
    expect(setup).not.toMatch(/components\/livestats|LiveStatsSwitch|OutTonight/);
    expect(setup).toMatch(/const statsEnabled = false;/);
  });

  it("leaves no product file importing the stats folders but the unused wrapper", () => {
    // Only components/livestats/LiveGame.tsx (testrun2's live page) imports the loop,
    // and nothing on main imports LiveGame.
    for (const path of ["app/live/page.tsx", "components/game/GameSetup.tsx", "components/game/CurrentGame.tsx", "app/games/new/page.tsx"]) {
      if (existsSync(new URL(path, ROOT))) expect(source(path), path).not.toMatch(/LiveGame|components\/livestats/);
    }
  });
});
