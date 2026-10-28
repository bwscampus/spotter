// =============================================================================
// How often the team panel redraws (Jed, Oct 28: "throttled to at most once
// every 500ms"). Live stats can change several times a second as a read lands
// and its plays count; the panel takes the first change at once and folds the
// rest into one more redraw at the end of the window. The clock and timers
// are handed in, so the rule is tested with fake ones.
// =============================================================================

/** At most one redraw this often. */
export const PANEL_THROTTLE_MS = 500;

export interface Timers {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Throttle {
  /** Something changed: run now, or once at the end of the current window. */
  poke(): void;
  /** No more runs. */
  cancel(): void;
}

/** Runs `run` at most once every `waitMs`: the first poke at once, any during the wait once when it ends. */
export function createThrottle(run: () => void, waitMs: number, timers: Timers): Throttle {
  let lastRun = Number.NEGATIVE_INFINITY;
  let pending: unknown = null;
  let cancelled = false;

  const fire = () => {
    pending = null;
    if (cancelled) return;
    lastRun = timers.now();
    run();
  };

  return {
    poke() {
      if (cancelled || pending !== null) return;
      const wait = lastRun + waitMs - timers.now();
      if (wait <= 0) fire();
      else pending = timers.setTimeout(fire, wait);
    },
    cancel() {
      cancelled = true;
      if (pending !== null) timers.clearTimeout(pending);
      pending = null;
    },
  };
}
