import { describe, expect, it } from "vitest";
import { leavesPage } from "@/components/rosters/useUnsavedGuard";

// Audit, Nov 1: a click on a link inside the app left the team page without a word.

const here = { href: "https://thestatcast.com/teams/abc", origin: "https://thestatcast.com", pathname: "/teams/abc", search: "" } as Location;
const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const link = (href: string, extra: { target?: string; download?: boolean } = {}) =>
  ({
    href: new URL(href, here.href).href,
    target: extra.target ?? "",
    hasAttribute: (name: string) => name === "download" && Boolean(extra.download),
  }) as unknown as HTMLAnchorElement;

describe("which clicks leave the page", () => {
  it("is a plain click on a link to another page of the app", () => {
    expect(leavesPage(click, link("/teams"), here)).toBe(true);
    expect(leavesPage(click, link("/home"), here)).toBe(true);
    expect(leavesPage(click, link("/teams/abc?for=game"), here)).toBe(true);
  });

  it("is not a link to this same page, another site, a new tab or a download", () => {
    expect(leavesPage(click, link("/teams/abc"), here)).toBe(false);
    expect(leavesPage(click, link("https://example.com/"), here)).toBe(false);
    expect(leavesPage({ ...click, metaKey: true }, link("/teams"), here)).toBe(false);
    expect(leavesPage(click, link("/teams", { target: "_blank" }), here)).toBe(false);
    expect(leavesPage(click, link("/x.json", { download: true }), here)).toBe(false);
    expect(leavesPage(click, null, here)).toBe(false);
  });
});
