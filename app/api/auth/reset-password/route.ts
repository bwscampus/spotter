import { withTransaction } from "@/lib/server/db";
import { consumeEmailToken, isTokenShaped, retireEmailTokens } from "@/lib/server/emailTokens";
import { hashPassword, passwordProblem } from "@/lib/server/password";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin } from "@/lib/server/request";
import { failure, json, readJson } from "@/lib/server/route";
import { createSession, endAllSessions } from "@/lib/server/session";

// Sets a new password from an emailed reset link (Production Standard AUTH-1,
// AUTH-5, DB-8). The link works once. Changing the password signs the account
// out everywhere, then signs this browser back in. Opening the link proves the
// person holds the inbox, so the address counts as confirmed too. Logs codes only.

const MAX_BODY_BYTES = 4 * 1024;

const BAD_LINK = () =>
  failure(400, "invalid_token", "That reset link has expired or was already used. Ask for a new one.");

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!takeToken("resetPasswordIp", clientIp(request))) return tooManyRequests();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return failure(413, "payload_too_large", "That request was too large.");
  }
  const read = await readJson(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = (read.body ?? {}) as { token?: unknown; password?: unknown };

  if (!isTokenShaped(body.token)) return BAD_LINK();
  // Checked before the link is spent, so a weak password does not use it up.
  const weak = passwordProblem(body.password);
  if (weak) return failure(400, weak.code, weak.error);
  const token = body.token;
  const password = body.password as string;

  try {
    const passwordHash = await hashPassword(password);
    const done = await withTransaction(async (client) => {
      const userId = await consumeEmailToken(token, "reset", client);
      if (!userId) return false;
      await client.query(
        `update users set password_hash = $2, email_verified_at = coalesce(email_verified_at, now()), last_sign_in_at = now()
          where id = $1`,
        [userId, passwordHash],
      );
      // Any other reset email still in the inbox stops working too.
      await retireEmailTokens(userId, "reset", client);
      // AUTH-5: whoever else was signed in, including whoever knew the old password, is out.
      await endAllSessions(userId, client);
      await createSession(userId, client);
      return true;
    });
    return done ? json({ ok: true }) : BAD_LINK();
  } catch (err) {
    console.error(`auth.reset_password: failed (${(err as { code?: string })?.code ?? "unknown"})`);
    return failure(503, "reset_unavailable", "Could not set the password just now. Try again in a moment.");
  }
}
