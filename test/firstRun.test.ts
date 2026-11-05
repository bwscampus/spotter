import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GameSetup } from "@/components/game/GameSetup";
import { NameDisplay } from "@/components/NameDisplay";
import { AddStatsChoice, RosterEditor } from "@/components/rosters/RosterEditor";
import { hasHeldFiles, holdFiles, takeHeldFiles } from "@/lib/rosters/heldFiles";
import { EMPTY_TEAM } from "@/lib/rosters/editor";
import type { TeamSummary } from "@/lib/rosters/types";

// The smaller first-run fixes (Nov 3): big add-team boxes on New game for an
// account with fewer than two teams, Save team with stats offered after it,
// and the live screen's hint until a card goes up. Made-up schools.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }) }));
// next/font only works inside Next's own build; here every face is a class name.
vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-test", style: { fontFamily: "Test" } });
  return { Atkinson_Hyperlegible_Next: font, IBM_Plex_Sans: font, IBM_Plex_Mono: font };
});

const summary = (id: string, school: string): TeamSummary => ({
  id,
  school,
  mascot: null,
  sport: "football",
  gender: null,
  level: null,
  season: null,
  updated_at: "",
  playerCount: 30,
  statsAsOf: null,
  hasStats: false,
  hasSchedule: false,
});

describe("New game with fewer than two saved teams", () => {
  it("shows a big box per side into adding that side's team, instead of empty lists", () => {
    const html = renderToStaticMarkup(createElement(GameSetup, { rosters: [] }));
    expect(html).toContain("Add the away team");
    expect(html).toContain("Add the home team");
    expect(html).toContain("Drop a roster here: a MaxPreps PDF, a photo, or a spreadsheet.");
    expect(html).toMatch(/<a [^>]*href="\/teams\/new\?for=game&amp;side=away"[^>]*data-testid="add-away-team"|<a [^>]*data-testid="add-away-team"[^>]*href="\/teams\/new\?for=game&amp;side=away"/);
    expect(html).not.toContain("No saved teams yet");
  });

  it("offers the one saved team with a click, and keeps the box for the other side", () => {
    const html = renderToStaticMarkup(createElement(GameSetup, { rosters: [summary("t1", "Millbrook")] }));
    expect(html.match(/>use Millbrook Football</g)?.length).toBe(2);
    const picked = renderToStaticMarkup(createElement(GameSetup, { rosters: [summary("t1", "Millbrook")], initialPicks: { away: "t1", home: null } }));
    expect(picked).toContain("Add the home team");
    expect(picked).not.toContain("Add the away team");
    expect(picked).not.toContain(">use Millbrook");
  });

  it("keeps the pickers once there are two teams", () => {
    const html = renderToStaticMarkup(createElement(GameSetup, { rosters: [summary("t1", "Millbrook"), summary("t2", "Harborview")] }));
    expect(html).not.toContain("Add the away team");
    expect(html).toContain("Pick the away team");
  });

  it("carries a dropped file to the new team's roster box, once", () => {
    const file = new File(["2 Theo Quillon QB"], "roster.csv", { type: "text/csv" });
    holdFiles("roster", [file]);
    expect(hasHeldFiles("roster")).toBe(true);
    expect(takeHeldFiles("roster")).toEqual([file]);
    expect(takeHeldFiles("roster")).toBeNull();
    holdFiles("roster", []);
    expect(hasHeldFiles("roster")).toBe(false);
  });
});

describe("adding a team from setup", () => {
  const then = { side: "home" as const, away: "a1", home: null, draft: null };

  it("says Save team, with no step numbers", () => {
    const html = renderToStaticMarkup(createElement(RosterEditor, { initial: { id: null, team: EMPTY_TEAM, players: [] }, then }));
    expect(html).toContain(">Save team</button>");
    expect(html).not.toMatch(/Step [12] of 2|Save and add stats/);
  });

  it("asks Add season stats? with two equal buttons, both back the way they went", () => {
    const html = renderToStaticMarkup(
      createElement(AddStatsChoice, { school: "Harborview", addHref: "/teams/t9/stats?for=game&side=home&away=a1", skipHref: "/games/new?away=a1&home=t9" }),
    );
    expect(html).toContain("Add season stats?");
    expect(html).toContain("Cards will show numbers like <em>812 yds, 9 TD</em>.");
    const buttons = [...html.matchAll(/<a class="([^"]*)" href="([^"]*)">(Add stats|Not now)<\/a>/g)];
    expect(buttons.map((match) => [match[3], match[2]])).toEqual([
      ["Add stats", "/teams/t9/stats?for=game&amp;side=home&amp;away=a1"],
      ["Not now", "/games/new?away=a1&amp;home=t9"],
    ]);
    expect(buttons[0][1]).toBe(buttons[1][1]);
  });
});

describe("the live screen's first-card hint", () => {
  it("sits inside the placeholder that show() hides when a card goes up, so nothing new runs on the card path", () => {
    const html = renderToStaticMarkup(
      createElement(NameDisplay, {
        ref: null,
        dimmed: false,
        placeholder: "Listening for 40 names",
        tonight: false,
        hint: createElement("span", null, "Say a last name, like Johnson, or a number, like number 22."),
      }),
    );
    const placeholder = /<p class="absolute inset-0[^"]*">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    expect(placeholder).toContain("Listening for 40 names");
    expect(placeholder).toContain('data-testid="first-card-hint"');
    expect(placeholder).toContain("Say a last name, like Johnson, or a number, like number 22.");
  });

  it("changes nothing about the cards' markup", () => {
    const props = { ref: null, dimmed: false, placeholder: "x", tonight: false };
    const cards = (html: string) => html.replace(/<p class="absolute inset-0[\s\S]*?<\/p>/, "");
    expect(cards(renderToStaticMarkup(createElement(NameDisplay, { ...props, hint: "Say a last name" })))).toBe(
      cards(renderToStaticMarkup(createElement(NameDisplay, props))),
    );
  });
});
