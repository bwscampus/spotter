import { cookies } from "next/headers";
import { sha256Hex } from "@/lib/auth/googleNonce";
import { withTransaction, type Queryable } from "@/lib/server/db";
import { GoogleTokenError, verifyGoogleIdToken, type GoogleIdentity } from "@/lib/server/google";
import { takeToken, tooManyRequests } from "@/lib/server/rateLimit";
import { clientIp, forbidden, isSameOrigin, NO_STORE } from "@/lib/server/request";
import { createSession, endAllSessions, NONCE_COOKIE } from "@/lib/server/session";

// Signs a user in with the ID token Google Identity Services gave the browser
// (docs/technical-design.md section 4). Creates the account on first sign-in.
// Logs codes only: never the token, the email or the name.
//
// An account is found by Google's sub first, never by email alone. Only when
// this Google identity has no account yet does its (Google-verified) email look
// for an email and password account to join, under the rules in
// signInGoogleUser below.

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
    const outcome = await withTransaction((client) => signInGoogleUser(client, identity));
    if (outcome === "account_conflict") {
      console.warn("auth.google: refused account_conflict");
      return fail(409, "account_conflict", "This email already belongs to another StatCast account. Sign in the way you did before.");
    }
    return Response.json({ ok: true, created: outcome.created }, { headers: NO_STORE });
  } catch (err) {
    console.error(`auth.google: could not save the session (${(err as { code?: string }).code ?? "unknown"})`);
    return fail(503, "sign_in_unavailable", "Could not sign you in just now. Try again in a moment.");
  }
}

type Outcome = { id: string; created: boolean } | "account_conflict";

/**
 * Finds or makes the account for a verified Google identity, inside the
 * caller's transaction, and starts a session for it.
 *
 * 1. An account already holding this sub is this person's. Its email follows
 *    Google's, unless another account has that address.
 * 2. Otherwise an email and password account with the same address is joined:
 *    - confirmed (it opened its emailed link): both sides proved the inbox, so
 *      Google is added to it and the password keeps working;
 *    - not confirmed: anyone could have typed that address at sign-up, perhaps
 *      to wait for its owner (account pre-hijacking). Google proves the owner,
 *      so the password is removed, every session and open link on the account
 *      is ended, and only then is Google added. Whoever made it is shut out.
 *    An account with the address that already holds another Google sub is never
 *    joined: two Google identities are two people until Spotter is told otherwise.
 * 3. Otherwise a new account, confirmed, since Google confirmed the address.
 */
async function signInGoogleUser(client: Queryable, identity: GoogleIdentity): Promise<Outcome> {
  const { sub, email, name } = identity;
  let outcome: Outcome;

  const { rows: bySub } = await client.query<{ id: string }>("select id from users where google_sub = $1 for update", [sub]);
  if (bySub[0]) {
    await client.query(
      `update users u
          set name = $3, last_sign_in_at = now(), email_verified_at = coalesce(u.email_verified_at, now()),
              email = case when exists (select 1 from users o where lower(o.email) = lower($2) and o.id <> u.id) then u.email else $2 end
        where u.id = $1`,
      [bySub[0].id, email, name],
    );
    outcome = { id: bySub[0].id, created: false };
  } else {
    const { rows: byEmail } = await client.query<{ id: string; google_sub: string | null; email_verified_at: Date | null }>(
      "select id, google_sub, email_verified_at from users where lower(email) = lower($1) for update",
      [email],
    );
    const existing = byEmail[0];
    if (existing?.google_sub) return "account_conflict";
    if (existing && existing.email_verified_at) {
      await client.query(
        "update users set google_sub = $2, name = coalesce(name, $3), last_sign_in_at = now() where id = $1",
        [existing.id, sub, name],
      );
      outcome = { id: existing.id, created: false };
    } else if (existing) {
      // Pre-hijack defence: the person who set this password never proved the inbox.
      await endAllSessions(existing.id, client);
      await client.query("delete from email_tokens where user_id = $1", [existing.id]);
      await client.query(
        `update users set google_sub = $2, password_hash = null, email_verified_at = now(), name = $3, last_sign_in_at = now()
          where id = $1`,
        [existing.id, sub, name],
      );
      console.warn("auth.google: took over an unconfirmed password account");
      outcome = { id: existing.id, created: false };
    } else {
      const { rows } = await client.query<{ id: string }>(
        "insert into users (google_sub, email, name, email_verified_at) values ($1, $2, $3, now()) returning id",
        [sub, email, name],
      );
      outcome = { id: rows[0].id, created: true };
    }
  }

  // Tidy this user's expired sessions while we are here.
  await client.query("delete from sessions where user_id = $1 and expires_at <= now()", [outcome.id]);
  await createSession(outcome.id, client);
  return outcome;
}
