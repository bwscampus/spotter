"use client";

import { useState } from "react";
import { api } from "@/lib/apiClient";

/**
 * Across the top of every page while an email/password account has not
 * confirmed its address. Until it does, nothing that spends money works (the
 * paid routes run requireVerifiedUser, AUTH-2); everything else does. Google
 * accounts never see this: Google has verified the address already.
 */
export function ConfirmEmailBanner() {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const resend = async () => {
    setState("sending");
    const result = await api("POST", "/api/auth/resend-verification");
    setState(result.ok ? "sent" : "failed");
  };

  return (
    <div role="status" className="dash flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface-2 px-4 py-2 text-[13px] text-ink">
      <p>
        <span className="font-semibold">Confirm your email</span> to import rosters, read stats and listen. Open the link
        StatCast sent you.
      </p>
      {state === "sent" ? (
        <span className="text-muted">Sent. Check your inbox.</span>
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
    </div>
  );
}
