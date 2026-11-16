// =============================================================================
// Booth partners (Nov 15): the join code and the invite link's token, as the
// browser and the server both read them. Pure; the server makes them with
// node:crypto (lib/server/repo/booth.ts).
// =============================================================================

/**
 * The characters a join code is made of: capitals and digits with nothing
 * that reads two ways, so no 0, O, 1, I or L. Held equal to the check on
 * booth_invites.code (db/migrations/0031_booth.sql) by a test.
 */
export const BOOTH_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const BOOTH_CODE_LENGTH = 4;

const CODE_SHAPE = new RegExp(`^[${BOOTH_CODE_ALPHABET}]{${BOOTH_CODE_LENGTH}}$`);

/**
 * A code as typed, made comparable: capitals, with spaces and dashes taken
 * out ("ab-2c" is "AB2C"). Not a code at all is null.
 */
export function normalizeCode(typed: unknown): string | null {
  if (typeof typed !== "string") return null;
  const code = typed.toUpperCase().replace(/[\s-]/g, "");
  return CODE_SHAPE.test(code) ? code : null;
}

/** A new code from a source of random integers below `max` (crypto.randomInt on the server). */
export function makeCode(randomBelow: (max: number) => number): string {
  let code = "";
  for (let i = 0; i < BOOTH_CODE_LENGTH; i++) code += BOOTH_CODE_ALPHABET[randomBelow(BOOTH_CODE_ALPHABET.length)];
  return code;
}

/** 32 random bytes as base64url, like every other emailed or shared token here. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function isBoothToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

/** "/join/<token>", the path an invite link opens. */
export function joinPath(token: string): string {
  return `/join/${token}`;
}

/** "/booth-partner/<token>", the path a saved-partner email opens. */
export function partnerPath(token: string): string {
  return `/booth-partner/${token}`;
}
