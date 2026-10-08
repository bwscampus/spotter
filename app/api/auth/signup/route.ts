import { withTransaction } from "@/lib/server/db";
import { appOrigin, sendEmail, signupNoticeMessage } from "@/lib/server/email";
import { sendTokenEmail } from "@/lib/server/emailTokens";
import { hashPassword, normalizeEmail, passwordProblem } from "@/lib/server/password";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin } from "@/lib/server/request";
import { failure, json, readJson } from "@/lib/server/route";
import { createSession } from "@/lib/server/session";

// Creates an email and password account (Production Standard AUTH-1, AUTH-2,
// AUTH-7). The account is in at once (there is no approval step) and signed in,
// but nothing that spends money opens until the emailed link is opened
// (requireVerifiedUser).
//
// An address that already has an account gets exactly the same answer, and that
// inbox gets a note saying someone tried, so sign-up cannot be used to find out
// who has an account. Logs codes only: never the address or the password.

/** An address and a 200-character password are well under this. */
const MAX_BODY_BYTES = 4 * 1024;

/** What every sign-up that got this far is told, whether or not it made an account. */
const CHECK_EMAIL = { ok: true, checkEmail: true } as const;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!takeToken("signUpIp", clientIp(request))) return tooManyRequests();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return failure(413, "payload_too_large", "That request was too large.");
  }
  const read = await readJson(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = (read.body ?? {}) as { email?: unknown; password?: unknown };

  const email = normalizeEmail(body.email);
  if (!email) return failure(400, "bad_email", "That does not look like an email address.");
  const weak = passwordProblem(body.password);
  if (weak) return failure(400, weak.code, weak.error);
  const password = body.password as string;

  try {
    // Hashed before the lookup, so an address that exists costs the same time as one that does not.
    const passwordHash = await hashPassword(password);
    const created = await withTransaction(async (client) => {
      // The unique index on lower(email) decides, so two sign-ups at once cannot both win.
      const { rows } = await client.query<{ id: string }>(
        `insert into users (email, password_hash, approved) values ($1, $2, true)
         on conflict ((lower(email))) do nothing
         returning id`,
        [email, passwordHash],
      );
      const user = rows[0];
      if (user) await createSession(user.id, client);
      return user ?? null;
    });

    if (created) {
      // A failed send does not undo the account: the person can ask for another link.
      await sendTokenEmail({ id: created.id, email }, "verify", request);
    } else {
      await noteRepeatSignUp(email, request);
    }
    return json(CHECK_EMAIL);
  } catch (err) {
    console.error(`auth.signup: failed (${(err as { code?: string })?.code ?? "unknown"})`);
    return failure(503, "sign_up_unavailable", "Could not create the account just now. Try again in a moment.");
  }
}

/** Tells the owner of an existing account that someone tried to sign up with it, a couple of times an hour at most. */
async function noteRepeatSignUp(email: string, request: Request): Promise<void> {
  if (!takeToken("signUpNoticeEmail", email)) return;
  const origin = appOrigin(request);
  if (!origin) {
    console.error("[Spotter] email.signup_notice not sent (no_app_url): APP_URL is not set or not https");
    return;
  }
  await sendEmail(signupNoticeMessage(email, origin));
}
