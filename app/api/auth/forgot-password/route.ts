import { queryOne } from "@/lib/server/db";
import { sendTokenEmail } from "@/lib/server/emailTokens";
import { normalizeEmail } from "@/lib/server/password";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin } from "@/lib/server/request";
import { failure, json, readJson } from "@/lib/server/route";

// Emails a password reset link (Production Standard AUTH-3, AUTH-7). Always the
// same 200, whether the address has an account or not, and whether the email
// went or not, so this cannot be used to find out who has an account. A Google
// account gets a link too: it lets that person add a password. Logs codes only.

const MAX_BODY_BYTES = 4 * 1024;

const SENT_IF_EXISTS = { ok: true } as const;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!takeToken("forgotPasswordIp", clientIp(request))) return tooManyRequests();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return failure(413, "payload_too_large", "That request was too large.");
  }
  const read = await readJson(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const email = normalizeEmail((read.body as { email?: unknown } | null)?.email);
  if (!email) return failure(400, "bad_email", "That does not look like an email address.");
  // Per address, so one inbox cannot be flooded with reset emails. Counted for
  // every address, so a 429 says nothing about whether it has an account.
  if (!takeToken("forgotPasswordEmail", email)) return tooManyRequests();

  try {
    const user = await queryOne<{ id: string; email: string }>("select id, email from users where lower(email) = $1", [email]);
    if (user) await sendTokenEmail(user, "reset", request);
  } catch (err) {
    // Still the same answer: a failure here must not say the account exists.
    console.error(`auth.forgot_password: failed (${(err as { code?: string })?.code ?? "unknown"})`);
  }
  return json(SENT_IF_EXISTS);
}
