import { beforeEach, describe, expect, it } from "vitest";
import { RATE_LIMITS, resetRateLimits, takeToken } from "@/lib/server/rateLimit";

describe("takeToken (AUTH-3)", () => {
  beforeEach(() => resetRateLimits());

  it("allows the limit, then refuses", () => {
    const { limit } = RATE_LIMITS.googleSignIn;
    for (let i = 0; i < limit; i++) expect(takeToken("googleSignIn", "1.2.3.4", 0)).toBe(true);
    expect(takeToken("googleSignIn", "1.2.3.4", 0)).toBe(false);
  });

  it("keeps subjects apart", () => {
    const { limit } = RATE_LIMITS.googleSignIn;
    for (let i = 0; i < limit; i++) takeToken("googleSignIn", "1.2.3.4", 0);
    expect(takeToken("googleSignIn", "5.6.7.8", 0)).toBe(true);
  });

  it("keeps limits apart for the same subject", () => {
    const { limit } = RATE_LIMITS.passwordSignInEmail;
    for (let i = 0; i < limit; i++) takeToken("passwordSignInEmail", "a@example.com", 0);
    expect(takeToken("passwordSignInEmail", "a@example.com", 0)).toBe(false);
    expect(takeToken("forgotPasswordEmail", "a@example.com", 0)).toBe(true);
  });

  it("refills over the window", () => {
    const { limit, per } = RATE_LIMITS.googleSignIn;
    for (let i = 0; i < limit; i++) takeToken("googleSignIn", "1.2.3.4", 0);
    expect(takeToken("googleSignIn", "1.2.3.4", 0)).toBe(false);
    expect(takeToken("googleSignIn", "1.2.3.4", per / limit)).toBe(true);
  });

  it("stays bounded under a flood of distinct keys", () => {
    for (let i = 0; i < 12_000; i++) takeToken("googleSignIn", `ip-${i}`, 0);
    // A fresh key still works, and nothing threw on the way.
    expect(takeToken("googleSignIn", "fresh", 0)).toBe(true);
  });
});
