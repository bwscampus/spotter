"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AboutYou } from "@/components/onboarding/AboutYou";
import { Button } from "@/components/ui/Button";
import { INPUT, LABEL } from "@/components/ui/Field";
import { ErrorRow } from "@/components/ui/Rows";
import { track } from "@/lib/analytics/track";
import { api } from "@/lib/apiClient";
import { takeBoothSignUp } from "@/lib/auth/next";
import { BOOTH_CODE_LENGTH, normalizeCode } from "@/lib/booth/code";
import { boothHref } from "@/lib/game/drafts";
import type { Sport } from "@/lib/rosters/types";

// =============================================================================
// Booth partners (Nov 15): joining a partner's game, by the 4-character code
// (`/join`, from Home's "Join a game") or by the invite link (`/join/<token>`).
// An announcer who has not answered "About you" yet (a new account made on
// the way here) is asked only what kind of announcing he does first. Then he
// joins, and the game opens on its booth page, or, when the host's game is
// already under way, straight on the live screen (the booth page with ?go=1).
// =============================================================================

type Joined = { gameId: string; guestGameId: string; live: boolean };

export function JoinGame({
  token = null,
  needsRoles,
  sport = null,
}: {
  /** The invite link's token; without it the page asks for the code. */
  token?: string | null;
  needsRoles: boolean;
  /** The game's sport, saved as his when he answers the one question. */
  sport?: Sport | null;
}) {
  const router = useRouter();
  const [askRoles, setAskRoles] = useState(needsRoles);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  const join = async (body: { code: string } | { token: string }, method: "code" | "link") => {
    setBusy(true);
    setError(null);
    const result = await api<Joined>("POST", "/api/booth/join", body);
    if (!result.ok) {
      setBusy(false);
      setError(result.error ?? (result.status === 0 ? "Could not reach StatCast. Check the connection and try again." : "That didn't work. Try again."));
      return;
    }
    track("booth.joined", { method });
    if (takeBoothSignUp()) track("booth.guest_signed_up", {});
    router.replace(`${boothHref(result.data.gameId)}${result.data.live ? "?go=1" : ""}`);
    router.refresh();
  };

  // The link joins as soon as the one question is answered (or straight away).
  useEffect(() => {
    if (!token || askRoles || tried.current) return;
    tried.current = true;
    void join({ token }, "link");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, askRoles]);

  if (askRoles) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-ink-2">One question first, then you&apos;re in the game.</p>
        <AboutYou initial={{ sports: [], roles: [] }} mode="booth" boothSport={sport} onDone={() => setAskRoles(false)} />
      </div>
    );
  }

  if (token) {
    return (
      <div className="flex flex-col gap-3">
        {busy && <p className="text-ink-2">Joining the game...</p>}
        {error && <ErrorRow className="px-0" text={error} />}
        {error && (
          <div>
            <Button
              variant="outlined"
              onClick={() => {
                void join({ token }, "link");
              }}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }

  const typed = normalizeCode(code);
  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (typed) void join({ code: typed }, "code");
      }}
    >
      <label className={LABEL} htmlFor="booth-code">
        The game&apos;s code
      </label>
      <p className="text-[14px] text-muted">Your partner finds it on their game&apos;s setup page, or in the ⋯ menu on their live screen.</p>
      <div className="flex gap-2">
        <input
          id="booth-code"
          className={`${INPUT} w-40 font-mono text-[22px] uppercase tracking-[0.3em]`}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={BOOTH_CODE_LENGTH + 2}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          aria-invalid={error !== null}
        />
        <Button variant="primary" type="submit" disabled={busy || !typed}>
          {busy ? "Joining..." : "Join"}
        </Button>
      </div>
      {error && <ErrorRow className="px-0" text={error} />}
    </form>
  );
}
