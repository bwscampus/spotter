import type { ReactNode } from "react";

export type Tone = "amber" | "green" | "red" | "neutral";

const TONES: Record<Tone, string> = {
  amber: "border-amber-line bg-amber-fill text-amber-text",
  green: "border-green-line bg-green-fill text-green",
  red: "border-red-line bg-red-fill text-red",
  neutral: "border-line-strong bg-surface text-ink-2",
};

/**
 * A badge (docs/UI_STYLE.md): 18px, 11px/600. `reason` is the full text: the
 * tooltip, and read out to a screen reader after the short label.
 */
export function Badge({ tone = "neutral", reason, children }: { tone?: Tone; reason?: string; children: ReactNode }) {
  return (
    <span
      title={reason}
      className={`inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-[2px] border px-1 text-[11px] font-semibold leading-none ${TONES[tone]}`}
    >
      {children}
      {reason && <span className="sr-only">: {reason}</span>}
    </span>
  );
}
