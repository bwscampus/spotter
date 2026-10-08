"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buttonClass, TEXT_LINK } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { api } from "@/lib/apiClient";
import { HOME_PATH } from "@/lib/ui/nav";
import { AUTH_BOX } from "./LoginForm";

// Matches what the sign-up form asks for; the server is the judge.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

const FIELD = `${INPUT} w-full`;

/**
 * Sets a new password from the emailed link. `token` is the link's token; this
 * form posts it with the password to POST /api/auth/reset-password, which spends
 * the link, signs the account out everywhere and this browser back in.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState(false);

  // Take the token out of the address bar, so it is not left in the history or
  // shown on a shared screen. The form already holds it.
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmation) {
      setError("Those two passwords are not the same.");
      return;
    }

    setSaving(true);
    setError(null);
    const result = await api<{ ok: true }>("POST", "/api/auth/reset-password", { token, password });
    if (!result.ok) {
      setSaving(false);
      console.warn(`[Spotter] Password reset was refused (${result.code ?? result.status}).`);
      if (result.code === "invalid_token") setLinkDead(true);
      setError(result.error ?? "Could not set that password. Try again.");
      return;
    }
    // refresh() as well, so the menu is re-rendered with the session this just started.
    router.push(HOME_PATH);
    router.refresh();
  };

  if (linkDead) {
    return (
      <div className={AUTH_BOX}>
        <h1 className="text-[15px] font-semibold">That link has run out</h1>
        <p className="text-muted">Reset links work for an hour, once. Ask for a new one from the sign-in page.</p>
        <Link href="/login" className={`${TEXT_LINK} self-start`}>
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={save} className={AUTH_BOX}>
      <h1 className="text-[15px] font-semibold">Set a new password</h1>
      <p className="text-muted">Saving it signs this account out everywhere else and takes you to Home.</p>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className={LABEL}>
          New password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={FIELD}
        />
        <p className="text-[12px] text-muted">At least {MIN_PASSWORD_LENGTH} characters, and not a common one.</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirmation" className={LABEL}>
          Again
        </label>
        <input
          id="confirmation"
          type="password"
          required
          maxLength={MAX_PASSWORD_LENGTH}
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          className={FIELD}
        />
      </div>

      <button type="submit" disabled={saving} className={buttonClass("primary", "w-full")}>
        {saving ? "Saving..." : "Save password"}
      </button>

      {error && (
        <p role="alert" className="flex items-center gap-2 text-red">
          <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
          {error}
        </p>
      )}
    </form>
  );
}
