"use client";

import type { WakeLockState } from "@/lib/audio/useWakeLock";

/**
 * Whether the screen is being held awake while the mic is on.
 *
 * Worth a line on screen because the failure it reports is silent: a laptop
 * that dozes takes the microphone with it, and the first sign of it is that
 * names stop coming up. When the lock is not available the announcer has to
 * set the machine not to sleep, so the message says exactly that.
 */
export function ScreenAwake({ state }: { state: WakeLockState }) {
  if (state === "off") return null;

  const warning = state !== "held";

  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-1" data-testid="screen-awake">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Screen</span>
      <p className={`h-5 max-w-72 truncate text-sm ${warning ? "font-semibold text-amber-700" : "text-neutral-600"}`}>
        {warning ? "Screen may sleep. Set this Mac to never sleep while plugged in." : "Screen: awake"}
      </p>
    </div>
  );
}
