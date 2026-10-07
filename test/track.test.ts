import { describe, expect, it } from "vitest";
import { isNewAccount } from "@/lib/analytics/signUp";
import {
  BATCH_DELAY_MS,
  MAX_BATCH_SIZE,
  MAX_QUEUE,
  createEventQueue,
  type QueueDeps,
} from "@/lib/analytics/track";
import type { WireBatch } from "@/lib/analytics/events";

const SESSION = "0b8f9f5e-7c1d-4f7a-9d3e-2a1b3c4d5e6f";
const GAME = "d6a4c3b2-1e0f-4a9b-8c7d-6e5f4a3b2c1d";

/**
 * A queue wired to a hand-driven clock: timers and idle callbacks only run when
 * the test says so, which is what lets it prove nothing is sent early.
 */
function harness(overrides: Partial<QueueDeps> = {}) {
  const sent: { batch: WireBatch; keepalive: boolean }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const idles: (() => void)[] = [];
  const queue = createEventQueue({
    send: (batch, { keepalive }) => sent.push({ batch, keepalive }),
    delay: (fn, ms) => timers.push({ fn, ms }),
    idle: (fn) => idles.push(fn),
    now: () => new Date("2026-10-02T02:00:00.000Z"),
    sessionId: () => SESSION,
    appVersion: "abc1234",
    isLocal: () => false,
    ...overrides,
  });
  const runTimers = () => timers.splice(0).forEach((t) => t.fn());
  const runIdle = () => idles.splice(0).forEach((fn) => fn());
  return { queue, sent, timers, idles, runTimers, runIdle };
}

describe("the analytics batch queue", () => {
  it("sends nothing when an event is tracked, only after the delay and then when idle", () => {
    const h = harness();
    h.queue.track("account.signed_up", { method: "google" });
    expect(h.sent).toHaveLength(0);
    expect(h.timers).toEqual([{ fn: expect.any(Function), ms: BATCH_DELAY_MS }]);

    h.runTimers();
    expect(h.sent).toHaveLength(0);
    h.runIdle();
    expect(h.sent).toHaveLength(1);
    expect(h.queue.pending()).toBe(0);
  });

  it("puts every event from the window into one batch, tagged with the tab and the build", () => {
    const h = harness();
    h.queue.track("game.mic_started", {});
    h.queue.track("game.mic_stopped", { seconds: 42 });
    h.queue.track("names.card_removed", { cards_on_screen: 3 });
    // One timer for the whole window, not one per event.
    expect(h.timers).toHaveLength(1);
    h.runTimers();
    h.runIdle();

    expect(h.sent).toHaveLength(1);
    const { batch, keepalive } = h.sent[0];
    expect(keepalive).toBe(false);
    expect(batch.session_id).toBe(SESSION);
    expect(batch.app_version).toBe("abc1234");
    expect(batch.events.map((e) => e.name)).toEqual(["game.mic_started", "game.mic_stopped", "names.card_removed"]);
    expect(batch.events[1]).toEqual({
      name: "game.mic_stopped",
      at: "2026-10-02T02:00:00.000Z",
      game_id: null,
      props: { seconds: 42 },
    });
  });

  it("splits a long queue into batches of at most MAX_BATCH_SIZE", () => {
    const h = harness();
    for (let i = 0; i < MAX_BATCH_SIZE * 2 + 3; i++) h.queue.track("game.ended", { i });
    h.runTimers();
    h.runIdle();
    expect(h.sent.map((s) => s.batch.events.length)).toEqual([MAX_BATCH_SIZE, MAX_BATCH_SIZE, 3]);
  });

  it("filters props as they are queued", () => {
    const h = harness();
    h.queue.track("account.signed_up", { method: "email", surname: "Langan" as never });
    h.queue.flush();
    expect(h.sent[0].batch.events[0].props).toEqual({ method: "email" });
  });

  it("drops everything on a development machine", () => {
    const h = harness({ isLocal: () => true });
    h.queue.track("account.signed_up", { method: "google" });
    expect(h.queue.pending()).toBe(0);
    expect(h.timers).toHaveLength(0);
    h.queue.flush();
    expect(h.sent).toHaveLength(0);
  });

  it("sends straight away with keepalive when the page is going away", () => {
    const h = harness();
    h.queue.track("game.mic_stopped", { seconds: 5 });
    h.queue.flush({ keepalive: true });
    expect(h.sent).toEqual([{ batch: expect.any(Object), keepalive: true }]);
    // The timer that was armed finds nothing left to send.
    h.runTimers();
    h.runIdle();
    expect(h.sent).toHaveLength(1);
  });

  it("arms a fresh window after a batch goes", () => {
    const h = harness();
    h.queue.track("game.started", {});
    h.runTimers();
    h.runIdle();
    h.queue.track("game.ended", {});
    expect(h.timers).toHaveLength(1);
  });

  it("tags events with the running game, and stops when the game ends", () => {
    const h = harness();
    h.queue.setGameId(GAME);
    h.queue.track("game.started", {});
    h.queue.setGameId(null);
    h.queue.track("account.signed_up", { method: "email" });
    h.queue.setGameId("not-a-uuid");
    h.queue.track("game.ended", {});
    h.queue.flush();
    expect(h.sent[0].batch.events.map((e) => e.game_id)).toEqual([GAME, null, null]);
  });

  it("stops queueing past MAX_QUEUE rather than piling up", () => {
    const h = harness();
    for (let i = 0; i < MAX_QUEUE + 50; i++) h.queue.track("game.ended", {});
    expect(h.queue.pending()).toBe(MAX_QUEUE);
  });
});

describe("isNewAccount", () => {
  it("is true when the sign-in is the account's creation", () => {
    expect(
      isNewAccount({ created_at: "2026-10-02T02:00:00.000Z", last_sign_in_at: "2026-10-02T02:00:00.412Z" }),
    ).toBe(true);
  });

  it("is false for a returning account", () => {
    expect(
      isNewAccount({ created_at: "2026-09-28T20:00:00.000Z", last_sign_in_at: "2026-10-02T02:00:00.000Z" }),
    ).toBe(false);
  });

  it("is false when Supabase did not say", () => {
    expect(isNewAccount(null)).toBe(false);
    expect(isNewAccount({ created_at: "2026-10-02T02:00:00.000Z" })).toBe(false);
    expect(isNewAccount({ created_at: "garbage", last_sign_in_at: "garbage" })).toBe(false);
  });
});
