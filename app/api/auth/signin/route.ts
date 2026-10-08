import { queryOne, withTransaction } from "@/lib/server/db";
import { dummyPasswordHash, MAX_PASSWORD_LENGTH, normalizeEmail, verifyPassword } from "@/lib/server/password";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin } from "@/lib/server/request";
import { failure, json, readJson } from "@/lib/server/route";
import { createSession } from "@/lib/server/session";

// Signs in with an email and password (Production Standard AUTH-1, AUTH-3,
// AUTH-7). An unknown address, an account with no password (Google only) and a
// wrong password get the same answer, after the same scrypt work, so neither
// the words nor the timing say which addresses have accounts. Logs codes only.

const MAX_BODY_BYTES = 4 * 1024;

const NO_MATCH = () => failure(401, "invalid_credentials", "That email and password do not match an account.");

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!takeToken("passwordSignInIp", clientIp(request))) return tooManyRequests();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return failure(413, "payload_too_large", "That request was too large.");
  }
  const read = await readJson(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const body = (read.body ?? {}) as { email?: unknown; password?: unknown };

  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return NO_MATCH();
  // Per address as well as per network, so a botnet cannot guess one account's password.
  if (!takeToken("passwordSignInEmail", email)) return tooManyRequests();

  try {
    const row = await queryOne<{ id: string; password_hash: string | null }>(
      "select id, password_hash from users where lower(email) = $1",
      [email],
    );
    // Always one scrypt, against a dummy hash when there is nothing real to check.
    const stored = row?.password_hash ?? (await dummyPasswordHash());
    const matches = await verifyPassword(password, stored);
    if (!row?.password_hash || !matches) return NO_MATCH();

    await withTransaction(async (client) => {
      await client.query("update users set last_sign_in_at = now() where id = $1", [row.id]);
      // Tidy this user's expired sessions while we are here, as Google sign-in does.
      await client.query("delete from sessions where user_id = $1 and expires_at <= now()", [row.id]);
      await createSession(row.id, client);
    });
    return json({ ok: true });
  } catch (err) {
    console.error(`auth.signin: failed (${(err as { code?: string })?.code ?? "unknown"})`);
    return failure(503, "sign_in_unavailable", "Could not sign you in just now. Try again in a moment.");
  }
}
