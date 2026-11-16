"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorRow } from "@/components/ui/Rows";
import { track } from "@/lib/analytics/track";
import { api } from "@/lib/apiClient";
import { takeBoothSignUp } from "@/lib/auth/next";

/** Booth partners (Nov 15): the emailed invite, accepted once by whoever opens it signed in. */
export function AcceptPartner({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const accept = async () => {
    setBusy(true);
    setError(null);
    const result = await api("POST", "/api/booth-partners/accept", { token });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That didn't go through. Try again.");
      return;
    }
    track("booth.joined", { method: "partner" });
    if (takeBoothSignUp()) track("booth.guest_signed_up", {});
    setDone(true);
    router.refresh();
  };

  if (done) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-ink-2">You&apos;re booth partners. Their new games show up in your games, ready to start.</p>
        <div>
          <ButtonLink variant="primary" href="/games">
            Go to my games
          </ButtonLink>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button variant="primary" disabled={busy} onClick={() => void accept()}>
          {busy ? "Accepting..." : "Accept"}
        </Button>
      </div>
      {error && <ErrorRow className="px-0" text={error} />}
    </div>
  );
}
