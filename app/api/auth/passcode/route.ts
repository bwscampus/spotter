import { withTransaction } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/password";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin } from "@/lib/server/request";
import { failure, json, notFound, readJson } from "@/lib/server/route";
import { createSession } from "@/lib/server/session";
import { passcodeMatches, TESTRUN_EMAIL, TESTRUN_NAME, testrunEnabled, testrunPasscode } from "@/lib/server/testrunAccess";

// Signs into testrun2's shared test account with the passcode
// (lib/server/testrunAccess.ts). A 404 wherever the passcode way in is off,
// production included. The account is made on first use, approved and
// verified, so it can read files and listen like any other; its password is
// the passcode, hashed. Logs codes only.

const MAX_BODY_BYTES = 1024;

const WRONG = () => failure(401, "invalid_credentials", "That passcode is not right.");

export async function POST(request: Request) {
  if (!testrunEnabled()) return notFound();
  if (!isSameOrigin(request)) return forbidden();
  if (!takeToken("passwordSignInIp", clientIp(request))) return tooManyRequests();
  const read = await readJson(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const { passcode } = (read.body ?? {}) as { passcode?: unknown };
  if (!passcodeMatches(passcode)) return WRONG();

  try {
    const passwordHash = await hashPassword(testrunPasscode()!);
    await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into users (email, name, password_hash, approved, email_verified_at)
         values ($1, $2, $3, true, now())
         on conflict ((lower(email))) do update set last_sign_in_at = now()
         returning id`,
        [TESTRUN_EMAIL, TESTRUN_NAME, passwordHash],
      );
      const id = rows[0].id;
      await client.query("delete from sessions where user_id = $1 and expires_at <= now()", [id]);
      await createSession(id, client);
    });
    return json({ ok: true });
  } catch (err) {
    console.error(`auth.passcode: failed (${(err as { code?: string })?.code ?? "unknown"})`);
    return failure(503, "sign_in_unavailable", "Could not sign you in just now. Try again in a moment.");
  }
}
