"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { INPUT } from "@/components/ui/Field";
import { ErrorRow } from "@/components/ui/Rows";
import { track } from "@/lib/analytics/track";
import { api } from "@/lib/apiClient";

// =============================================================================
// Booth partners in Settings (Nov 15): the announcers this account calls with.
// A partner added by email accepts once; after that every new game this
// account makes shows up in his games too (two at most). Below them, the
// invites waiting for this account, and the hosts it is already a partner of.
// =============================================================================

interface Partner {
  id: string;
  email: string;
  label: string | null;
  accepted: boolean;
  autoAdd: boolean;
}
interface Invite {
  id: string;
  hostLabel: string;
}
interface Partners {
  partners: Partner[];
  invites: Invite[];
  hosts: Invite[];
}

export function BoothPartners() {
  const [data, setData] = useState<Partners | null>(null);
  const [failed, setFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; link?: string } | null>(null);

  const apply = (result: Awaited<ReturnType<typeof api<Partners>>>) => {
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setData(result.data);
  };
  const load = async () => apply(await api<Partners>("GET", "/api/booth-partners"));

  useEffect(() => {
    let cancelled = false;
    void api<Partners>("GET", "/api/booth-partners").then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (call: () => Promise<{ ok: boolean; error?: string | null }>) => {
    setBusy(true);
    setError(null);
    const result = await call();
    setBusy(false);
    if (!result.ok) setError(result.error ?? "That didn't go through. Try again.");
    await load();
    return result.ok;
  };

  const add = async () => {
    setSaid(null);
    setBusy(true);
    setError(null);
    const result = await api<{ sent: boolean; link?: string }>("POST", "/api/booth-partners", { email: email.trim() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That didn't go through. Try again.");
      return;
    }
    track("booth.invite_created", { method: "partner" });
    setSaid(
      result.data.sent
        ? { text: `Invite sent to ${email.trim()}. Once they accept, your new games show up in their games too.` }
        : { text: "The email couldn't be sent from here. Send them this link yourself:", link: result.data.link },
    );
    setEmail("");
    await load();
  };

  if (failed) return <p className="text-muted">Couldn&apos;t load this just now. Reload to try again.</p>;
  if (!data) return <p className="text-muted">Loading...</p>;

  return (
    <div className="flex flex-col gap-4" data-testid="booth-partners">
      <p className="text-ink-2">
        Call with the same announcer most weeks? Add them once. After they accept, every new game you make shows up in their games as
        well, ready to start, and the cards from both of your mics show on both screens. Free, like the rest of StatCast.
      </p>

      {data.partners.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-[3px] border border-line">
          {data.partners.map((partner) => (
            <li key={partner.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{partner.label ?? partner.email}</span>
                {partner.label && <span className="ml-2 text-[14px] text-muted">{partner.email}</span>}
                <span className="ml-2 text-[14px] text-muted">{partner.accepted ? "Accepted" : "Invited"}</span>
              </span>
              {partner.accepted && (
                <label className="flex items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    checked={partner.autoAdd}
                    disabled={busy}
                    onChange={(event) => void run(() => api("PATCH", `/api/booth-partners/${partner.id}`, { autoAdd: event.target.checked }))}
                  />
                  Add to my new games
                </label>
              )}
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove ${partner.label ?? partner.email} as a booth partner? Games already made keep them until you take them out.`)) {
                    void run(() => api("DELETE", `/api/booth-partners/${partner.id}`));
                  }
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim()) void add();
        }}
      >
        <input
          type="email"
          className={`${INPUT} w-80`}
          placeholder="partner@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-label="Your booth partner's email"
        />
        <Button type="submit" disabled={busy || email.trim().length === 0}>
          Add booth partner
        </Button>
      </form>
      {said && (
        <p role="status" className="text-ink-2">
          {said.text}
          {said.link && <span className="mt-1 block break-all font-mono text-[14px]">{said.link}</span>}
        </p>
      )}

      {data.invites.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-semibold">Invites for you</span>
          {data.invites.map((invite) => (
            <div key={invite.id} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">{invite.hostLabel} wants you as a booth partner.</span>
              <Button variant="primary" disabled={busy} onClick={() => void run(() => api("POST", "/api/booth-partners/accept", { id: invite.id }))}>
                Accept
              </Button>
              <Button disabled={busy} onClick={() => void run(() => api("POST", "/api/booth-partners/decline", { id: invite.id }))}>
                Decline
              </Button>
            </div>
          ))}
        </div>
      )}

      {data.hosts.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-semibold">You&apos;re a booth partner of</span>
          {data.hosts.map((host) => (
            <div key={host.id} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">{host.hostLabel}</span>
              <Button
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Stop being ${host.hostLabel}'s booth partner? Their new games stop showing up in yours.`)) {
                    void run(() => api("DELETE", `/api/booth-partners/${host.id}?as=partner`));
                  }
                }}
              >
                Stop
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && <ErrorRow className="px-0" text={error} />}
    </div>
  );
}
