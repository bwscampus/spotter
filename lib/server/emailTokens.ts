import { query, type Queryable } from "./db";
import { appOrigin, resetPasswordMessage, sendEmail, verifyEmailMessage } from "./email";
import { hashToken, newSessionToken } from "./session";

// Single-use links sent by email: confirming an address and resetting a
// password (Production Standard AUTH-2, AUTH-5, DB-8). The link carries 32
// random bytes; the database keeps only their SHA-256, so a leaked backup holds
// no working link. Using a link marks it used in the same statement that checks
// it, so two clicks at once cannot both succeed.

export type TokenPurpose = "verify" | "reset";

/** How long each kind of link works. */
export const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = { verify: 24 * 60, reset: 60 };

/** Where each kind of link lands. */
const LANDING: Record<TokenPurpose, string> = { verify: "/auth/verify", reset: "/reset-password" };

/** 32 bytes as base64url is 43 characters. Anything else is not one of ours, and is refused before any query. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isTokenShaped(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

/** Stores a new link's hash for the user and returns the raw token, which only ever goes into the email. */
export async function issueEmailToken(userId: string, purpose: TokenPurpose, client?: Queryable): Promise<string> {
  // Same generator as sessions: 32 bytes from the CSPRNG, base64url, hashed with SHA-256.
  const { token, hash } = newSessionToken();
  await query(
    `insert into email_tokens (token_hash, user_id, purpose, expires_at)
     values ($1, $2, $3, now() + make_interval(mins => $4))`,
    [hash, userId, purpose, TOKEN_TTL_MINUTES[purpose]],
    client,
  );
  return token;
}

/**
 * Uses a link: marks it used and returns its user, or null when it is unknown,
 * already used, expired, or for the other purpose. Checking and spending are
 * one statement, so a link works once.
 */
export async function consumeEmailToken(token: string, purpose: TokenPurpose, client?: Queryable): Promise<string | null> {
  if (!isTokenShaped(token)) return null;
  const rows = await query<{ user_id: string }>(
    `update email_tokens set used_at = now()
      where token_hash = $1 and purpose = $2 and used_at is null and expires_at > now()
      returning user_id`,
    [hashToken(token), purpose],
    client,
  );
  return rows[0]?.user_id ?? null;
}

/** Spends every other open link of this kind for the user, so an older email stops working too. */
export async function retireEmailTokens(userId: string, purpose: TokenPurpose, client?: Queryable): Promise<void> {
  await query("update email_tokens set used_at = now() where user_id = $1 and purpose = $2 and used_at is null", [userId, purpose], client);
}

export function emailLink(origin: string, purpose: TokenPurpose, token: string): string {
  return `${origin}${LANDING[purpose]}?token=${token}`;
}

/**
 * Issues a link and emails it. Returns false when it could not go (no APP_URL,
 * no provider, Resend refused); the caller answers the same either way. Logs
 * codes only.
 */
export async function sendTokenEmail(
  user: { id: string; email: string },
  purpose: TokenPurpose,
  request?: Request,
): Promise<boolean> {
  const origin = appOrigin(request);
  if (!origin) {
    console.error(`[Spotter] email.${purpose} not sent (no_app_url): APP_URL is not set or not https`);
    return false;
  }
  const token = await issueEmailToken(user.id, purpose);
  const link = emailLink(origin, purpose, token);
  const message =
    purpose === "verify"
      ? verifyEmailMessage(user.email, link, TOKEN_TTL_MINUTES.verify / 60)
      : resetPasswordMessage(user.email, link, TOKEN_TTL_MINUTES.reset);
  return (await sendEmail(message)).sent;
}
