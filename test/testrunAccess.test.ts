import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCookieJar, fakeDatabase } from "./fakeServer";

// testrun2's passcode way in: off everywhere but a non-production environment
// with TESTRUN_PASSCODE set, a 404 when off, and production refuses to start
// with the variable set at all. The SQL itself is checked against Postgres by
// test/db/testrunPasscode.test.ts.

let jar = fakeCookieJar();
let db = fakeDatabase();
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("@/lib/server/db", () => ({
  query: (...a: unknown[]) => db.module.query(...(a as [string, unknown[]])),
  queryOne: (...a: unknown[]) => db.module.queryOne(...(a as [string, unknown[]])),
  withTransaction: (fn: never) => db.module.withTransaction(fn),
}));

import { POST as passcodeSignIn } from "@/app/api/auth/passcode/route";
import { configProblems } from "@/lib/server/config";
import { resetRateLimits } from "@/lib/server/rateLimit";
import { SESSION_COOKIE } from "@/lib/server/session";
import { passcodeMatches, TESTRUN_EMAIL, testrunEnabled } from "@/lib/server/testrunAccess";

const PASSCODE = "correct-horse-battery";
const post = (body: unknown, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
  new Request("https://testrun.example/api/auth/passcode", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jar = fakeCookieJar();
  db = fakeDatabase((text) => (text.startsWith("insert into users") ? [{ id: "user-1" }] : []));
  resetRateLimits();
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "testrun2");
  vi.stubEnv("TESTRUN_PASSCODE", PASSCODE);
});
afterEach(() => vi.unstubAllEnvs());

describe("testrunEnabled", () => {
  it("is on only with a long enough passcode, and never in production", () => {
    expect(testrunEnabled({ RAILWAY_ENVIRONMENT_NAME: "testrun2", TESTRUN_PASSCODE: PASSCODE })).toBe(true);
    expect(testrunEnabled({ TESTRUN_PASSCODE: PASSCODE })).toBe(true);
    expect(testrunEnabled({ RAILWAY_ENVIRONMENT_NAME: "production", TESTRUN_PASSCODE: PASSCODE })).toBe(false);
    expect(testrunEnabled({ RAILWAY_ENVIRONMENT_NAME: "testrun2", TESTRUN_PASSCODE: "short" })).toBe(false);
    expect(testrunEnabled({ RAILWAY_ENVIRONMENT_NAME: "testrun2" })).toBe(false);
  });

  it("matches the passcode exactly, give or take surrounding spaces", () => {
    const env = { TESTRUN_PASSCODE: PASSCODE };
    expect(passcodeMatches(PASSCODE, env)).toBe(true);
    expect(passcodeMatches(` ${PASSCODE} `, env)).toBe(true);
    expect(passcodeMatches(PASSCODE.toUpperCase(), env)).toBe(false);
    expect(passcodeMatches("", env)).toBe(false);
    expect(passcodeMatches(42, env)).toBe(false);
  });
});

describe("configProblems", () => {
  it("refuses to start production with a passcode set", () => {
    expect(configProblems({ RAILWAY_ENVIRONMENT_NAME: "production", TESTRUN_PASSCODE: PASSCODE })).toContain(
      "TESTRUN_PASSCODE must not be set in production",
    );
    expect(configProblems({ RAILWAY_ENVIRONMENT_NAME: "testrun2", TESTRUN_PASSCODE: PASSCODE })).not.toContain(
      "TESTRUN_PASSCODE must not be set in production",
    );
  });
});

describe("POST /api/auth/passcode", () => {
  it("signs into the shared test account with the right passcode", async () => {
    const res = await passcodeSignIn(post({ passcode: PASSCODE }));
    expect(res.status).toBe(200);
    expect(jar.store.get(SESSION_COOKIE)?.value).toBeTruthy();
    const insert = db.statements.find((s) => s.text.startsWith("insert into users"))!;
    expect(insert.text).toContain("approved, email_verified_at");
    expect(insert.params[0]).toBe(TESTRUN_EMAIL);
    expect(String(insert.params[2])).toMatch(/^scrypt\$/);
    expect(insert.params).not.toContain(PASSCODE);
  });

  it("refuses a wrong passcode and starts no session", async () => {
    const res = await passcodeSignIn(post({ passcode: "wrong-passcode-here" }));
    expect(res.status).toBe(401);
    expect(db.statements).toEqual([]);
    expect(jar.store.has(SESSION_COOKIE)).toBe(false);
  });

  it("is a 404 in production and without a passcode, before reading anything", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
    expect((await passcodeSignIn(post({ passcode: PASSCODE }))).status).toBe(404);
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "testrun2");
    vi.stubEnv("TESTRUN_PASSCODE", "");
    expect((await passcodeSignIn(post({ passcode: PASSCODE }))).status).toBe(404);
    expect(db.statements).toEqual([]);
  });

  it("refuses another site", async () => {
    expect((await passcodeSignIn(post({ passcode: PASSCODE }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });

  it("rate-limits guesses by IP", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await passcodeSignIn(post({ passcode: `guess-number-${i}` }))).status;
    expect(last).toBe(429);
  });
});
