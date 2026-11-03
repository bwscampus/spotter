"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/apiClient";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/ui/site";

/**
 * Across the top of every page while an email/password account has not
 * confirmed its address. Until it does, nothing that spends money works (the
 * paid routes run requireVerifiedUser, AUTH-2); everything else does. Google
 * accounts never see this: Google has verified the address already.
 *
 * It names the address on file, so a typo can be spotted, and how to reach a
 * person, and it says when the email could not be sent (Nov 1).
 */
export function ConfirmEmailBanner({ email }: { email: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    setState("sending");
    setError(null);
    const result = await api<{ ok: true; alreadyConfirmed?: boolean }>("POST", "/api/auth/resend-verification");
    if (result.ok && result.data.alreadyConfirmed) {
      // Confirmed in another tab or browser: the layout draws this banner, so read it again.
      router.refresh();
      return;
    }
    setState(result.ok ? "sent" : "failed");
    if (!result.ok) setError(result.error ?? null);
  };

  return (
    <div role="status" className="dash flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-2 px-4 py-2 text-[16px] text-ink">
      <p>
        <span className="font-semibold">Confirm your email</span> to import rosters and call games. Open the link StatCast
        sent to {email ? <span className="font-semibold">{email}</span> : "your address"} (check spam too).
      </p>
      {state === "sent" ? (
        <span className="text-muted">Sent. Check your inbox.</span>
      ) : state === "failed" && error ? (
        <span className="text-red">{error}</span>
      ) : (
        <button
          type="button"
          onClick={() => void resend()}
          disabled={state === "sending"}
          className="cursor-pointer text-accent hover:underline disabled:cursor-not-allowed disabled:text-muted"
        >
          {state === "sending" ? "Sending..." : state === "failed" ? "Could not send. Try again" : "Send it again"}
        </button>
      )}
      <span className="text-muted">
        Stuck? <a href={CONTACT_MAILTO} className="text-accent hover:underline">{CONTACT_EMAIL}</a>
      </span>
    </div>
  );
}
