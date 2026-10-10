"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { api } from "@/lib/apiClient";
import { HOME_PATH } from "@/lib/ui/nav";
import { AUTH_BOX } from "./LoginForm";

/** testrun2's sign-in: one passcode, one shared account (lib/server/testrunAccess.ts). */
export function PasscodeForm() {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await api<{ ok: true }>("POST", "/api/auth/passcode", { passcode });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? (result.status === 0 ? "Could not reach StatCast. Check the connection and try again." : "That did not go through. Try again."));
      return;
    }
    setPasscode("");
    router.push(HOME_PATH);
    router.refresh();
  };

  return (
    <div className={AUTH_BOX}>
      <h1 className="text-[15px] font-semibold">Test run</h1>
      <p className="text-muted">Enter the passcode. Everyone shares one test account here, and nothing counts toward analytics.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="passcode" className={LABEL}>
            Passcode
          </label>
          <input
            id="passcode"
            type="password"
            required
            maxLength={200}
            autoComplete="current-password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            className={`${INPUT} w-full`}
          />
        </div>
        <button type="submit" disabled={busy || passcode.trim().length === 0} className={buttonClass("primary", "w-full")}>
          {busy ? "Working..." : "Enter"}
        </button>
      </form>
      {error && (
        <p role="alert" className="flex items-center gap-2 text-red">
          <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
          {error}
        </p>
      )}
    </div>
  );
}
