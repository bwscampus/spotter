import { cookies } from "next/headers";
import { generateNonce } from "@/lib/auth/googleNonce";
import { NO_STORE } from "@/lib/server/request";
import { NONCE_COOKIE } from "@/lib/server/session";

// The nonce for Google sign-in. The raw value goes into an HttpOnly cookie the
// page cannot read; the page gets only its SHA-256, which it hands to Google,
// and Google writes into the ID token it signs. POST /api/auth/google compares
// the two, so a token lifted from somewhere else cannot be replayed here.

const NONCE_MINUTES = 10;

export async function GET() {
  const { nonce, hashedNonce } = await generateNonce();
  (await cookies()).set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: NONCE_MINUTES * 60,
  });
  return Response.json({ nonce: hashedNonce }, { headers: NO_STORE });
}
