import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCookieJar, fakeDatabase } from "./fakeServer";

let jar = fakeCookieJar();
let db = fakeDatabase();
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
}));

import { createSession, endSession, hashToken, newSessionToken, readSession, SESSION_COOKIE } from "@/lib/server/session";

const USER = "8f3c2c1e-5b0a-4a8e-9d57-3c4f1e2a9b10";

describe("session tokens (DB-8)", () => {
  it("are 32 random bytes, stored only as a SHA-256", () => {
    const { token, hash } = newSessionToken();
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashToken(token));
    expect(newSessionToken().token).not.toBe(token);
  });
});

describe("createSession", () => {
  beforeEach(() => {
    jar = fakeCookieJar();
    db = fakeDatabase();
  });

  it("stores the hash, never the token, and sets a locked-down cookie (AUTH-4)", async () => {
    await createSession(USER);
    const cookie = jar.store.get(SESSION_COOKIE)!;
    const [insert] = db.statements;
    expect(insert.text).toContain("insert into sessions");
    expect(insert.params[0]).toBe(hashToken(cookie.value));
    expect(insert.params).not.toContain(cookie.value);
    expect(cookie.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(SESSION_COOKIE.startsWith("__Host-")).toBe(true);
  });
});

describe("readSession", () => {
  beforeEach(() => {
    jar = fakeCookieJar();
    db = fakeDatabase();
  });

  it("is null without a cookie, and asks the database nothing", async () => {
    expect(await readSession()).toBeNull();
    expect(db.statements).toHaveLength(0);
  });

  it("looks the session up by hash, and only unexpired ones", async () => {
    jar = fakeCookieJar({ [SESSION_COOKIE]: "raw-token" });
    await readSession();
    expect(db.statements[0].params).toEqual([hashToken("raw-token")]);
    expect(db.statements[0].text).toContain("expires_at > now()");
  });

  it("returns the user behind a live session", async () => {
    jar = fakeCookieJar({ [SESSION_COOKIE]: "raw-token" });
    const now = new Date();
    db = fakeDatabase(() => [
      { id: USER, email: "a@example.com", name: null, approved: true, is_admin: false, created_at: now, last_seen_at: now },
    ]);
    expect(await readSession()).toEqual({
      id: USER,
      email: "a@example.com",
      name: null,
      approved: true,
      isAdmin: false,
      signedInAt: now,
    });
  });
});

describe("endSession", () => {
  it("deletes this session's row and clears the cookie", async () => {
    jar = fakeCookieJar({ [SESSION_COOKIE]: "raw-token" });
    db = fakeDatabase();
    await endSession();
    expect(db.statements[0]).toEqual({ text: "delete from sessions where token_hash = $1", params: [hashToken("raw-token")] });
    expect(jar.store.get(SESSION_COOKIE)?.value).toBe("");
  });
});
