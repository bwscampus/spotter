import { createHash, timingSafeEqual } from "node:crypto";

// testrun2's way in (Jed, Oct 10: "no accounts need to be created for
// testrun2"). With TESTRUN_PASSCODE set in a Railway environment that is not
// production, the sign-in page asks for that one passcode, and whoever knows it
// is signed into one shared test account (app/api/auth/passcode). Production
// refuses to start with the variable set (lib/server/config.ts), and this
// module refuses there too, so the passcode can never open production.

/** The one account everyone who knows the passcode shares. `.invalid` is never a real inbox. */
export const TESTRUN_EMAIL = "testrun@statcast.invalid";
export const TESTRUN_NAME = "Test run";
/** Shorter than this and the passcode is too easy to guess, so the way in stays shut. */
export const MIN_PASSCODE_LENGTH = 12;

type Env = Record<string, string | undefined>;

/** The passcode, or null when this server has no passcode way in. */
export function testrunPasscode(env: Env = process.env): string | null {
  if (env.RAILWAY_ENVIRONMENT_NAME === "production") return null;
  const passcode = env.TESTRUN_PASSCODE?.trim() ?? "";
  return passcode.length >= MIN_PASSCODE_LENGTH ? passcode : null;
}

export function testrunEnabled(env: Env = process.env): boolean {
  return testrunPasscode(env) !== null;
}

/** Whether `typed` is the passcode, in time that does not depend on where they differ. */
export function passcodeMatches(typed: unknown, env: Env = process.env): boolean {
  const passcode = testrunPasscode(env);
  if (!passcode || typeof typed !== "string" || typed.length > 200) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(typed.trim()), digest(passcode));
}
