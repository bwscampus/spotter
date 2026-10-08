import { withTransaction } from "@/lib/server/db";
import { consumeEmailToken, isTokenShaped, retireEmailTokens } from "@/lib/server/emailTokens";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin } from "@/lib/server/request";
import { failure, json, readJson } from "@/lib/server/route";

// Confirms an email address from the emailed link (Production Standard AUTH-2,
// DB-8). Works in any browser, signed in or not: the link is the proof. It
// works once. Starts no session, so a link opened on another device signs
// nobody in there. Logs codes only.

const MAX_BODY_BYTES = 1024;

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!takeToken("verifyEmailIp", clientIp(request))) return tooManyRequests();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return failure(413, "payload_too_large", "That request was too large.");
  }
  const read = await readJson(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const token = (read.body as { token?: unknown } | null)?.token;
  const badLink = () => failure(400, "invalid_token", "That link has expired or was already used. Sign in and ask for a new one.");
  if (!isTokenShaped(token)) return badLink();

  try {
    const done = await withTransaction(async (client) => {
      // Spending the link and confirming the address happen together or not at all.
      const userId = await consumeEmailToken(token, "verify", client);
      if (!userId) return false;
      await client.query("update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1", [userId]);
      await retireEmailTokens(userId, "verify", client);
      return true;
    });
    return done ? json({ ok: true }) : badLink();
  } catch (err) {
    console.error(`auth.verify_email: failed (${(err as { code?: string })?.code ?? "unknown"})`);
    return failure(503, "verify_unavailable", "Could not confirm the address just now. Try again in a moment.");
  }
}
