"use client";

import type { ConnectionState } from "@/lib/deepgram/DeepgramStream";

interface ConnectionStatusProps {
  state: ConnectionState;
  micOn: boolean;
  hasApiKey: boolean;
}

type Tone = "off" | "wait" | "ok" | "bad";

const DOT: Record<Tone, string> = {
  off: "bg-neutral-600",
  wait: "bg-amber-400",
  ok: "bg-green-500",
  bad: "animate-pulse bg-red-500",
};

const TEXT: Record<Tone, string> = {
  off: "text-neutral-600",
  wait: "text-amber-700",
  ok: "text-green-700",
  bad: "text-red-600",
};

function describe({ state, micOn, hasApiKey }: ConnectionStatusProps) {
  if (!hasApiKey) return { tone: "bad" as Tone, label: "NO API KEY", detail: "Add DEEPGRAM_API_KEY to .env.local" };
  if (!micOn) return { tone: "off" as Tone, label: "OFF", detail: "Connects when the mic is on" };
  switch (state.status) {
    case "open":
      return { tone: "ok" as Tone, label: "LIVE", detail: "Streaming to Deepgram" };
    case "reconnecting":
      return { tone: "bad" as Tone, label: "RECONNECTING", detail: `Attempt ${state.attempt}: ${state.reason}` };
    case "failed":
      return { tone: "bad" as Tone, label: "FAILED", detail: state.reason };
    default:
      return { tone: "wait" as Tone, label: "CONNECTING", detail: "Opening connection" };
  }
}

export function ConnectionStatus(props: ConnectionStatusProps) {
  const { tone, label, detail } = describe(props);

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="connection-status">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Deepgram</span>
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 shrink-0 rounded-full ${DOT[tone]}`} />
        <span className={`text-sm font-black tracking-wider ${TEXT[tone]}`}>{label}</span>
      </div>
      <p className="h-4 max-w-64 truncate text-xs text-neutral-500" title={detail}>
        {detail}
      </p>
    </div>
  );
}
