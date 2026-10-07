/**
 * A nonce for Google's ID token, in the two forms the sign-in needs.
 *
 * Google is given the SHA-256 hash and writes it into the ID token it signs.
 * Supabase is given the raw value, hashes it itself and compares, so a token
 * lifted from somewhere else cannot be replayed here. A fresh pair is made
 * every time the Google client is initialized.
 */
export async function generateNonce(): Promise<{ nonce: string; hashedNonce: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...bytes));
  return { nonce, hashedNonce: await sha256Hex(nonce) };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
