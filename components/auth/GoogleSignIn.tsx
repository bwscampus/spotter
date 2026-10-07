"use client";

import { useRouter } from "next/navigation";
import Script from "next/script";
import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/track";
import { api } from "@/lib/apiClient";

// =============================================================================
// TUNING: how Google's button looks.
// Google draws the button itself, inside an iframe, so only its own options
// apply. Width is in pixels and Google clamps it to 200..400.
// =============================================================================

const BUTTON: google.accounts.id.GsiButtonConfiguration = {
  type: "standard",
  theme: "outline",
  size: "large",
  text: "continue_with",
  shape: "rectangular",
  logo_alignment: "center",
};
const MAX_BUTTON_WIDTH = 400;

// =============================================================================

const GSI_SRC = "https://accounts.google.com/gsi/client";
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
let warnedMissingClientId = false;

/**
 * Google's own "Sign in with Google" button, plus One Tap. Sign-in is Google
 * only (docs/technical-design.md section 4). Renders nothing without a client ID.
 *
 * The server hands out a nonce (GET /api/auth/nonce keeps the raw value in an
 * HttpOnly cookie and gives the page its hash). Google writes that hash into
 * the ID token it signs, and POST /api/auth/google checks both before it starts
 * a session. There is no redirect and no callback route.
 */
export function GoogleSignIn({ onError }: { onError: (message: string | null) => void }) {
  const router = useRouter();
  const slot = useRef<HTMLDivElement>(null);
  // Guards the async setup against the page having moved on before it ends.
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (!CLIENT_ID && !warnedMissingClientId) {
      warnedMissingClientId = true;
      console.warn(
        "[Spotter] NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set, so the Google sign-in button is hidden. Add it to .env.local and restart npm run dev.",
      );
    }
    return () => {
      mounted.current = false;
      // Leaving the page should not leave a One Tap prompt floating over the next one.
      if (typeof google !== "undefined") google.accounts.id.cancel();
    };
  }, []);

  if (!CLIENT_ID) return null;
  const clientId = CLIENT_ID;

  async function initialize() {
    const parent = slot.current;
    if (!parent || typeof google === "undefined") return;

    // A fresh nonce each time, including after a failed attempt.
    const issued = await api<{ nonce: string }>("GET", "/api/auth/nonce");
    if (!mounted.current) return;
    if (!issued.ok) {
      onError("Could not reach Spotter to sign in. Check the connection and reload.");
      return;
    }

    google.accounts.id.initialize({
      client_id: clientId,
      nonce: issued.data.nonce,
      use_fedcm_for_prompt: true,
      itp_support: true,
      callback: (response) => void finish(response),
    });
    // renderButton appends, so a second setup (a retry, a remount) would stack buttons.
    parent.replaceChildren();
    google.accounts.id.renderButton(parent, {
      ...BUTTON,
      width: Math.min(MAX_BUTTON_WIDTH, Math.max(200, Math.floor(parent.clientWidth))),
    });
    // This button is only shown to someone signed out.
    google.accounts.id.prompt();
  }

  async function finish(response: google.accounts.id.CredentialResponse) {
    onError(null);
    if (!response.credential) {
      onError("Google did not complete the sign-in. Try again.");
      return;
    }
    const signedIn = await api<{ ok: true; created: boolean }>("POST", "/api/auth/google", { credential: response.credential });
    if (!signedIn.ok) {
      // The code only, never the token.
      console.warn(`[Spotter] Google sign-in was refused (${signedIn.code ?? signedIn.status}).`);
      onError(signedIn.error ?? "Google sign-in did not go through. Try again.");
      void initialize();
      return;
    }
    // Google has no separate sign-up step: the server says when this sign-in made the account.
    if (signedIn.data.created) track("account.signed_up", { method: "google" });
    // refresh() so the server re-renders with the new session cookie rather
    // than serving the signed-out menu from the router cache.
    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <Script src={GSI_SRC} strategy="afterInteractive" onReady={() => void initialize()} />
      <div ref={slot} className="flex h-10 w-full justify-center" />
    </>
  );
}
