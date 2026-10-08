"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AUTH_BOX } from "@/components/auth/LoginForm";
import { buttonClass, TEXT_LINK } from "@/components/ui/Button";
import { api } from "@/lib/apiClient";
import { HOME_PATH } from "@/lib/ui/nav";

type State =
  | { step: "checking" }
  | { step: "done" }
  | { step: "failed"; error: string }
  | { step: "resent" };

/**
 * Where a confirmation link lands (`/auth/verify?token=...`). Posts the token to
 * POST /api/auth/verify-email once and says how it went. Opening the link is the
 * proof, so it works signed in or not, in any browser. The token is taken out
 * of the address bar as soon as it is read.
 */
export default function VerifyEmail() {
  const [state, setState] = useState<State>({ step: "checking" });
  const [resending, setResending] = useState(false);
  // React runs effects twice in development; a link works once, so post it once.
  const posted = useRef(false);

  useEffect(() => {
    if (posted.current) return;
    posted.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      if (!token) {
        setState({ step: "failed", error: "This page needs the link from a confirmation email." });
        return;
      }
      const result = await api<{ ok: true }>("POST", "/api/auth/verify-email", { token });
      if (result.ok) {
        setState({ step: "done" });
        return;
      }
      console.warn(`[Spotter] Email confirmation was refused (${result.code ?? result.status}).`);
      setState({ step: "failed", error: result.error ?? "Could not confirm the address. Try the link again." });
    })();
  }, []);

  async function resend() {
    setResending(true);
    const result = await api<{ ok: true }>("POST", "/api/auth/resend-verification");
    setResending(false);
    if (result.ok) {
      setState({ step: "resent" });
      return;
    }
    setState({
      step: "failed",
      error: result.status === 401 ? "Sign in first, then ask for a new link here." : (result.error ?? "Could not send a new link. Try again."),
    });
  }

  return (
    <main className="dash flex min-h-[calc(100dvh-40px)] items-start justify-center bg-surface-2 px-4 pt-16">
      <div className={AUTH_BOX}>
        {state.step === "checking" && (
          <>
            <h1 className="text-[15px] font-semibold">Confirming your email</h1>
            <p className="text-muted">One moment...</p>
          </>
        )}

        {state.step === "done" && (
          <>
            <h1 className="text-[15px] font-semibold">Email confirmed</h1>
            <p className="text-muted">Everything in Spotter is open to this account now.</p>
            <Link href={HOME_PATH} className={buttonClass("primary", "w-full")}>
              Go to Home
            </Link>
          </>
        )}

        {state.step === "resent" && (
          <>
            <h1 className="text-[15px] font-semibold">Check your email</h1>
            <p className="text-muted">A new link is on its way. It works for 24 hours, once.</p>
          </>
        )}

        {state.step === "failed" && (
          <>
            <h1 className="text-[15px] font-semibold">That link did not work</h1>
            <p role="alert" className="flex items-center gap-2 text-red">
              <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
              {state.error}
            </p>
            <p className="text-muted">Links work for 24 hours, once. Signed in, you can ask for a new one.</p>
            <button type="button" onClick={() => void resend()} disabled={resending} className={buttonClass("outlined", "w-full")}>
              {resending ? "Sending..." : "Send a new link"}
            </button>
            <Link href="/login" className={`${TEXT_LINK} self-start`}>
              Sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
