import { describe, expect, it } from "vitest";
import { checklistSteps, showChecklist } from "@/app/home/checklist";

// Audit M15: a new account sees four steps on Home, each linking where to do it.

const team = (playerCount: number, statsAsOf: string | null = null) => ({ playerCount, statsAsOf });

describe("the first-run checklist", () => {
  it("shows while the account has fewer than two teams or no games", () => {
    expect(showChecklist({ teams: [], games: 0 })).toBe(true);
    expect(showChecklist({ teams: [team(20)], games: 3 })).toBe(true);
    expect(showChecklist({ teams: [team(20), team(22)], games: 0 })).toBe(true);
    expect(showChecklist({ teams: [team(20), team(22)], games: 1 })).toBe(false);
  });

  it("has the four steps in order, each with a link", () => {
    const steps = checklistSteps({ teams: [], games: 0 });
    expect(steps.map((step) => step.label)).toEqual([
      "Add both teams' rosters",
      "Import season stats (optional)",
      "Run a sound check",
      "Call a game in Chrome on a laptop",
    ]);
    expect(steps.map((step) => step.href)).toEqual(["/teams/new", "/teams", "/games/new", "/games/new"]);
    expect(steps.every((step) => !step.done)).toBe(true);
  });

  it("marks what it can see as done, and never the sound check", () => {
    const steps = checklistSteps({ teams: [team(20, "2026-10-01"), team(18)], games: 2 });
    expect(steps.map((step) => step.done)).toEqual([true, true, false, true]);
    // A team saved with no players yet is not a roster.
    expect(checklistSteps({ teams: [team(20), team(0)], games: 0 })[0].done).toBe(false);
  });
});
