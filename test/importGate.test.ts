import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RosterImport } from "@/components/rosters/RosterImport";
import { StatsImport } from "@/components/stats/StatsImport";

// The stats page navigates after a save; nothing here saves, so a stand-in router will do.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

// Every account is approved when it signs up (Oct 7), so an import is open to
// anyone signed in. The routes check the sign-in themselves (see
// test/requireUser.test.ts).

/** The roster import, opened from its bar (the team page folds it to one bar until asked). */
function render(open = true): string {
  return renderToStaticMarkup(createElement(RosterImport, { onImported: () => undefined, open }));
}

describe("the import panel", () => {
  it("is open, with nothing waiting", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*>Choose files/);
    // The attribute, not the "disabled:" Tailwind classes every button carries.
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Choose files/);
    expect(html).not.toMatch(/<textarea[^>]* disabled=""/);
  });

  it("folds to its bar until it is opened", () => {
    const html = render(false);
    expect(html).not.toContain("Choose files");
  });
});

function renderStats(playerCount = 20): string {
  return renderToStaticMarkup(
    createElement(StatsImport, { rosterId: "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10", playerCount }),
  );
}

describe("the season stats import", () => {
  it("is open once the team has a saved roster", () => {
    const html = renderStats();
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Choose files/);
  });

  it("stays shut, and says why, until the team has a saved roster to match against", () => {
    const html = renderStats(0);
    expect(html).toContain("Save this team&#x27;s roster first.");
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Choose files/);
  });
});
