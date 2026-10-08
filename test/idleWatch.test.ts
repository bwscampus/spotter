import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_QUIET_MS, IDLE_WORDS, IdleWatch, MAX_LISTEN_MS, SAME_STRETCH_MS, type IdleInput, type IdleStop } from "@/lib/game/idleWatch";

// =============================================================================
// The idle stop (pre-launch audit H4): a live screen left open stops listening
// after 20 minutes with no words or 5 hours since Listen. Driven with fake
// timers the way the live screen drives it, once a second.
// =============================================================================

const START = 1_800_000_000_000;
const MINUTE = 60_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

/** Runs the watch once a minute for `minutes`, the first update at once; returns the first stop and the minute it came. */
function runMinutes(watch: IdleWatch, minutes: number, describe: (now: number, minute: number) => IdleInput) {
  for (let minute = 0; minute <= minutes; minute++) {
    if (minute > 0) vi.advanceTimersByTime(MINUTE);
    const now = Date.now();
    const stop = watch.update(describe(now, minute), now);
    if (stop) return { minute, stop };
  }
  return null;
}

describe("the idle stop", () => {
  it("stops after 20 minutes with no words, counted from Listen", () => {
    const found = runMinutes(new IdleWatch(), 30, () => ({ listening: true, lastWordsAt: null }));
    expect(found).toEqual({ minute: IDLE_QUIET_MS / MINUTE, stop: { reason: "quiet", ms: IDLE_QUIET_MS } });
  });

  it("counts the quiet from the last words", () => {
    // Words every minute for the first ten, then nothing.
    const found = runMinutes(new IdleWatch(), 40, (now, minute) => ({
      listening: true,
      lastWordsAt: minute <= 10 ? now : START + 10 * MINUTE,
    }));
    expect(found?.minute).toBe(10 + IDLE_QUIET_MS / MINUTE);
    expect(found?.stop.reason).toBe("quiet");
  });

  it("does not count words from before this Listen as recent", () => {
    // The last words were an hour before Listen: the 20 minutes start at Listen.
    const found = runMinutes(new IdleWatch(), 30, () => ({ listening: true, lastWordsAt: START - 60 * MINUTE }));
    expect(found?.minute).toBe(IDLE_QUIET_MS / MINUTE);
  });

  it("never stops a booth that keeps talking, until five hours", () => {
    const found = runMinutes(new IdleWatch(), 6 * 60, (now) => ({ listening: true, lastWordsAt: now }));
    expect(found).toEqual({ minute: MAX_LISTEN_MS / MINUTE, stop: { reason: "too_long", ms: MAX_LISTEN_MS } });
  });

  it("says nothing while the mic is off", () => {
    expect(runMinutes(new IdleWatch(), 6 * 60, () => ({ listening: false, lastWordsAt: null }))).toBeNull();
  });

  it("stops once, then starts both clocks again on the next Listen", () => {
    const watch = new IdleWatch();
    const first = runMinutes(watch, 30, () => ({ listening: true, lastWordsAt: null }));
    expect(first?.minute).toBe(20);
    // The screen turns the mic off; a minute later the announcer presses Listen.
    vi.advanceTimersByTime(MINUTE);
    expect(watch.update({ listening: false, lastWordsAt: null }, Date.now())).toBeNull();
    const second = runMinutes(watch, 30, () => ({ listening: true, lastWordsAt: null }));
    expect(second?.minute).toBe(20);
  });

  it("keeps the same stretch through the silence alarm's quick mic restart", () => {
    const watch = new IdleWatch();
    const stops: Array<IdleStop | null> = [];
    // Ten minutes of listening, a five second restart, then listening again.
    for (let second = 0; second <= 30 * 60; second++) {
      if (second > 0) vi.advanceTimersByTime(1000);
      const restarting = second >= 600 && second < 605;
      stops.push(watch.update({ listening: !restarting, lastWordsAt: null }, Date.now()));
    }
    // Still twenty minutes from the first Listen, not from the restart.
    expect(stops.findIndex((stop) => stop !== null)).toBe(IDLE_QUIET_MS / 1000);
    expect(SAME_STRETCH_MS).toBeGreaterThan(5_000);
  });

  it("a stop longer than the grace is a new stretch", () => {
    const watch = new IdleWatch();
    runMinutes(watch, 10, () => ({ listening: true, lastWordsAt: null }));
    vi.advanceTimersByTime(SAME_STRETCH_MS + 1_000);
    watch.update({ listening: false, lastWordsAt: null }, Date.now() - SAME_STRETCH_MS - 1_000);
    expect(watch.update({ listening: false, lastWordsAt: null }, Date.now())).toBeNull();
    const again = runMinutes(watch, 30, () => ({ listening: true, lastWordsAt: null }));
    expect(again?.minute).toBe(20);
  });

  it("says why in plain words", () => {
    expect(IDLE_WORDS.quiet).toBe("Listening stopped after 20 minutes of quiet. Press Listen to carry on.");
    expect(IDLE_WORDS.too_long).toBe("Listening stopped after 5 hours. Press Listen to carry on.");
  });
});
