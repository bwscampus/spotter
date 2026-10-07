import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query, queryOne, type Queryable } from "./db";
import { SESSION_COOKIE } from "./sessionCookie";

// Sessions (Production Standard AUTH-4, DB-8). The browser holds a random
// 32-byte token in an HttpOnly cookie; the database holds only its SHA-256, so a
// leaked database or backup cannot be replayed to sign in. Signing out deletes
// the row, so the server can always revoke a session.

export { SESSION_COOKIE };
export const SESSION_DAYS = 30;
/** Holds the raw Google sign-in nonce for ten minutes (app/api/auth/nonce). */
export const NONCE_COOKIE = "__Host-spotter_nonce";
/** last_seen_at is refreshed at most this often, so reads stay reads. */
const TOUCH_AFTER_MS = 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  approved: boolean;
  isAdmin: boolean;
  /** When this session was created, which is when the user last signed in with Google. */
  signedInAt: Date;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function sessionCookieOptions(expires: Date) {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", expires };
}

/** Starts a session for a user who just signed in, and sets the cookie. Route handlers only. */
export async function createSession(userId: string, client?: Queryable): Promise<void> {
  const { token, hash } = newSessionToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)", [hash, userId, expires], client);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expires));
}

type SessionRow = {
  id: string;
  email: string;
  name: string | null;
  approved: boolean;
  is_admin: boolean;
  created_at: Date;
  last_seen_at: Date;
};

/**
 * The signed-in user, or null with no valid session. Throws when the database
 * cannot be reached, which callers treat as "unknown", never as signed in.
 */
export async function readSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const hash = hashToken(token);
  const row = await queryOne<SessionRow>(
    `select u.id, u.email, u.name, u.approved, u.is_admin, s.created_at, s.last_seen_at
       from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [hash],
  );
  if (!row) return null;
  if (Date.now() - row.last_seen_at.getTime() > TOUCH_AFTER_MS) {
    await query("update sessions set last_seen_at = now() where token_hash = $1", [hash]);
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    approved: row.approved,
    isAdmin: row.is_admin,
    signedInAt: row.created_at,
  };
}

/** Signs this browser out: deletes its session row and clears the cookie. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query("delete from sessions where token_hash = $1", [hashToken(token)]);
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
}

/** Signs a user out everywhere. */
export async function endAllSessions(userId: string): Promise<void> {
  await query("delete from sessions where user_id = $1", [userId]);
}
