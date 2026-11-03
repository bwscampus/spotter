import { describe, expect, it } from "vitest";
import { checklistSteps, showChecklist } from "@/app/home/checklist";

// Audit M15, made simpler on Nov 1: a new account sees three steps on Home,
// each linking where to do it, until its first game.

const team = (playerCount: number) => ({ playerCount });

describe("the first-run steps", () => {
  it("show until the account's first game", () => {
    expect(showChecklist({ teams: [], games: 0 })).toBe(true);
    expect(showChecklist({ teams: [team(20), team(22)], games: 0 })).toBe(true);
    expect(showChecklist({ teams: [team(20)], games: 3 })).toBe(false);
    expect(showChecklist({ teams: [team(20), team(22)], games: 1 })).toBe(false);
  });

  it("are three steps in order, each with a link", () => {
    const steps = checklistSteps({ teams: [], games: 0 });
    expect(steps.map((step) => step.label)).toEqual(["Add both teams", "Set up the game and run a sound check", "Call the game"]);
    expect(steps.map((step) => step.href)).toEqual(["/teams/new", "/games/new", "/games/new"]);
    expect(steps.every((step) => !step.done)).toBe(true);
  });

  it("mark what they can see as done, and never the sound check", () => {
    const steps = checklistSteps({ teams: [team(20), team(18)], games: 2 });
    expect(steps.map((step) => step.done)).toEqual([true, false, true]);
    // A team saved with no players yet is not a roster.
    expect(checklistSteps({ teams: [team(20), team(0)], games: 0 })[0].done).toBe(false);
  });
});
