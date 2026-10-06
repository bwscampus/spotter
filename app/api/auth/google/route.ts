import { cookies } from "next/headers";
import { sha256Hex } from "@/lib/auth/googleNonce";
import { withTransaction } from "@/lib/server/db";
import { GoogleTokenError, verifyGoogleIdToken } from "@/lib/server/google";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin, NO_STORE } from "@/lib/server/request";
import { createSession, NONCE_COOKIE } from "@/lib/server/session";

// Signs a user in with the ID token Google Identity Services gave the browser
// (docs/technical-design.md section 4). Creates the account on first sign-in,
// waiting for approval. Logs codes only: never the token, the email or the name.

/** A Google ID token is a couple of kilobytes; anything far past that is not one. */
const MAX_BODY_BYTES = 16 * 1024;

type Body = { credential?: unknown };

function fail(status: number, code: string, error: string) {
  return Response.json({ code, error }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return forbidden();
  if (!takeToken("googleSignIn", clientIp(request))) return tooManyRequests();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return fail(413, "payload_too_large", "That sign-in was too large.");
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return fail(400, "bad_request", "Sign-in failed. Try again.");
  }
  if (typeof body.credential !== "string" || body.credential.length === 0 || body.credential.length > MAX_BODY_BYTES) {
    return fail(400, "bad_request", "Sign-in failed. Try again.");
  }

  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value;
  // Single use: whatever happens next, this nonce is spent.
  jar.delete(NONCE_COOKIE);
  if (!nonce) return fail(400, "nonce_missing", "Sign-in expired. Try again.");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    console.error("auth.google: GOOGLE_CLIENT_ID is not set");
    return fail(503, "sign_in_unavailable", "Sign-in is not available right now.");
  }

  let identity;
  try {
    identity = await verifyGoogleIdToken(body.credential, { clientId, nonce: await sha256Hex(nonce) });
  } catch (err) {
    const code = err instanceof GoogleTokenError ? err.code : "invalid_token";
    console.warn(`auth.google: refused ${code}`);
    return fail(401, code, code === "email_not_verified" ? "Verify your Google account's email first." : "Sign-in failed. Try again.");
  }

  try {
    const { created } = await withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; created: boolean }>(
        `insert into users (google_sub, email, name) values ($1, $2, $3)
         on conflict (google_sub) do update
           set email = excluded.email, name = excluded.name, last_sign_in_at = now()
         returning id, (xmax = 0) as created`,
        [identity.sub, identity.email, identity.name],
      );
      const user = rows[0];
      // Tidy this user's expired sessions while we are here.
      await client.query("delete from sessions where user_id = $1 and expires_at <= now()", [user.id]);
      await createSession(user.id, client);
      return user;
    });
    return Response.json({ ok: true, created }, { headers: NO_STORE });
  } catch (err) {
    console.error(`auth.google: could not save the session (${(err as { code?: string }).code ?? "unknown"})`);
    return fail(503, "sign_in_unavailable", "Could not sign you in just now. Try again in a moment.");
  }
}
