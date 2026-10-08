import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCookieJar, fakeDatabase } from "./fakeServer";

// Email and password sign-in, end to end through the route handlers. The
// database is a small in-memory model of users, sessions and email_tokens
// behind fakeServer's fakeDatabase, answering the statements the routes send,
// so single use, ending sessions and Google linking are tested by what they do.
// Email goes out through a stubbed fetch, which is also how the tests read the
// links. The SQL itself is checked against Postgres by test/db and by hand.

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

import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as googleSignIn } from "@/app/api/auth/google/route";
import { POST as resendVerification } from "@/app/api/auth/resend-verification/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";
import { POST as signIn } from "@/app/api/auth/signin/route";
import { POST as signUp } from "@/app/api/auth/signup/route";
import { POST as verifyEmail } from "@/app/api/auth/verify-email/route";
import { requireVerifiedUser } from "@/lib/server/auth";
import { verifyGoogleIdToken } from "@/lib/server/google";
import { hashPassword, verifyPassword } from "@/lib/server/password";
import { RATE_LIMITS, resetRateLimits } from "@/lib/server/rateLimit";
import { hashToken, NONCE_COOKIE, SESSION_COOKIE } from "@/lib/server/session";

// ---------------------------------------------------------------------------
// The model.

type UserRow = {
  id: string;
  email: string;
  google_sub: string | null;
  password_hash: string | null;
  email_verified_at: Date | null;
  approved: boolean;
  name: string | null;
};
type TokenRow = { user_id: string; purpose: string; expires_at: number; used_at: Date | null };

let users: Map<string, UserRow>;
let tokens: Map<string, TokenRow>;
let sessions: Map<string, { user_id: string; expires_at: number }>;
let failDatabase = false;

const byEmail = (email: string) => [...users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());

function addUser(fields: Partial<UserRow> & { email: string }): UserRow {
  const user: UserRow = { id: randomUUID(), google_sub: null, password_hash: null, email_verified_at: null, approved: true, name: null, ...fields };
  users.set(user.id, user);
  return user;
}

/** A session in some other browser, by raw token. */
function otherBrowserSession(userId: string): string {
  const token = randomUUID();
  sessions.set(hashToken(token), { user_id: userId, expires_at: Date.now() + 86_400_000 });
  return token;
}

function answer(text: string, p: unknown[]): unknown[] {
  if (failDatabase) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const sql = text.replace(/\s+/g, " ").trim();
  const now = new Date();

  // Sessions.
  if (sql.startsWith("insert into sessions")) {
    sessions.set(p[0] as string, { user_id: p[1] as string, expires_at: (p[2] as Date).getTime() });
    return [];
  }
  if (sql.includes("from sessions s join users u")) {
    const s = sessions.get(p[0] as string);
    const u = s && s.expires_at > Date.now() ? users.get(s.user_id) : undefined;
    if (!u) return [];
    return [{ id: u.id, email: u.email, name: u.name, approved: u.approved, is_admin: false, email_verified: u.email_verified_at !== null, created_at: now, last_seen_at: now }];
  }
  if (sql === "delete from sessions where user_id = $1") {
    for (const [hash, s] of sessions) if (s.user_id === p[0]) sessions.delete(hash);
    return [];
  }
  if (sql.startsWith("delete from sessions where user_id = $1 and expires_at <= now()")) return [];

  // Email tokens.
  if (sql.startsWith("insert into email_tokens")) {
    tokens.set(p[0] as string, { user_id: p[1] as string, purpose: p[2] as string, expires_at: Date.now() + (p[3] as number) * 60_000, used_at: null });
    return [];
  }
  if (sql.startsWith("update email_tokens set used_at = now() where token_hash = $1")) {
    const t = tokens.get(p[0] as string);
    if (!t || t.purpose !== p[1] || t.used_at || t.expires_at <= Date.now()) return [];
    t.used_at = now;
    return [{ user_id: t.user_id }];
  }
  if (sql.startsWith("update email_tokens set used_at = now() where user_id = $1")) {
    for (const t of tokens.values()) if (t.user_id === p[0] && t.purpose === p[1] && !t.used_at) t.used_at = now;
    return [];
  }
  if (sql === "delete from email_tokens where user_id = $1") {
    for (const [hash, t] of tokens) if (t.user_id === p[0]) tokens.delete(hash);
    return [];
  }

  // Users: email and password.
  if (sql.startsWith("insert into users (email, password_hash, approved)")) {
    if (byEmail(p[0] as string)) return [];
    return [{ id: addUser({ email: p[0] as string, password_hash: p[1] as string }).id }];
  }
  if (sql.startsWith("select id, password_hash from users where lower(email) = $1")) {
    const u = byEmail(p[0] as string);
    return u ? [{ id: u.id, password_hash: u.password_hash }] : [];
  }
  if (sql.startsWith("select id, email from users where lower(email) = $1")) {
    const u = byEmail(p[0] as string);
    return u ? [{ id: u.id, email: u.email }] : [];
  }
  if (sql.startsWith("update users set last_sign_in_at")) return [];
  if (sql.startsWith("update users set password_hash = $2")) {
    const u = users.get(p[0] as string)!;
    u.password_hash = p[1] as string;
    u.email_verified_at ??= now;
    return [];
  }
  if (sql.startsWith("update users set email_verified_at = coalesce")) {
    users.get(p[0] as string)!.email_verified_at ??= now;
    return [];
  }

  // Users: Google.
  if (sql.startsWith("select id from users where google_sub = $1")) {
    const u = [...users.values()].find((x) => x.google_sub === p[0]);
    return u ? [{ id: u.id }] : [];
  }
  if (sql.startsWith("select id, google_sub, email_verified_at from users")) {
    const u = byEmail(p[0] as string);
    return u ? [{ id: u.id, google_sub: u.google_sub, email_verified_at: u.email_verified_at }] : [];
  }
  if (sql.startsWith("update users set google_sub = $2, name = coalesce")) {
    const u = users.get(p[0] as string)!;
    u.google_sub = p[1] as string;
    return [];
  }
  if (sql.startsWith("update users set google_sub = $2, password_hash = null")) {
    const u = users.get(p[0] as string)!;
    Object.assign(u, { google_sub: p[1], password_hash: null, email_verified_at: now });
    return [];
  }
  if (sql.startsWith("update users u set name = $3")) {
    const u = users.get(p[0] as string)!;
    u.email_verified_at ??= now;
    return [];
  }
  if (sql.startsWith("insert into users (google_sub")) {
    return [{ id: addUser({ google_sub: p[0] as string, email: p[1] as string, name: p[2] as string, email_verified_at: now }).id }];
  }
  throw new Error(`The model does not know: ${sql}`);
}

// ---------------------------------------------------------------------------
// Requests, email and logs.

const IP = "1.2.3.4";

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://spotter.example/api/auth/${path}`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", "x-real-ip": IP, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

type Sent = { to: string[]; subject: string; text: string };
let sent: Sent[];
const fetchStub = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
  sent.push(JSON.parse(String(init?.body)) as Sent);
  return new Response("{}", { status: 200 });
});

/** The token in the last email that went to `to` with a link to `path`. */
function linkToken(to: string, path: string): string {
  const mail = [...sent].reverse().find((m) => m.to.includes(to) && m.text.includes(path));
  const match = mail?.text.match(/\?token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error(`no ${path} email to ${to}`);
  return match[1];
}

let logs: string[];
const EMAIL = "coach@example.com";
const PASSWORD = "Gridiron Lights 44";

beforeEach(() => {
  users = new Map();
  tokens = new Map();
  sessions = new Map();
  failDatabase = false;
  sent = [];
  logs = [];
  fetchStub.mockClear();
  jar = fakeCookieJar();
  db = fakeDatabase(answer);
  resetRateLimits();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Spotter <noreply@spotter.example>");
  vi.stubEnv("APP_URL", "https://spotter.example");
  vi.stubGlobal("fetch", fetchStub);
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args.map(String).join(" ")));
  }
});

afterEach(() => {
  // API-8: no address, password or token ever reaches the log.
  for (const line of logs) {
    expect(line).not.toContain(EMAIL);
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toMatch(/token=|[A-Za-z0-9_-]{43}/);
  }
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("POST /api/auth/signup", () => {
  it("makes an approved, unconfirmed account, signs it in, and emails a confirmation link", async () => {
    const { status, body } = await read(await signUp(post("signup", { email: " Coach@Example.com ", password: PASSWORD })));
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, checkEmail: true });

    const user = byEmail(EMAIL)!;
    expect(user.email).toBe(EMAIL);
    expect(user.approved).toBe(true);
    expect(user.email_verified_at).toBeNull();
    expect(user.password_hash).toMatch(/^scrypt\$/);
    expect(jar.store.has(SESSION_COOKIE)).toBe(true);
    expect(sessions.get(hashToken(jar.store.get(SESSION_COOKIE)!.value))?.user_id).toBe(user.id);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([EMAIL]);
    expect(sent[0].text).toContain("https://spotter.example/auth/verify?token=");
    // DB-8: only the hash of the emailed token is stored.
    const token = linkToken(EMAIL, "/auth/verify");
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(tokens.has(hashToken(token))).toBe(true);
    expect([...tokens.keys()]).not.toContain(token);
    expect(tokens.get(hashToken(token))).toMatchObject({ purpose: "verify", user_id: user.id });
  });

  it("answers an address that already has an account exactly as a new one, and tells that inbox instead (AUTH-7)", async () => {
    const fresh = await read(await signUp(post("signup", { email: "new@example.com", password: PASSWORD })));
    const owner = addUser({ email: EMAIL, password_hash: await hashPassword("Their Own Secret 9") });
    jar = fakeCookieJar();
    sent = [];

    const repeat = await read(await signUp(post("signup", { email: "COACH@example.com", password: PASSWORD })));
    expect(repeat).toEqual(fresh);
    // No second account, no change to the first, no session for the stranger.
    expect([...users.values()].filter((u) => u.email === EMAIL)).toHaveLength(1);
    expect(await verifyPassword("Their Own Secret 9", owner.password_hash)).toBe(true);
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
    // The owner hears about it, with no link that does anything.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([EMAIL]);
    expect(sent[0].subject).toMatch(/already have/);
    expect(sent[0].text).not.toContain("token=");
  });

  it("sends the owner that note only a couple of times an hour", async () => {
    addUser({ email: EMAIL, google_sub: "g-1", email_verified_at: new Date() });
    const { limit } = RATE_LIMITS.signUpNoticeEmail;
    for (let i = 0; i < limit + 2; i++) {
      expect((await signUp(post("signup", { email: EMAIL, password: PASSWORD }, { "x-real-ip": `10.0.0.${i}` }))).status).toBe(200);
    }
    expect(sent).toHaveLength(limit);
  });

  it("refuses a weak or common password and a bad address", async () => {
    expect(await read(await signUp(post("signup", { email: EMAIL, password: "short" })))).toMatchObject({ status: 400, body: { code: "weak_password" } });
    expect(await read(await signUp(post("signup", { email: EMAIL, password: "football1" })))).toMatchObject({ status: 400, body: { code: "weak_password" } });
    expect(await read(await signUp(post("signup", { email: EMAIL, password: "x".repeat(201) })))).toMatchObject({ status: 400 });
    expect(await read(await signUp(post("signup", { email: "not an address", password: PASSWORD })))).toMatchObject({ status: 400, body: { code: "bad_email" } });
    expect(users.size).toBe(0);
  });

  it("refuses another site, and a body that is too big", async () => {
    expect((await signUp(post("signup", { email: EMAIL, password: PASSWORD }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await signUp(post("signup", { email: EMAIL, password: "x".repeat(5000) }))).status).toBe(413);
    expect(users.size).toBe(0);
  });

  it("is 503 with nothing about the server when the database is down", async () => {
    failDatabase = true;
    const response = await read(await signUp(post("signup", { email: EMAIL, password: PASSWORD })));
    expect(response).toEqual({ status: 503, body: { code: "sign_up_unavailable", error: expect.any(String) } });
    expect(JSON.stringify(response)).not.toContain("ECONNREFUSED");
  });

  it("rate-limits by client IP with 429 (AUTH-3)", async () => {
    for (let i = 0; i < RATE_LIMITS.signUpIp.limit; i++) await signUp(post("signup", { email: `u${i}@example.com`, password: PASSWORD }));
    expect((await signUp(post("signup", { email: "late@example.com", password: PASSWORD }))).status).toBe(429);
    expect((await signUp(post("signup", { email: "late@example.com", password: PASSWORD }, { "x-real-ip": "9.9.9.9" }))).status).toBe(200);
  });
});

describe("POST /api/auth/signin", () => {
  beforeEach(async () => {
    addUser({ email: EMAIL, password_hash: await hashPassword(PASSWORD) });
  });

  it("signs in with the right password, whatever the address's case", async () => {
    const response = await read(await signIn(post("signin", { email: "Coach@EXAMPLE.com", password: PASSWORD })));
    expect(response).toEqual({ status: 200, body: { ok: true } });
    expect(sessions.get(hashToken(jar.store.get(SESSION_COOKIE)!.value))?.user_id).toBe(byEmail(EMAIL)!.id);
  });

  it("answers a wrong password, an unknown address and a Google-only account identically (AUTH-7)", async () => {
    addUser({ email: "google@example.com", google_sub: "g-1", email_verified_at: new Date() });
    const wrong = await read(await signIn(post("signin", { email: EMAIL, password: "Not The Password 1" })));
    const unknown = await read(await signIn(post("signin", { email: "nobody@example.com", password: PASSWORD })));
    const googleOnly = await read(await signIn(post("signin", { email: "google@example.com", password: PASSWORD })));
    expect(wrong).toEqual({ status: 401, body: { code: "invalid_credentials", error: "That email and password do not match an account." } });
    expect(unknown).toEqual(wrong);
    expect(googleOnly).toEqual(wrong);
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
  });

  it("rate-limits by IP and by address with 429 (AUTH-3)", async () => {
    for (let i = 0; i < RATE_LIMITS.passwordSignInEmail.limit; i++) {
      await signIn(post("signin", { email: EMAIL, password: "guess" + i }, { "x-real-ip": `10.0.0.${i}` }));
    }
    // Spread over many networks, one address still runs out; the right password waits too.
    expect((await signIn(post("signin", { email: EMAIL, password: PASSWORD }, { "x-real-ip": "10.9.9.9" }))).status).toBe(429);
    // Another address from one of those networks is fine.
    resetRateLimits();
    for (let i = 0; i < RATE_LIMITS.passwordSignInIp.limit; i++) await signIn(post("signin", { email: `u${i}@example.com`, password: "x" }));
    expect((await signIn(post("signin", { email: EMAIL, password: PASSWORD }))).status).toBe(429);
  }, 30_000);
});

describe("POST /api/auth/forgot-password", () => {
  it("emails a one-hour reset link to an account, and answers an unknown address identically (AUTH-7)", async () => {
    const user = addUser({ email: EMAIL, password_hash: await hashPassword(PASSWORD) });
    const known = await read(await forgotPassword(post("forgot-password", { email: EMAIL })));
    const unknown = await read(await forgotPassword(post("forgot-password", { email: "nobody@example.com" })));
    expect(known).toEqual({ status: 200, body: { ok: true } });
    expect(unknown).toEqual(known);

    expect(sent).toHaveLength(1);
    const token = linkToken(EMAIL, "/reset-password");
    const row = tokens.get(hashToken(token))!;
    expect(row).toMatchObject({ purpose: "reset", user_id: user.id, used_at: null });
    expect(row.expires_at - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(row.expires_at - Date.now()).toBeGreaterThan(59 * 60_000);
  });

  it("still answers 200 when the database is down", async () => {
    failDatabase = true;
    expect(await read(await forgotPassword(post("forgot-password", { email: EMAIL })))).toEqual({ status: 200, body: { ok: true } });
  });

  it("rate-limits per address, whether or not it has an account (AUTH-3)", async () => {
    for (let i = 0; i < RATE_LIMITS.forgotPasswordEmail.limit; i++) {
      await forgotPassword(post("forgot-password", { email: "nobody@example.com" }, { "x-real-ip": `10.0.0.${i}` }));
    }
    expect((await forgotPassword(post("forgot-password", { email: "nobody@example.com" }, { "x-real-ip": "10.9.9.9" }))).status).toBe(429);
  });

  it("rate-limits per IP (AUTH-3)", async () => {
    for (let i = 0; i < RATE_LIMITS.forgotPasswordIp.limit; i++) await forgotPassword(post("forgot-password", { email: `u${i}@example.com` }));
    expect((await forgotPassword(post("forgot-password", { email: "late@example.com" }))).status).toBe(429);
  });
});

describe("POST /api/auth/reset-password", () => {
  let userId: string;
  let token: string;

  beforeEach(async () => {
    userId = addUser({ email: EMAIL, password_hash: await hashPassword("Old Password 77") }).id;
    await forgotPassword(post("forgot-password", { email: EMAIL }));
    token = linkToken(EMAIL, "/reset-password");
  });

  it("sets the password, ends every other session, confirms the address and signs this browser in (AUTH-5)", async () => {
    const elsewhere = otherBrowserSession(userId);
    const response = await read(await resetPassword(post("reset-password", { token, password: PASSWORD })));
    expect(response).toEqual({ status: 200, body: { ok: true } });

    expect(sessions.has(hashToken(elsewhere))).toBe(false);
    const mine = jar.store.get(SESSION_COOKIE)!.value;
    expect([...sessions.entries()]).toEqual([[hashToken(mine), expect.objectContaining({ user_id: userId })]]);
    expect(users.get(userId)!.email_verified_at).not.toBeNull();

    jar = fakeCookieJar();
    expect((await signIn(post("signin", { email: EMAIL, password: PASSWORD }))).status).toBe(200);
    expect((await signIn(post("signin", { email: EMAIL, password: "Old Password 77" }))).status).toBe(401);
  });

  it("works once", async () => {
    expect((await resetPassword(post("reset-password", { token, password: PASSWORD }))).status).toBe(200);
    const again = await read(await resetPassword(post("reset-password", { token, password: "Another One 55" })));
    expect(again).toMatchObject({ status: 400, body: { code: "invalid_token" } });
  });

  it("retires older reset links when one is used", async () => {
    await forgotPassword(post("forgot-password", { email: EMAIL }));
    const newer = linkToken(EMAIL, "/reset-password");
    expect(newer).not.toBe(token);
    expect((await resetPassword(post("reset-password", { token: newer, password: PASSWORD }))).status).toBe(200);
    expect((await resetPassword(post("reset-password", { token, password: "Another One 55" }))).status).toBe(400);
  });

  it("refuses an expired link, a made-up one, and a verify link", async () => {
    tokens.get(hashToken(token))!.expires_at = Date.now() - 1;
    expect((await resetPassword(post("reset-password", { token, password: PASSWORD }))).status).toBe(400);
    expect((await resetPassword(post("reset-password", { token: "A".repeat(43), password: PASSWORD }))).status).toBe(400);
    expect((await resetPassword(post("reset-password", { token: "../../etc", password: PASSWORD }))).status).toBe(400);

    await signUp(post("signup", { email: "other@example.com", password: PASSWORD }));
    const verify = linkToken("other@example.com", "/auth/verify");
    expect((await resetPassword(post("reset-password", { token: verify, password: PASSWORD }))).status).toBe(400);
  });

  it("does not spend the link on a weak password", async () => {
    expect(await read(await resetPassword(post("reset-password", { token, password: "password" })))).toMatchObject({ status: 400, body: { code: "weak_password" } });
    expect(tokens.get(hashToken(token))!.used_at).toBeNull();
    expect((await resetPassword(post("reset-password", { token, password: PASSWORD }))).status).toBe(200);
  });

  it("rate-limits by IP (AUTH-3)", async () => {
    for (let i = 0; i < RATE_LIMITS.resetPasswordIp.limit; i++) await resetPassword(post("reset-password", { token: "B".repeat(43), password: PASSWORD }));
    expect((await resetPassword(post("reset-password", { token, password: PASSWORD }))).status).toBe(429);
  });
});

describe("POST /api/auth/verify-email and /resend-verification", () => {
  it("confirms the address once, in any browser, and opens the paid routes (AUTH-2)", async () => {
    await signUp(post("signup", { email: EMAIL, password: PASSWORD }));
    const user = byEmail(EMAIL)!;
    let gate = await requireVerifiedUser();
    expect(gate.ok).toBe(false);

    const signedInJar = jar;
    jar = fakeCookieJar(); // another browser, signed out
    const token = linkToken(EMAIL, "/auth/verify");
    expect(await read(await verifyEmail(post("verify-email", { token })))).toEqual({ status: 200, body: { ok: true } });
    expect(user.email_verified_at).not.toBeNull();
    // Starts no session there.
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
    expect(await read(await verifyEmail(post("verify-email", { token })))).toMatchObject({ status: 400, body: { code: "invalid_token" } });

    jar = signedInJar;
    gate = await requireVerifiedUser();
    expect(gate.ok).toBe(true);
  });

  it("refuses a link that has expired", async () => {
    await signUp(post("signup", { email: EMAIL, password: PASSWORD }));
    const token = linkToken(EMAIL, "/auth/verify");
    const row = tokens.get(hashToken(token))!;
    expect(row.expires_at - Date.now()).toBeGreaterThan(23 * 60 * 60_000);
    row.expires_at = Date.now() - 1;
    expect((await verifyEmail(post("verify-email", { token }))).status).toBe(400);
    expect(byEmail(EMAIL)!.email_verified_at).toBeNull();
  });

  it("resends to the signed-in, unconfirmed account only, and the newest link retires the rest", async () => {
    expect((await resendVerification(post("resend-verification"))).status).toBe(401);

    await signUp(post("signup", { email: EMAIL, password: PASSWORD }));
    const first = linkToken(EMAIL, "/auth/verify");
    expect(await read(await resendVerification(post("resend-verification")))).toEqual({ status: 200, body: { ok: true } });
    const second = linkToken(EMAIL, "/auth/verify");
    expect(second).not.toBe(first);
    expect((await verifyEmail(post("verify-email", { token: second }))).status).toBe(200);
    expect((await verifyEmail(post("verify-email", { token: first }))).status).toBe(400);

    // Confirmed: same answer, no email.
    sent = [];
    expect((await resendVerification(post("resend-verification"))).status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("rate-limits resends per address (AUTH-3)", async () => {
    await signUp(post("signup", { email: EMAIL, password: PASSWORD }));
    for (let i = 0; i < RATE_LIMITS.resendVerificationEmail.limit; i++) {
      await resendVerification(post("resend-verification", undefined, { "x-real-ip": `10.0.0.${i}` }));
    }
    expect((await resendVerification(post("resend-verification", undefined, { "x-real-ip": "10.9.9.9" }))).status).toBe(429);
  });

  it("rate-limits verify attempts per IP (AUTH-3)", async () => {
    for (let i = 0; i < RATE_LIMITS.verifyEmailIp.limit; i++) await verifyEmail(post("verify-email", { token: "C".repeat(43) }));
    expect((await verifyEmail(post("verify-email", { token: "C".repeat(43) }))).status).toBe(429);
  });
});

describe("requireVerifiedUser (AUTH-2)", () => {
  async function gateResponse() {
    const gate = await requireVerifiedUser();
    if (gate.ok) throw new Error("expected a refusal");
    return read(gate.response);
  }

  it("is 401 signed out", async () => {
    expect(await gateResponse()).toMatchObject({ status: 401, body: { code: "signed_out" } });
  });

  it("is 403 email_not_verified for an unconfirmed password account, and never cached", async () => {
    await signUp(post("signup", { email: EMAIL, password: PASSWORD }));
    expect(await gateResponse()).toMatchObject({ status: 403, body: { code: "email_not_verified" } });
    const gate = await requireVerifiedUser();
    if (!gate.ok) expect(gate.response.headers.get("cache-control")).toBe("no-store");
  });

  it("is 403 not_approved for an account switched off, confirmed or not", async () => {
    await signUp(post("signup", { email: EMAIL, password: PASSWORD }));
    Object.assign(byEmail(EMAIL)!, { approved: false, email_verified_at: new Date() });
    expect(await gateResponse()).toMatchObject({ status: 403, body: { code: "not_approved" } });
  });

  it("lets a Google account through", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({ sub: "g-1", email: EMAIL, name: "Coach" });
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    jar = fakeCookieJar({ [NONCE_COOKIE]: "raw-nonce" });
    expect((await googleSignIn(post("google", { credential: "jwt" }))).status).toBe(200);
    const gate = await requireVerifiedUser();
    expect(gate.ok && gate.user.emailVerified).toBe(true);
  });

  it("fails closed with 503 when the database cannot be reached", async () => {
    jar = fakeCookieJar({ [SESSION_COOKIE]: "raw" });
    failDatabase = true;
    expect(await gateResponse()).toMatchObject({ status: 503, body: { code: "approval_unavailable" } });
  });
});

describe("POST /api/auth/google with an email and password account at the same address", () => {
  beforeEach(() => {
    vi.mocked(verifyGoogleIdToken).mockReset();
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({ sub: "g-owner", email: EMAIL, name: "Coach" });
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  });

  async function googleIn() {
    jar = fakeCookieJar({ [NONCE_COOKIE]: "raw-nonce" });
    return read(await googleSignIn(post("google", { credential: "jwt" })));
  }

  it("joins a confirmed account: one account, both ways in", async () => {
    const user = addUser({ email: EMAIL, password_hash: await hashPassword(PASSWORD), email_verified_at: new Date() });
    const elsewhere = otherBrowserSession(user.id);
    expect(await googleIn()).toEqual({ status: 200, body: { ok: true, created: false } });
    expect(users.size).toBe(1);
    expect(user.google_sub).toBe("g-owner");
    expect(sessions.has(hashToken(elsewhere))).toBe(true);
    jar = fakeCookieJar();
    expect((await signIn(post("signin", { email: EMAIL, password: PASSWORD }))).status).toBe(200);
  });

  it("takes over an unconfirmed account: removes the password, ends its sessions and links, then joins (pre-hijack)", async () => {
    // A stranger signs up with the owner's address and stays signed in, waiting.
    await signUp(post("signup", { email: EMAIL, password: PASSWORD }));
    const user = byEmail(EMAIL)!;
    const strangersCookie = jar.store.get(SESSION_COOKIE)!.value;
    await forgotPassword(post("forgot-password", { email: EMAIL }));
    expect(tokens.size).toBe(2);

    // The owner signs in with Google.
    expect(await googleIn()).toEqual({ status: 200, body: { ok: true, created: false } });
    expect(users.size).toBe(1);
    expect(user.google_sub).toBe("g-owner");
    expect(user.password_hash).toBeNull();
    expect(user.email_verified_at).not.toBeNull();
    expect(sessions.has(hashToken(strangersCookie))).toBe(false);
    expect(tokens.size).toBe(0);
    // The owner is signed in; the stranger's password no longer works.
    expect(sessions.get(hashToken(jar.store.get(SESSION_COOKIE)!.value))?.user_id).toBe(user.id);
    jar = fakeCookieJar();
    expect((await signIn(post("signin", { email: EMAIL, password: PASSWORD }))).status).toBe(401);
  });

  it("never joins an account that already belongs to another Google identity", async () => {
    const other = addUser({ email: EMAIL, google_sub: "g-someone-else", email_verified_at: new Date() });
    const response = await googleIn();
    expect(response).toMatchObject({ status: 409, body: { code: "account_conflict" } });
    expect(other.google_sub).toBe("g-someone-else");
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
  });

  it("finds a returning Google user by sub, not by the email", async () => {
    const mine = addUser({ email: "old@example.com", google_sub: "g-owner", email_verified_at: new Date() });
    addUser({ email: EMAIL, password_hash: await hashPassword(PASSWORD) });
    expect(await googleIn()).toEqual({ status: 200, body: { ok: true, created: false } });
    expect(sessions.get(hashToken(jar.store.get(SESSION_COOKIE)!.value))?.user_id).toBe(mine.id);
    // The unconfirmed password account at the new address is untouched.
    expect(byEmail(EMAIL)!.google_sub).toBeNull();
  });

  it("makes a new, confirmed account when the address is new", async () => {
    expect(await googleIn()).toEqual({ status: 200, body: { ok: true, created: true } });
    expect(byEmail(EMAIL)).toMatchObject({ google_sub: "g-owner", email_verified_at: expect.any(Date) });
  });
});

describe("email without a provider (API-8)", () => {
  it("sends nothing and logs only the kind of email, never the link", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await signUp(post("signup", { email: EMAIL, password: PASSWORD }));
    expect(fetchStub).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes("email.verify"))).toBe(true);
    // The account is still made; afterEach checks no log line holds the address or a token.
    expect(byEmail(EMAIL)).toBeDefined();
  });

  it("in production with no APP_URL, builds no link at all", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "");
    await signUp(post("signup", { email: EMAIL, password: PASSWORD }));
    expect(sent).toHaveLength(0);
    expect(tokens.size).toBe(0);
    expect(logs.some((line) => line.includes("no_app_url"))).toBe(true);
  });
});
