import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The passcode route's SQL against a real database: the first sign-in makes the
// shared test account, approved and verified, and every later one finds the
// same account rather than tripping the one-account-per-address index.

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to the app_rw_login role of a migrated database.");

const jar = { get: () => undefined, set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { POST as passcodeSignIn } from "@/app/api/auth/passcode/route";
import { getPool, query, queryOne } from "@/lib/server/db";
import { resetRateLimits } from "@/lib/server/rateLimit";
import { TESTRUN_EMAIL } from "@/lib/server/testrunAccess";

const PASSCODE = "correct-horse-battery";
const post = () =>
  new Request("https://testrun.example/api/auth/passcode", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ passcode: PASSCODE }),
  });

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "testrun2");
  vi.stubEnv("TESTRUN_PASSCODE", PASSCODE);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await query("delete from users where lower(email) = $1", [TESTRUN_EMAIL]);
  await getPool().end();
});

describe("POST /api/auth/passcode against Postgres", () => {
  it("makes one shared, approved, verified account and reuses it", async () => {
    expect((await passcodeSignIn(post())).status).toBe(200);
    expect((await passcodeSignIn(post())).status).toBe(200);
    const users = await query<{ id: string; approved: boolean; verified: boolean }>(
      "select id, approved, email_verified_at is not null as verified from users where lower(email) = $1",
      [TESTRUN_EMAIL],
    );
    expect(users).toHaveLength(1);
    const row = await queryOne<{ id: string; approved: boolean; verified: boolean; sessions: string }>(
      `select u.id, u.approved, u.email_verified_at is not null as verified,
              (select count(*) from sessions s where s.user_id = u.id) as sessions
         from users u where lower(u.email) = $1`,
      [TESTRUN_EMAIL],
    );
    expect(row).toMatchObject({ approved: true, verified: true, sessions: "2" });
  });
});
