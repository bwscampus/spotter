import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { GoogleTokenError, verifyGoogleIdToken } from "@/lib/server/google";

// Google's keys are swapped for a local pair, so every claim can be set exactly.

const CLIENT_ID = "spotter-client.apps.googleusercontent.com";
const NONCE = "hashed-nonce-abc";

let keys: ReturnType<typeof createLocalJWKSet>;
let privateKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  keys = createLocalJWKSet({ keys: [jwk] });
});

async function token(claims: JWTPayload = {}, options: { key?: CryptoKey; expiresIn?: string } = {}) {
  return new SignJWT({
    email: "Announcer@Example.com",
    email_verified: true,
    name: "Jed",
    nonce: NONCE,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer((claims.iss as string) ?? "https://accounts.google.com")
    .setAudience((claims.aud as string) ?? CLIENT_ID)
    .setSubject((claims.sub as string) ?? "1098765")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "1h")
    .sign(options.key ?? privateKey);
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return err instanceof GoogleTokenError ? err.code : "other";
  }
  return "accepted";
}

const verify = (jwt: string) => verifyGoogleIdToken(jwt, { clientId: CLIENT_ID, nonce: NONCE }, keys);

describe("verifyGoogleIdToken", () => {
  it("accepts a good token and keys the user on sub, with the email lowercased", async () => {
    expect(await verify(await token())).toEqual({ sub: "1098765", email: "announcer@example.com", name: "Jed" });
  });

  it("accepts Google's bare issuer form too", async () => {
    expect((await verify(await token({ iss: "accounts.google.com" }))).sub).toBe("1098765");
  });

  it("refuses a token signed by another key", async () => {
    expect(await failure(verify(await token({}, { key: otherKey })))).toBe("invalid_token");
  });

  it("refuses a token for another app", async () => {
    expect(await failure(verify(await token({ aud: "someone-else.apps.googleusercontent.com" })))).toBe("invalid_token");
  });

  it("refuses a token from another issuer", async () => {
    expect(await failure(verify(await token({ iss: "https://evil.example" })))).toBe("invalid_token");
  });

  it("refuses an expired token", async () => {
    expect(await failure(verify(await token({}, { expiresIn: "-1m" })))).toBe("invalid_token");
  });

  it("refuses a token made for another sign-in (wrong or missing nonce)", async () => {
    expect(await failure(verify(await token({ nonce: "someone-elses" })))).toBe("wrong_nonce");
    expect(await failure(verify(await token({ nonce: undefined })))).toBe("wrong_nonce");
  });

  it("refuses an email Google has not verified (AUTH-2)", async () => {
    expect(await failure(verify(await token({ email_verified: false })))).toBe("email_not_verified");
    expect(await failure(verify(await token({ email_verified: "true" })))).toBe("email_not_verified");
  });

  it("refuses garbage", async () => {
    expect(await failure(verify("not-a-jwt"))).toBe("invalid_token");
  });
});
