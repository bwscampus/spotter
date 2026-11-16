import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }) }));

const { AboutYou } = await import("@/components/onboarding/AboutYou");
const { JoinGame } = await import("@/components/booth/JoinGame");
const { ROLE_LABELS } = await import("@/lib/onboarding/about");

// =============================================================================
// Booth partners (Nov 15): an announcer who signed up to join a partner's
// game is asked only what kind of announcing he does. His sport is the game's;
// the rest can wait for Settings.
// =============================================================================

describe("an invited sign-up's one question", () => {
  it("asks what kind of announcing, with every kind spelled as the app spells it, and not the sports", () => {
    const html = renderToStaticMarkup(createElement(AboutYou, { initial: { sports: [], roles: [] }, mode: "booth", boothSport: "football" }));
    expect(html).toContain("What kind of announcing do you do?");
    expect(html).not.toContain("What sports do you call?");
    for (const label of Object.values(ROLE_LABELS)) expect(html).toContain(label);
    expect(html).toContain("TV / streaming color");
    expect(html).toContain("Radio color");
    expect(html).not.toMatch(/colour/i);
    expect(html).toContain("Skip");
  });

  it("is what the invite link shows a new account, before it joins", () => {
    const html = renderToStaticMarkup(createElement(JoinGame, { token: "A".repeat(43), needsRoles: true, sport: "soccer" }));
    expect(html).toContain("What kind of announcing do you do?");
    expect(html).not.toContain("What sports do you call?");
  });

  it("an account that already answered goes straight to joining", () => {
    const html = renderToStaticMarkup(createElement(JoinGame, { needsRoles: false }));
    expect(html).not.toContain("What kind of announcing do you do?");
    expect(html).toContain("The game&#x27;s code");
  });

  it("onboarding and Settings still ask both questions", () => {
    for (const mode of ["onboarding", "settings"] as const) {
      const html = renderToStaticMarkup(createElement(AboutYou, { initial: { sports: [], roles: [] }, mode }));
      expect(html).toContain("What sports do you call?");
      expect(html).toContain("What kind of announcing do you do?");
    }
  });
});
