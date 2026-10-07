import { useEffect, useState } from "react";

// =============================================================================
// Keeping the screen awake while the mic is on.
//
// A laptop that dozes mid-game takes the microphone with it, which ends the
// broadcast's name spotting without anything on screen saying so. The Screen
// Wake Lock API keeps the display on for as long as the tab holds the lock.
//
// Two things about the lock are not obvious and are why this is a hook rather
// than a one-line call:
//
// - The browser releases it on its own whenever the tab is hidden, and does not
//   give it back when the tab is shown again. So it is re-requested on
//   visibilitychange, every time.
// - It is not everywhere. Safari has it, older browsers do not, and a browser
//   can refuse the request outright. Nothing here throws: the live screen says
//   what it got and the announcer sets the OS to never sleep instead.
//
// The lock keeps the display on. It cannot stop a closed lid from sleeping.
// =============================================================================

/**
 * held        the screen is being kept awake.
 * unsupported this browser has no wake lock.
 * denied      it has one and refused, which is also what a locked screen does.
 * off         nothing is asking for it: the mic is off.
 */
export type WakeLockState = "held" | "unsupported" | "denied" | "off";

/**
 * Holds a screen wake lock while `active` is true.
 *
 * Outside the hot path in every sense: it runs on the mic turning on and off,
 * and on the tab being shown again.
 */
export function useWakeLock(active: boolean): WakeLockState {
  // Read once, lazily: navigator does not exist while the page is rendered on
  // the server, and whether a browser has the API cannot change afterwards.
  const [supported] = useState(
    () => typeof navigator !== "undefined" && typeof navigator.wakeLock?.request === "function",
  );
  // What the last request came back with, and nothing else: "off" and
  // "unsupported" are derived below rather than stored, so this state only ever
  // changes in answer to the browser.
  const [result, setResult] = useState<"held" | "denied" | null>(null);

  useEffect(() => {
    if (!active || !supported) return;

    // Set when this effect has been torn down, so a request that resolves after
    // the mic went off releases rather than holding the screen on for nothing.
    let cancelled = false;
    let sentinel: WakeLockSentinel | null = null;

    const acquire = async () => {
      if (cancelled || sentinel || document.visibilityState !== "visible") return;
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void lock.release().catch(() => undefined);
          return;
        }
        sentinel = lock;
        lock.addEventListener("release", () => {
          if (sentinel === lock) sentinel = null;
          // A hidden tab always loses the lock, and gets it back from the
          // visibilitychange below, so that is not worth reporting. Losing it
          // while the screen is being looked at is.
          if (!cancelled && document.visibilityState === "visible") setResult("denied");
        });
        setResult("held");
      } catch {
        // NotAllowedError: refused, or the screen is already locked.
        if (!cancelled) setResult("denied");
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const lock = sentinel;
      sentinel = null;
      if (lock) void lock.release().catch(() => undefined);
    };
  }, [active, supported]);

  if (!active) return "off";
  if (!supported) return "unsupported";
  // Null for the moment between the mic opening and the browser answering.
  return result ?? "off";
}
