// =============================================================================
// Analytics in the browser: queue in memory, send in batches after paint.
//
// track() does no I/O. It filters the props, pushes one object onto an array,
// and at most arms a timer, so it is cheap anywhere. It still never belongs in
// handleResults or SpotterEngine.process: call it after paint (lib/afterPaint
// once the live screen exists), the same as every other side effect there.
//
// A batch leaves BATCH_DELAY_MS after the first event queued, when the browser
// is next idle, or straight away when the tab is hidden or closed, so leaving a
// page does not lose what it recorded. A batch that fails is dropped: nothing
// Spotter does waits on or retries analytics.
//
// Nothing is sent from localhost. The server stamps env from its own
// VERCEL_ENV and owner_id from the session, so neither is sent from here.
// =============================================================================

import {
  appVersionOrUnknown,
  isUuid,
  sanitizeProps,
  type EventName,
  type EventProps,
  type WireBatch,
  type WireEvent,
} from "./events";
import { isLocalHost } from "./localHost";

// =============================================================================
// TUNING: how events leave the browser.
// =============================================================================

/** How long the first event waits for company before its batch goes. */
export const BATCH_DELAY_MS = 5000;

/** Events per request. Small enough that a keepalive request stays under 64 KB. */
export const MAX_BATCH_SIZE = 25;

/** Past this many unsent events, new ones are dropped rather than piling up. */
export const MAX_QUEUE = 200;

/** How long an idle callback may wait before it runs anyway. */
const IDLE_TIMEOUT_MS = 2000;

// =============================================================================

const ENDPOINT = "/api/events";
const SESSION_KEY = "spotter.v3.session";

/** What the queue needs from the outside world. The browser's are below; tests pass fakes. */
export type QueueDeps = {
  /** Sends one batch. Must not throw. keepalive is set when the page is going away. */
  send: (batch: WireBatch, options: { keepalive: boolean }) => void;
  /** Runs fn after ms. */
  delay: (fn: () => void, ms: number) => void;
  /** Runs fn when the browser is idle. */
  idle: (fn: () => void) => void;
  now: () => Date;
  sessionId: () => string;
  appVersion: string;
  /** True on a development machine: every event is dropped. */
  isLocal: () => boolean;
};

export type EventQueue = {
  track: (name: EventName, props?: EventProps) => void;
  /** Sends everything queued now. keepalive when the page is being hidden or closed. */
  flush: (options?: { keepalive?: boolean }) => void;
  setGameId: (id: string | null) => void;
  pending: () => number;
};

export function createEventQueue(deps: QueueDeps): EventQueue {
  const queue: WireEvent[] = [];
  let gameId: string | null = null;
  let armed = false;

  function arm() {
    if (armed) return;
    armed = true;
    deps.delay(() => deps.idle(() => flush()), BATCH_DELAY_MS);
  }

  function flush(options: { keepalive?: boolean } = {}) {
    armed = false;
    while (queue.length > 0) {
      const events = queue.splice(0, MAX_BATCH_SIZE);
      deps.send(
        { session_id: deps.sessionId(), app_version: deps.appVersion, events },
        { keepalive: options.keepalive === true },
      );
    }
  }

  return {
    track(name, props = {}) {
      if (deps.isLocal()) return;
      if (queue.length >= MAX_QUEUE) return;
      queue.push({
        name,
        at: deps.now().toISOString(),
        game_id: gameId,
        props: sanitizeProps(name, props, warnDropped),
      });
      arm();
    },
    flush,
    setGameId(id) {
      gameId = isUuid(id) ? id : null;
    },
    pending: () => queue.length,
  };
}

// -----------------------------------------------------------------------------
// The browser's queue, made on first use so importing this file on the server
// (or in a test) touches no window.
// -----------------------------------------------------------------------------

let browserQueue: EventQueue | null = null;

function queueForBrowser(): EventQueue | null {
  if (typeof window === "undefined") return null;
  if (browserQueue) return browserQueue;

  browserQueue = createEventQueue({
    send: sendWithFetch,
    delay: (fn, ms) => void window.setTimeout(fn, ms),
    idle: (fn) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(() => fn(), { timeout: IDLE_TIMEOUT_MS });
      } else {
        window.setTimeout(fn, 0);
      }
    },
    now: () => new Date(),
    sessionId: tabSessionId,
    appVersion: appVersionOrUnknown(process.env.NEXT_PUBLIC_GIT_COMMIT),
    isLocal: () => isLocalHost(window.location.hostname),
  });

  // A hidden tab may never come back, and a closed one certainly will not.
  const leave = () => browserQueue?.flush({ keepalive: true });
  window.addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
  });

  return browserQueue;
}

/** Records one event. Safe anywhere in the browser; a no-op on the server. */
export function track(name: EventName, props?: EventProps): void {
  queueForBrowser()?.track(name, props);
}

/** Tags every event recorded from now on with this game, or with none. */
export function setGameId(id: string | null): void {
  queueForBrowser()?.setGameId(id);
}

function sendWithFetch(batch: WireBatch, { keepalive }: { keepalive: boolean }) {
  if (batch.events.length === 0) return;
  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
      credentials: "same-origin",
      keepalive,
    }).catch(() => {
      // Analytics must never interrupt an announcer.
    });
  } catch {
    // Same.
  }
}

/**
 * One id per browser tab, so a sitting reads as a sequence: signed in,
 * imported, saved, called a game. sessionStorage is per tab and survives a
 * reload, which is the boundary wanted.
 */
function tabSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (isUuid(existing)) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // Storage blocked: events still record, they just do not group.
    return (fallbackSessionId ??= crypto.randomUUID());
  }
}
let fallbackSessionId: string | undefined;

/** Tells a developer a prop was dropped: the event's key and why, never the value. */
function warnDropped({ key, reason }: { key: string; reason: string }) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[Spotter] analytics prop "${key}" dropped (${reason}). See lib/analytics/events.ts.`);
  }
}
