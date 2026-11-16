"use client";

import { useSyncExternalStore } from "react";
import type { BoothBridge, BoothState } from "@/lib/game/boothBridge";

// Booth partners (Nov 15): the booth's connection, beside speech
// recognition's in the live screen's top bar. Shown once someone else is in
// the booth; a game called alone shows nothing new.

const DOT = { ok: "bg-green-500", wait: "bg-amber-400", bad: "animate-pulse bg-red-500", off: "bg-neutral-600" } as const;
const TEXT = { ok: "text-green-700", wait: "text-amber-700", bad: "text-red-600", off: "text-neutral-600" } as const;

export function describeBooth(state: BoothState): { tone: keyof typeof DOT; label: string; detail: string } | null {
  if (state.members.length < 2) return null;
  const others = state.members.filter((member) => member.slot !== state.you);
  const online = others.filter((member) => member.online).length;
  if (state.status === "reconnecting" || state.status === "connecting") {
    return { tone: "bad", label: "BOOTH RECONNECTING", detail: "Your own cards still go up; your partner's come back when it reconnects" };
  }
  if (state.status === "closed") return { tone: "off", label: "BOOTH OFF", detail: "Calling on your own" };
  if (online === 0) return { tone: "wait", label: "BOOTH · PARTNER OFF", detail: "Your partner's laptop isn't connected" };
  return { tone: "ok", label: online === 1 ? "BOOTH" : `BOOTH · ${online}`, detail: `Cards from ${online === 1 ? "your partner's mic" : `${online} partners' mics`} show here` };
}

export function BoothStatus({ booth }: { booth: BoothBridge }) {
  const state = useSyncExternalStore(
    (onChange) => booth.subscribe(onChange),
    () => booth.state(),
    () => booth.state(),
  );
  const shown = describeBooth(state);
  if (!shown) return null;
  return (
    <div className="flex shrink-0 items-center gap-2" data-testid="booth-status" title={`Booth: ${shown.detail}`}>
      <span className={`h-3 w-3 shrink-0 rounded-full ${DOT[shown.tone]}`} />
      <span className={`text-sm font-black tracking-wider ${TEXT[shown.tone]}`}>{shown.label}</span>
    </div>
  );
}
