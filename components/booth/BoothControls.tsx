"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/analytics/track";
import { api } from "@/lib/apiClient";
import { linkUrl, saveLink, savedLink } from "@/lib/booth/savedLink";

// =============================================================================
// Booth partners (Nov 15): the host's booth for one game, on the draft's
// setup page and in the live screen's ⋯ menu. The join code, the invite link
// to copy, who is in with Remove, and the saved partners on or off.
// Only the host sees it; every route behind it is the host's only.
// =============================================================================

interface Guest {
  slot: 1 | 2;
  label: string;
  method: "code" | "link" | "partner";
}

interface Booth {
  code: string;
  created: boolean;
  hasLink: boolean;
  guests: Guest[];
  partnersSaved: number;
  partnersOn: boolean;
}

const BUTTON =
  "h-9 shrink-0 cursor-pointer rounded-md border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-800 hover:border-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400";

export function BoothControls({ gameId }: { gameId: string }) {
  const [booth, setBooth] = useState<Booth | null>(null);
  const [failed, setFailed] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (result: Awaited<ReturnType<typeof api<Booth>>>) => {
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setBooth(result.data);
    if (result.data.created) track("booth.invite_created", { method: "code" });
    // The link this browser made for the game, if it made one (only its hash is on the server).
    const token = savedLink(gameId);
    if (token) setLink(linkUrl(token));
  };
  const load = async () => apply(await api<Booth>("GET", `/api/booth/${encodeURIComponent(gameId)}`));

  useEffect(() => {
    let cancelled = false;
    void api<Booth>("GET", `/api/booth/${encodeURIComponent(gameId)}`).then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const copy = async (text: string, what: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // The text is on screen to copy by hand.
    }
  };

  const makeLink = async () => {
    setBusy(true);
    const result = await api<{ token: string }>("POST", `/api/booth/${encodeURIComponent(gameId)}`, { reset: "link" });
    setBusy(false);
    if (!result.ok) return;
    saveLink(gameId, result.data.token);
    const url = linkUrl(result.data.token);
    setLink(url);
    track("booth.invite_created", { method: "link" });
    void copy(url, "link");
  };

  const remove = async (guest: Guest) => {
    if (!window.confirm(`Take ${guest.label} out of the booth? Their screen stops getting your cards, and they can't come back with the code or the link.`)) return;
    setBusy(true);
    const result = await api("DELETE", `/api/booth/${encodeURIComponent(gameId)}/members/${guest.slot}`);
    setBusy(false);
    if (result.ok) track("booth.guest_removed", {});
    await load();
  };

  const setPartners = async (on: boolean) => {
    setBusy(true);
    await api("PATCH", `/api/booth/${encodeURIComponent(gameId)}`, { partners: on });
    setBusy(false);
    await load();
  };

  if (failed) return <p className="text-sm text-neutral-500">Couldn&apos;t load the booth just now.</p>;
  if (!booth) return <p className="text-sm text-neutral-500">Loading the booth...</p>;

  const full = booth.guests.length >= 2;
  return (
    <div className="flex max-w-96 flex-col gap-3" data-testid="booth-controls">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Booth partners</span>
        <p className="text-sm text-neutral-600">
          Your partner joins from &quot;Join a game&quot; on their Home with this code, or with the link. Cards from either mic show on both
          screens.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-mono text-3xl font-black tracking-[0.3em]" data-testid="booth-code">
          {booth.code}
        </span>
        <button type="button" className={BUTTON} onClick={() => void copy(booth.code, "code")}>
          {copied === "code" ? "Copied" : "Copy code"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {link ? (
          <>
            <button type="button" className={BUTTON} onClick={() => void copy(link, "link")}>
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
            <button type="button" className={BUTTON} disabled={busy} onClick={() => void makeLink()}>
              Reset link
            </button>
          </>
        ) : (
          <button type="button" className={BUTTON} disabled={busy} onClick={() => void makeLink()}>
            {booth.hasLink ? "Make a new link" : "Make an invite link"}
          </button>
        )}
      </div>
      {link && <p className="break-all text-xs text-neutral-500">{link}</p>}
      <div className="flex flex-col gap-1">
        {booth.guests.length === 0 ? (
          <p className="text-sm text-neutral-500">Nobody has joined yet.</p>
        ) : (
          booth.guests.map((guest) => (
            <div key={guest.slot} className="flex items-center gap-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-semibold">{guest.label}</span>
              <button type="button" className={BUTTON} disabled={busy} onClick={() => void remove(guest)}>
                Remove
              </button>
            </div>
          ))
        )}
        {full && <p className="text-xs text-neutral-500">Two partners is the most a booth takes.</p>}
      </div>
      {booth.partnersSaved > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={booth.partnersOn} disabled={busy || (!booth.partnersOn && full)} onChange={(event) => void setPartners(event.target.checked)} />
          Add my saved booth partners to this game
        </label>
      )}
    </div>
  );
}
