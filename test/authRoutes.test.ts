import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCookieJar, fakeDatabase } from "./fakeServer";

let jar = fakeCookieJar();
let db = fakeDatabase();
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));
vi.mock("@/lib/server/google", async (original) => ({
  ...(await original<typeof import("@/lib/server/google")>()),
  verifyGoogleIdToken: vi.fn(),
}));

import { POST as signIn } from "@/app/api/auth/google/route";
import { GET as nonce } from "@/app/api/auth/nonce/route";
import { GET as health } from "@/app/api/health/route";
import { sha256Hex } from "@/lib/auth/googleNonce";
import { GoogleTokenError, verifyGoogleIdToken } from "@/lib/server/google";
import { RATE_LIMITS, resetRateLimits } from "@/lib/server/rateLimit";
import { NONCE_COOKIE, SESSION_COOKIE } from "@/lib/server/session";

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://spotter.example/api/auth/google", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", "x-real-ip": "1.2.3.4", ...headers },
    body: JSON.stringify(body),
  });
}

describe("GET /api/auth/nonce", () => {
  it("keeps the raw nonce in an HttpOnly cookie and gives the page only its hash", async () => {
    jar = fakeCookieJar();
    const { nonce: hashed } = (await (await nonce()).json()) as { nonce: string };
    const cookie = jar.store.get(NONCE_COOKIE)!;
    expect(cookie.options).toMatchObject({ httpOnly: true, secure: true });
    expect(hashed).toBe(await sha256Hex(cookie.value));
    expect(hashed).not.toBe(cookie.value);
  });
});

describe("POST /api/auth/google", () => {
  beforeEach(() => {
    resetRateLimits();
    jar = fakeCookieJar({ [NONCE_COOKIE]: "raw-nonce" });
    db = fakeDatabase((text) => (text.includes("insert into users") ? [{ id: USER, created: true }] : []));
    vi.mocked(verifyGoogleIdToken).mockReset();
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({ sub: "g-123", email: "a@example.com", name: "A" });
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  });

  it("signs a user in: checks the token against the hashed nonce, then starts a session", async () => {
    const response = await signIn(request({ credential: "jwt" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, created: true });
    expect(verifyGoogleIdToken).toHaveBeenCalledWith("jwt", { clientId: "client-id", nonce: await sha256Hex("raw-nonce") });
    const insert = db.statements.find((s) => s.text.includes("insert into users"));
    expect(insert?.params).toEqual(["g-123", "a@example.com", "A"]);
    // Google verified the address, so the new account starts confirmed (AUTH-2).
    expect(insert?.text).toContain("email_verified_at");
    // Found by sub first, never by email alone.
    expect(db.statements[0].text).toContain("where google_sub = $1");
    expect(jar.store.has(SESSION_COOKIE)).toBe(true);
    // The nonce is single use.
    expect(jar.store.has(NONCE_COOKIE)).toBe(false);
  });

  it("refuses another site (API-6)", async () => {
    const response = await signIn(request({ credential: "jwt" }, { "sec-fetch-site": "cross-site" }));
    expect(response.status).toBe(403);
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it("refuses a sign-in with no nonce cookie", async () => {
    jar = fakeCookieJar();
    const response = await signIn(request({ credential: "jwt" }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("nonce_missing");
  });

  it("refuses a bad token without starting a session", async () => {
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(new GoogleTokenError("wrong_nonce"));
    const response = await signIn(request({ credential: "jwt" }));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe("wrong_nonce");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
    expect(db.statements).toHaveLength(0);
  });

  it("rate-limits by client IP with 429 (AUTH-3)", async () => {
    const { limit } = RATE_LIMITS.googleSignIn;
    for (let i = 0; i < limit; i++) {
      jar = fakeCookieJar({ [NONCE_COOKIE]: "raw-nonce" });
      await signIn(request({ credential: "jwt" }));
    }
    const response = await signIn(request({ credential: "jwt" }));
    expect(response.status).toBe(429);
    // Another address is unaffected.
    jar = fakeCookieJar({ [NONCE_COOKIE]: "raw-nonce" });
    expect((await signIn(request({ credential: "jwt" }, { "x-real-ip": "9.9.9.9" }))).status).toBe(200);
  });

  it("refuses a body that is not a credential", async () => {
    expect((await signIn(request({ credential: 42 }))).status).toBe(400);
  });
});

describe("GET /api/health (API-9)", () => {
  it("is ok when the database answers", async () => {
    db = fakeDatabase(() => [{ "?column?": 1 }]);
    expect((await health()).status).toBe(200);
  });

  it("is 503 when it does not, and says nothing more", async () => {
    db = fakeDatabase(() => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:5432");
    });
    const response = await health();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("ECONNREFUSED");
  });
});
