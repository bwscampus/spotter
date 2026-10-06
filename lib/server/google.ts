import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

// Verifies the ID token Google Identity Services hands the browser
// (docs/technical-design.md section 4). Signature against Google's published
// keys, then issuer, audience, expiry, nonce and a verified email.

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export type GoogleIdentity = { sub: string; email: string; name: string | null };

export type GoogleTokenFailure = "invalid_token" | "wrong_nonce" | "email_not_verified";

export class GoogleTokenError extends Error {
  constructor(readonly code: GoogleTokenFailure) {
    super(code);
  }
}

export async function verifyGoogleIdToken(
  token: string,
  expected: { clientId: string; nonce: string },
  keys: JWTVerifyGetKey = GOOGLE_KEYS,
): Promise<GoogleIdentity> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer: GOOGLE_ISSUERS,
      audience: expected.clientId,
      algorithms: ["RS256"],
    }));
  } catch {
    throw new GoogleTokenError("invalid_token");
  }

  if (typeof payload.nonce !== "string" || payload.nonce !== expected.nonce) {
    throw new GoogleTokenError("wrong_nonce");
  }
  // An address Google has not verified proves nothing about who holds it (AUTH-2).
  if (payload.email_verified !== true) throw new GoogleTokenError("email_not_verified");
  if (typeof payload.sub !== "string" || payload.sub.length === 0 || typeof payload.email !== "string") {
    throw new GoogleTokenError("invalid_token");
  }

  const name = typeof payload.name === "string" ? payload.name.slice(0, 200) : null;
  return { sub: payload.sub, email: payload.email.toLowerCase(), name };
}
