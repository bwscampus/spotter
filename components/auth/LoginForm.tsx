"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, TEXT_LINK } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { api } from "@/lib/apiClient";
import { HOME_PATH } from "@/lib/ui/nav";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/ui/site";
import { GoogleSignIn } from "./GoogleSignIn";

// =============================================================================
// TUNING: what Spotter asks of a password.
// The server is the judge (lib/server/password.ts: at least 8, at most 200, not
// a common one). Asking for the length here too means that refusal arrives
// while the field is still in front of you.
// =============================================================================

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

// =============================================================================

const FIELD = `${INPUT} w-full`;
const QUIET = TEXT_LINK;

/** Sign in, create an account, or ask for a reset link. One form, three jobs. */
export type Mode = "signin" | "signup" | "forgot";

const HEADING: Record<Mode, string> = {
  signin: "Sign in",
  signup: "Create an account",
  forgot: "Reset your password",
};

/** The box every sign-in screen sits in (docs/UI_STYLE.md, A10). */
export const AUTH_BOX = "flex w-full max-w-[320px] flex-col gap-3 rounded-[3px] border border-line bg-surface p-5";

const ACTION: Record<Mode, string> = {
  signin: "Sign in",
  signup: "Create account",
  forgot: "Send reset link",
};

const ROUTE: Record<Mode, string> = {
  signin: "/api/auth/signin",
  signup: "/api/auth/signup",
  forgot: "/api/auth/forgot-password",
};

/** Reset and confirmation emails can be slow or land in spam, so the form says how to reach a person. */
function EmailFallback() {
  return (
    <>
      If nothing arrives within a few minutes, check spam, or write to{" "}
      <a href={CONTACT_MAILTO} className={TEXT_LINK}>
        {CONTACT_EMAIL}
      </a>
      .
    </>
  );
}

/**
 * The sign-in screen: Google's button on top, then email and password.
 *
 * The server answers sign-up and "forgot password" the same way whether or not
 * the address has an account, and sign-in the same way for an unknown address
 * and a wrong password (AUTH-7), so this form never says which it was either.
 */
export function LoginForm({ notice = null, initialMode = "signin" }: { notice?: string | null; initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice);
  const [sent, setSent] = useState<"signup" | "reset" | null>(null);

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
    setSent(null);
    if (next === "forgot") setPassword("");
  };

  /**
   * Into the app. refresh() as well as push(), so the server re-renders with
   * the new session cookie rather than serving the signed-out menu from the
   * router cache.
   */
  function enter() {
    router.push(HOME_PATH);
    router.refresh();
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSent(null);
    const address = email.trim();

    if (mode === "signup" && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setBusy(true);
    const body = mode === "forgot" ? { email: address } : { email: address, password };
    const result = await api<{ ok: true }>("POST", ROUTE[mode], body);
    setBusy(false);

    if (!result.ok) {
      // The code only, never the address or the password.
      if (result.status !== 401) console.warn(`[Spotter] ${mode} was refused (${result.code ?? result.status}).`);
      setError(result.error ?? (result.status === 0 ? "Could not reach Spotter. Check the connection and try again." : "That did not go through. Try again."));
      return;
    }
    setPassword("");
    if (mode === "signin") {
      enter();
      return;
    }
    setSent(mode === "signup" ? "signup" : "reset");
  };

  if (sent) {
    return (
      <div className={AUTH_BOX}>
        <h1 className="text-[15px] font-semibold">Check your email</h1>
        {sent === "signup" ? (
          <>
            <p className="text-muted">
              We sent a link to {email.trim()}. Open it to confirm the address: until then Spotter can&apos;t read files or listen to
              a game. If that address already has an account, the email says so instead, and you can sign in.
            </p>
            <p className="text-[12px] text-muted">
              <EmailFallback />
            </p>
            <button type="button" onClick={enter} className={buttonClass("primary", "w-full")}>
              Continue
            </button>
          </>
        ) : (
          <p className="text-muted">
            If {email.trim()} has an account, a reset link is on its way. It works for an hour, once. <EmailFallback />
          </p>
        )}
        <button type="button" onClick={() => switchTo("signin")} className={`${QUIET} self-start`}>
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className={AUTH_BOX}>
      <h1 className="text-[15px] font-semibold">{HEADING[mode]}</h1>

      {mode === "forgot" && <p className="text-muted">Enter your email and Spotter sends a link to set a new password.</p>}

      {mode !== "forgot" && <GoogleSignIn onError={setError} />}

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className={LABEL}>
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={FIELD}
          />
        </div>

        {mode !== "forgot" && (
          <div className="flex flex-col gap-1">
            <label htmlFor="password" className={LABEL}>
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={mode === "signup" ? MIN_PASSWORD_LENGTH : undefined}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={FIELD}
            />
            {mode === "signup" && <p className="text-[12px] text-muted">At least {MIN_PASSWORD_LENGTH} characters, and not a common one.</p>}
          </div>
        )}

        <button type="submit" disabled={busy || email.trim().length === 0} className={buttonClass("primary", "w-full")}>
          {busy ? "Working..." : ACTION[mode]}
        </button>
      </form>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-red">
          <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {mode !== "signin" && (
          <button type="button" onClick={() => switchTo("signin")} className={QUIET}>
            Back to sign in
          </button>
        )}
        {mode !== "forgot" && (
          <button type="button" onClick={() => switchTo("forgot")} className={QUIET}>
            Forgot password?
          </button>
        )}
        {mode !== "signup" && (
          <button type="button" onClick={() => switchTo("signup")} className={QUIET}>
            Create account
          </button>
        )}
      </div>

      {mode === "signup" && (
        <p className="text-[12px] text-muted">
          By creating an account you agree to the{" "}
          <Link href="/terms" className={TEXT_LINK}>
            Terms
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className={TEXT_LINK}>
            Privacy policy
          </Link>
          .
        </p>
      )}
    </div>
  );
}
