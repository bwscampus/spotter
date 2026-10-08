"use client";

import type { ConnectionState } from "@/lib/deepgram/DeepgramStream";
import { SPEECH_NOT_SET_UP_MESSAGE, speechFailureMessage } from "@/lib/messages";

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
  if (!hasApiKey) return { tone: "bad" as Tone, label: "NOT SET UP", detail: SPEECH_NOT_SET_UP_MESSAGE };
  if (!micOn) return { tone: "off" as Tone, label: "OFF", detail: "Connects when the mic is on" };
  switch (state.status) {
    case "open":
      return { tone: "ok" as Tone, label: "LIVE", detail: "Hearing you" };
    case "reconnecting":
      return { tone: "bad" as Tone, label: "RECONNECTING", detail: `Reconnecting, attempt ${state.attempt}` };
    case "failed":
      return { tone: "bad" as Tone, label: "FAILED", detail: speechFailureMessage(state.reason) };
    default:
      return { tone: "wait" as Tone, label: "CONNECTING", detail: "Opening connection" };
  }
}

export function ConnectionStatus(props: ConnectionStatusProps) {
  const { tone, label, detail } = describe(props);

  return (
    <div className="flex shrink-0 items-center gap-2" data-testid="connection-status" title={`Speech recognition: ${detail}`}>
      <span className={`h-3 w-3 shrink-0 rounded-full ${DOT[tone]}`} />
      <span className={`text-sm font-black tracking-wider ${TEXT[tone]}`}>{label}</span>
    </div>
  );
}
