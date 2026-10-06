import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "@/lib/securityHeaders";

const header = (name: string) =>
  securityHeaders(true).find((h) => h.key === name)?.value ?? "";

describe("security headers (API-4)", () => {
  it("sends every header the standard requires", () => {
    const names = securityHeaders(true).map((h) => h.key);
    for (const name of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("allows the microphone for this origin, because the live screen listens", () => {
    expect(header("Permissions-Policy")).toContain("microphone=(self)");
    expect(header("Permissions-Policy")).not.toContain("microphone=()");
  });

  it("lets the Deepgram socket and Google sign-in through", () => {
    const csp = contentSecurityPolicy(true);
    expect(csp).toMatch(/connect-src [^;]*wss:\/\/api\.deepgram\.com/);
    expect(csp).toMatch(/script-src [^;]*https:\/\/accounts\.google\.com\/gsi\/client/);
    expect(csp).toMatch(/frame-src https:\/\/accounts\.google\.com\/gsi\//);
  });

  it("forbids framing and plugins", () => {
    const csp = contentSecurityPolicy(true);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(header("X-Frame-Options")).toBe("DENY");
  });

  it("allows eval only in development", () => {
    expect(contentSecurityPolicy(true)).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(false)).toContain("'unsafe-eval'");
  });
});
