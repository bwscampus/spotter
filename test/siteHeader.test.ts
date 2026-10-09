import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// docs/UI_STYLE.md, A1: one header, identical on every screen. The same items,
// in the same order, whichever link is current, signed in or signed out. It
// takes no children, so no page can add to it.

let pathname = "/home";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { SiteHeader } = await import("@/components/SiteHeader");
const { SiteChrome } = await import("@/components/SiteChrome");
const { NAV_LINKS, placeFor } = await import("@/lib/ui/nav");

const EMAIL = "announcer@example.com";

/** The header's items, left to right, as their text: the wordmark, the four links, Help, the email, Sign out. */
function items(html: string): string[] {
  const nav = /<nav[^>]*>([\s\S]*)<\/nav>/.exec(html)?.[1] ?? "";
  return [...nav.matchAll(/<(a|span|button)\b[^>]*>([^<]+)</g)].map((match) => match[2]);
}

const header = (current: Parameters<typeof SiteHeader>[0]["current"], email: string | null) =>
  renderToStaticMarkup(createElement(SiteHeader, { current, email }));

describe("the header", () => {
  const order = ["STATCAST", "Home", "New game", "Teams", "Past games", "Help", EMAIL, "Sign out"];

  it("has the same items in the same order whichever link is current, or none", () => {
    for (const current of [...NAV_LINKS.map((link) => link.key), null]) {
      expect(items(header(current, EMAIL))).toEqual(order);
    }
  });

  it("marks exactly one link current, the right one, and none on a page that is none of them", () => {
    for (const link of NAV_LINKS) {
      const html = header(link.key, EMAIL);
      const current = [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]+)</g)].map((match) => match[1]);
      expect(current).toEqual([link.label]);
    }
    expect(header(null, EMAIL)).not.toContain("aria-current");
  });

  it("gives every link the same weight and a 2px border either way, so being current moves nothing", () => {
    const html = header("teams", EMAIL);
    const links = [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).filter((tag) => tag.includes("border-y-2"));
    expect(links).toHaveLength(4);
    for (const tag of links) expect(tag).toContain("font-medium");
  });

  it("signed out: the same items in the same places, the links not clickable but Help, the account items hidden but still taking their space", () => {
    const html = header(null, null);
    // Same positions: the email's slot is there, empty of anyone's address.
    expect(items(html)).toEqual(["STATCAST", "Home", "New game", "Teams", "Past games", "Help", "Signed in", "Sign out"]);
    // Help is a public page, the way to a person when signing in fails.
    expect([...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1])).toEqual(["/contact"]);
    expect(html).not.toContain("aria-current");
    expect(html).toMatch(/data-header="email"[^>]*style="visibility:hidden"/);
    expect(html).toMatch(/data-header="signout"[^>]*style="visibility:hidden"/);
    expect(html).not.toContain(EMAIL);
  });

  it("signed in: the account items show, the email opens Settings, Help opens Contact, and Sign out still posts to /auth/signout", () => {
    const html = header("home", EMAIL);
    expect(html).not.toContain("visibility:hidden");
    expect(html).toMatch(new RegExp(`<a[^>]*href="/settings"[^>]*>${EMAIL}<`));
    expect(html).toMatch(/<a[^>]*href="\/contact"[^>]*>Help</);
    expect(html).toMatch(/<a[^>]*href="\/home"[^>]*>STATCAST</);
    const form = /<form\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/auth/signout"');
  });
});

describe("the chrome around every page", () => {
  const chrome = (path: string, email: string | null) => {
    pathname = path;
    return renderToStaticMarkup(createElement(SiteChrome, { email }));
  };

  it("is the header and nothing under it for a signed-in account", () => {
    expect(chrome("/teams", EMAIL)).toBe(header("teams", EMAIL));
  });

  it("puts the header in its signed-out state on sign in and reset password, whoever is signed in", () => {
    expect(items(chrome("/login", null))).toEqual(items(header(null, null)));
    expect(chrome("/reset-password", EMAIL)).not.toContain(EMAIL);
  });

  it("gives a signed-out visitor the public bar on the landing, privacy, terms and contact pages, and a signed-in one the header", () => {
    for (const path of ["/", "/privacy", "/terms", "/contact"]) {
      const html = chrome(path, null);
      expect(html, path).toContain('href="/login"');
      expect(html, path).not.toContain("Past games");
      expect(items(chrome(path, EMAIL)), path).toEqual(items(header(null, EMAIL)));
    }
  });

  it("leaves the live screen's own bar alone: nothing is drawn there", () => {
    expect(chrome("/live", EMAIL)).toBe("");
  });
});

describe("which link is current", () => {
  it("follows the path", () => {
    expect(placeFor("/home").current).toBe("home");
    expect(placeFor("/settings").current).toBeNull();
    expect(placeFor("/games/new").current).toBe("new-game");
    expect(placeFor("/games/new/names").current).toBe("new-game");
    expect(placeFor("/games/sound-check").current).toBe("new-game");
    expect(placeFor("/teams").current).toBe("teams");
    expect(placeFor("/teams/new").current).toBe("teams");
    expect(placeFor("/teams/abc/stats").current).toBe("teams");
    expect(placeFor("/teams/abc/cards").current).toBe("teams");
    expect(placeFor("/games").current).toBe("past-games");
    expect(placeFor("/games/").current).toBe("past-games");
  });

  it("is none on sign in and reset password, which show the signed-out header", () => {
    expect(placeFor("/login")).toEqual({ header: true, signedOut: true, public: false, current: null });
    expect(placeFor("/reset-password")).toEqual({ header: true, signedOut: true, public: false, current: null });
  });

  it("is none on the public pages, and only those are public", () => {
    for (const path of ["/", "/privacy", "/terms", "/contact"]) {
      expect(placeFor(path), path).toEqual({ header: true, signedOut: false, public: true, current: null });
    }
    for (const path of ["/home", "/teams", "/games", "/settings", "/login"]) expect(placeFor(path).public, path).toBe(false);
  });

  it("has no header on the live screen", () => {
    expect(placeFor("/live").header).toBe(false);
  });
});

describe("no page feeds the header", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  }

  it("is never given children, by any file under app/ or components/", () => {
    const uses: string[] = [];
    for (const file of [...sources("app"), ...sources("components")]) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/<SiteHeader\b([^>]*?)(\/?)>/g)) {
        uses.push(file);
        expect(match[2], `${file} opens <SiteHeader> with children`).toBe("/");
        expect(match[1], `${file} passes children to SiteHeader`).not.toMatch(/\bchildren\b/);
      }
      expect(text, `${file} renders SiteHeader through createElement with children`).not.toMatch(/createElement\(\s*SiteHeader\s*,[^)]*,/);
    }
    // The one place it is drawn: the chrome in the root layout.
    expect(uses).toEqual([join("components", "SiteChrome.tsx")]);
  });

  it("takes no children prop at all", () => {
    const text = readFileSync(join("components", "SiteHeader.tsx"), "utf8");
    const signature = /export function SiteHeader\(([\s\S]*?)\)\s*\{/.exec(text)?.[1] ?? "";
    expect(signature).toContain("current");
    expect(signature).toContain("email");
    expect(signature).not.toMatch(/children|ReactNode/);
  });
});
