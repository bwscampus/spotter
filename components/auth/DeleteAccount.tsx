"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { deleteMyAccount } from "@/lib/auth/deleteAccount";

/** What has to be typed for the second ask. */
const CONFIRM_WORD = "DELETE";

/**
 * Delete my account, asked twice: the button, then typing DELETE. On success
 * this browser's own copy goes too, the session ends, and the landing page
 * loads fresh.
 */
export function DeleteAccount({ hasPassword = false }: { hasPassword?: boolean }) {
  const [step, setStep] = useState<"idle" | "confirm">("idle");
  const [typed, setTyped] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape backs out of the second ask, like any confirm.
  useEffect(() => {
    if (step !== "confirm" || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setStep("idle");
      setTyped("");
      setError(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, busy]);

  if (step === "idle") {
    return (
      <Button variant="destructive" onClick={() => setStep("confirm")}>
        Delete my account
      </Button>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (typed !== CONFIRM_WORD || busy || (hasPassword && password.length === 0)) return;
    setBusy(true);
    setError(null);
    const result = await deleteMyAccount(hasPassword ? password : undefined);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    // A full load, so nothing from the deleted account stays in memory.
    window.location.replace(new URL("/", window.location.origin).href);
  };

  return (
    <form onSubmit={submit} className="flex max-w-[480px] flex-col gap-2">
      <p className="font-semibold text-red">
        This deletes your account and everything in it: teams, rosters, season stats, past games, feedback and shared game
        logs. It cannot be undone.
      </p>
      <label htmlFor="confirm-delete" className={LABEL}>
        Type {CONFIRM_WORD} to confirm
      </label>
      <input
        id="confirm-delete"
        autoFocus
        autoComplete="off"
        spellCheck={false}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        className={`${INPUT} w-full max-w-[240px]`}
      />
      {hasPassword && (
        <>
          <label htmlFor="confirm-password" className={LABEL}>
            Your password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`${INPUT} w-full max-w-[240px]`}
          />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={typed !== CONFIRM_WORD || busy || (hasPassword && password.length === 0)}>
          {busy ? "Deleting..." : "Delete everything"}
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setStep("idle");
            setTyped("");
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-2 text-red">
          <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
          {error}
        </p>
      )}
    </form>
  );
}
