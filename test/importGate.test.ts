import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalProvider } from "@/components/auth/Approval";
import { RosterImport } from "@/components/rosters/RosterImport";
import { StatsImport } from "@/components/stats/StatsImport";
import { WAITING_NOTE } from "@/lib/auth/approval";

// The stats page navigates after a save; nothing here saves, so a stand-in router will do.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));

// An account waiting for approval can type players in by hand but cannot
// import, because every import calls Anthropic. The route refuses it too (see
// test/requireApprovedUser.test.ts); this is the page saying so first.

function render(approved: boolean): string {
  return renderToStaticMarkup(
    createElement(
      ApprovalProvider,
      // children arrives as the third argument; the cast only satisfies the prop type.
      { approved } as ComponentProps<typeof ApprovalProvider>,
      createElement(RosterImport, { onImported: () => undefined }),
    ),
  );
}

describe("the import panel", () => {
  it("is disabled with the waiting note while the account waits for approval", () => {
    const html = render(false);
    expect(html).toContain(WAITING_NOTE);
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    expect(buttons.length).toBeGreaterThan(0);
    // The attribute, not the "disabled:" Tailwind classes every button carries.
    expect(buttons.every((button) => button.includes(' disabled=""'))).toBe(true);
    expect(html).toMatch(/<textarea[^>]* disabled=""/);
  });

  it("is open, with no note, once approved", () => {
    const html = render(true);
    expect(html).not.toContain(WAITING_NOTE);
    expect(html).toMatch(/<button[^>]*>Choose files/);
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Choose files/);
  });
});

function renderStats(approved: boolean, playerCount = 20): string {
  return renderToStaticMarkup(
    createElement(
      ApprovalProvider,
      { approved } as ComponentProps<typeof ApprovalProvider>,
      createElement(StatsImport, { rosterId: "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10", playerCount }),
    ),
  );
}

// Reading a stats sheet calls Anthropic too, so the same rule holds for it.
describe("the season stats import", () => {
  it("is disabled with the waiting note while the account waits for approval", () => {
    const html = renderStats(false);
    expect(html).toContain(WAITING_NOTE);
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((match) => match[0]);
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.includes(' disabled=""'))).toBe(true);
    expect(html).toMatch(/<textarea[^>]* disabled=""/);
  });

  it("is open once approved", () => {
    const html = renderStats(true);
    expect(html).not.toContain(WAITING_NOTE);
    expect(html).not.toMatch(/<button[^>]* disabled=""[^>]*>Choose files/);
  });

  it("stays shut, and says why, until the team has a saved roster to match against", () => {
    const html = renderStats(true, 0);
    expect(html).toContain("Save this team&#x27;s roster first.");
    expect(html).toMatch(/<button[^>]* disabled=""[^>]*>Choose files/);
  });
});
