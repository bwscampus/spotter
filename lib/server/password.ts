import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { COMMON_PASSWORDS } from "./commonPasswords";

// Passwords (Production Standard AUTH-1). scrypt, as in papaspuzzles' session.ts,
// with a per-password random salt and a constant-time compare. Server only.

// =============================================================================
// TUNING: what a password must be, and what hashing one costs.
// =============================================================================

export const MIN_PASSWORD_LENGTH = 8;
/** Long enough for any passphrase, short enough that hashing one is cheap. */
export const MAX_PASSWORD_LENGTH = 200;
/**
 * scrypt cost. N = 2^15 with r = 8 takes 32 MiB and roughly 50-100 ms per hash.
 * OWASP's figure is 2^17 (128 MiB), which several sign-ins at once would push a
 * small Railway container out of memory. The parameters are written into each
 * hash, so raising them later only changes new hashes.
 */
const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_BYTES = 64;
const SALT_BYTES = 16;

// =============================================================================

/** Node's default maxmem (32 MiB) is exactly 128 * N * r, which it refuses; leave room. */
function options(cost: { N: number; r: number; p: number }): ScryptOptions {
  return { ...cost, maxmem: 256 * cost.N * cost.r };
}

function scrypt(password: string, salt: Buffer, length: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize("NFKC"), salt, length, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** `scrypt$N$r$p$salt$key`, salt and key in hex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES, options(COST));
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** True only when `password` produced `stored`. A missing or malformed hash is false, never an error. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, saltHex, keyHex] = stored.split("$");
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  // Bounds so a corrupted row cannot ask for gigabytes.
  if (!Number.isInteger(cost.N) || cost.N < 2 ** 10 || cost.N > 2 ** 20 || (cost.N & (cost.N - 1)) !== 0) return false;
  if (!Number.isInteger(cost.r) || cost.r < 1 || cost.r > 32 || !Number.isInteger(cost.p) || cost.p < 1 || cost.p > 4) return false;
  const expected = Buffer.from(keyHex, "hex");
  if (expected.length === 0) return false;
  try {
    const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, options(cost));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;

/**
 * A real hash of nothing anyone knows. Sign-in checks the password against it
 * when the email has no password, so an unknown address takes as long to refuse
 * as a wrong password (AUTH-7).
 */
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(32).toString("hex"));
  return dummy;
}

export type PasswordProblem = { code: "weak_password"; error: string };

/** Why a new password is refused, or null when it will do. */
export function passwordProblem(password: unknown): PasswordProblem | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return { code: "weak_password", error: `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { code: "weak_password", error: `Passwords can be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { code: "weak_password", error: "That password is one of the most common, so it is easy to guess. Pick another." };
  }
  return null;
}

/** Longest address the users table takes is 320; the useful limit (RFC 5321) is 254. */
const MAX_EMAIL_LENGTH = 254;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The address as Spotter stores it: trimmed and lowercased, the same way the
 * Google route stores Google's, so one person has one spelling. Null when it is
 * not an address.
 */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) return null;
  return email;
}
