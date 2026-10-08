import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// Ported from V3's test/proxySession.test.ts (audit L3). V3's proxy refreshed
// the Supabase session and verified its token on every page request; this
// repo's proxy.ts only checks that a session cookie exists and never touches
// the database (pages and routes check the session themselves, in
// lib/server/auth.ts). So V3's cases about a token that fails to verify, and
// about Supabase being unreachable, have no counterpart here: there is no
// token to verify in the proxy and nothing to reach.

// Proves the proxy never reads the database: any call would throw.
vi.mock("@/lib/server/db", () => {
  const refuse = () => {
    throw new Error("the proxy touched the database");
  };
  return { query: refuse, queryOne: refuse, withTransaction: refuse, getPool: refuse };
});

import { config, proxy } from "@/proxy";
import { isPublicPath } from "@/lib/publicPaths";
import { SESSION_COOKIE } from "@/lib/server/sessionCookie";

function request(path: string, cookie = true): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `${SESSION_COOKIE}=whatever`);
  return new NextRequest(new URL(path, "https://thespottingboard.com"), { headers });
}

const location = (response: Response) => response.headers.get("location");

describe("the session check in front of every page", () => {
  it("lets a request with a session cookie through, without reading the database", () => {
    for (const path of ["/home", "/live", "/teams/abc", "/games/new?away=1&home=2"]) {
      expect(location(proxy(request(path))), path).toBeNull();
    }
  });

  it("sends a request with no session cookie to /login, dropping the query", () => {
    expect(location(proxy(request("/teams", false)))).toBe("https://thespottingboard.com/login");
    expect(location(proxy(request("/games/new?away=abc&home=def", false)))).toBe("https://thespottingboard.com/login");
  });

  it("does not take another cookie for the session", () => {
    const headers = new Headers({ cookie: "sb-project-auth-token=whatever" });
    const forged = new NextRequest(new URL("/live", "https://thespottingboard.com"), { headers });
    expect(location(proxy(forged))).toBe("https://thespottingboard.com/login");
  });

  it("serves the public pages to anyone", () => {
    for (const path of ["/", "/privacy", "/terms", "/contact", "/login", "/robots.txt", "/sitemap.xml", "/reset-password", "/auth/verify"]) {
      expect(location(proxy(request(path, false))), path).toBeNull();
    }
  });

  it("never runs on the API routes, so uploads are not buffered and routes check the session themselves", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/api/rosters/extract")).toBe(false);
    expect(matcher.test("/pcm-capture-worklet.js")).toBe(false);
    expect(matcher.test("/live")).toBe(true);
    expect(matcher.test("/teams/abc")).toBe(true);
  });
});

describe("which paths are public", () => {
  it("matches / exactly, never as a prefix of every path", () => {
    expect(isPublicPath("/")).toBe(true);
    for (const path of ["/home", "/teams", "/games/new", "/settings", "/live", "/privacy-x", "/termsheet"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
    expect(isPublicPath("/privacy")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
  });

  it("includes the password reset page, and nothing that only starts like it", () => {
    expect(isPublicPath("/reset-password")).toBe(true);
    expect(isPublicPath("/reset-password/x")).toBe(true);
    expect(isPublicPath("/reset-passwords")).toBe(false);
    expect(isPublicPath("/login-as-admin")).toBe(false);
  });
});
