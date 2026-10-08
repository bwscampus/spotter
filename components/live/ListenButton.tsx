"use client";

import type { MicStatus } from "@/lib/audio/useMicrophone";

/**
 * Start listening / Stop listening. One button on screen and no keyboard
 * shortcut at all (docs/V3_DEFINITION.md 7.2): a live mic is never turned off by
 * a key that was meant for something else.
 */
export function ListenButton({
  status,
  disabled,
  onToggle,
}: {
  status: MicStatus;
  /** There is no Deepgram key. */
  disabled: boolean;
  onToggle: () => void;
}) {
  const on = status === "on";
  const starting = status === "starting";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled && !on}
      // Dropping focus after the click is what stops a stray Space or Enter
      // during a game turning the mic off: nothing else on the live screen
      // wants the keyboard, so the button keeps it until told otherwise.
      onClick={(event) => {
        event.currentTarget.blur();
        onToggle();
      }}
      // Belt and braces for the case where focus got back here some other way.
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") event.preventDefault();
      }}
      className={`flex h-11 w-56 shrink-0 cursor-pointer items-center justify-center gap-3 rounded-xl border-2 text-lg font-black tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        on
          ? "border-green-300 bg-green-500 text-black shadow-[0_0_40px_rgba(34,197,94,0.45)]"
          : starting
            ? "border-amber-500 bg-amber-50 text-amber-700"
            : "border-neutral-400 bg-neutral-50 text-neutral-700 hover:border-neutral-600 hover:text-neutral-900"
      }`}
    >
      <span
        className={`h-3.5 w-3.5 shrink-0 rounded-full ${
          on ? "animate-pulse bg-white" : starting ? "bg-amber-300" : "bg-neutral-600"
        }`}
      />
      {on ? "Stop listening" : starting ? "Starting..." : "Start listening"}
    </button>
  );
}
