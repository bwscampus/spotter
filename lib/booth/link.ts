import type { BoothBridge, BoothState } from "@/lib/game/boothBridge";
import { readBoothMessage, type BoothMessage, type BoothPost } from "./wire";

// =============================================================================
// Booth partners (Nov 15): this laptop's live connection to its booth.
//
// One EventSource down (app/api/booth/[gameId]/events) and a fetch up for each
// card event (app/api/booth/[gameId]/cards). It never touches a card: what it
// hears goes to the live screen's handler, which places it the way it places
// its own engine's. A dropped connection only means the partners' cards stop
// arriving; this laptop's own mic keeps putting cards up at once, and the
// connection comes back on its own. Nothing missed while it was down is
// replayed, so a stale card never pops up after a reconnect.
//
// Never imported by the card path (test/cardPathIsolation.test.ts): the live
// page's composition root builds it and hands LiveScreen the bridge.
// =============================================================================

/** Waits before trying again after the connection drops, then the last one over and over. */
export const RECONNECT_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/** The browser pieces this needs, so a test can run it without one. */
export interface LinkDeps {
  open(url: string): EventSourceLike;
  post(url: string, body: string): Promise<void>;
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

export interface EventSourceLike {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

const browserDeps: LinkDeps = {
  open: (url) => new EventSource(url) as unknown as EventSourceLike,
  post: async (url, body) => {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
  },
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class BoothLink implements BoothBridge {
  readonly role: "host" | "guest";
  readonly gameId: string;
  private readonly deps: LinkDeps;
  private source: EventSourceLike | null = null;
  private timer: unknown = null;
  private failures = 0;
  private stopped = false;
  /** The game ended or this laptop is out of the booth: never opened again. */
  private over = false;
  private current: BoothState = { status: "connecting", you: null, members: [] };
  private readonly handlers = new Set<(message: BoothMessage) => void>();
  private readonly watchers = new Set<() => void>();

  constructor(gameId: string, role: "host" | "guest", deps: LinkDeps = browserDeps) {
    this.gameId = gameId;
    this.role = role;
    this.deps = deps;
  }

  /** Opens the connection. Safe to call again after stop(), unless the booth is over. */
  start(): void {
    if (this.source || this.over) return;
    this.stopped = false;
    const source = this.deps.open(`/api/booth/${encodeURIComponent(this.gameId)}/events`);
    this.source = source;
    source.onopen = () => {
      this.failures = 0;
    };
    source.onmessage = (event) => {
      const message = readBoothMessage(event.data);
      if (!message) return;
      if (message.type === "hello") this.update({ status: "open", you: message.you, members: message.members });
      else if (message.type === "members") this.update({ ...this.current, members: message.members });
      for (const handler of this.handlers) {
        try {
          handler(message);
        } catch {
          // One handler's mistake never stops the others hearing.
        }
      }
      // Nothing more will come: the game is over here, or this laptop is out of the booth.
      if (message.type === "ended" || message.type === "removed") {
        this.over = true;
        this.stop();
      }
    };
    source.onerror = () => {
      // The browser would retry on its own, but not after a 404 or a 401, and
      // with no backoff: this laptop decides when to try again.
      source.close();
      if (this.source !== source) return;
      this.source = null;
      if (this.stopped) return;
      this.update({ ...this.current, status: "reconnecting" });
      const wait = RECONNECT_MS[Math.min(this.failures, RECONNECT_MS.length - 1)];
      this.failures += 1;
      this.timer = this.deps.setTimer(() => {
        this.timer = null;
        this.start();
      }, wait);
    };
  }

  /** Closes it: the game ended, this laptop left, or the screen went away. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
    this.update({ ...this.current, status: "closed" });
  }

  send(post: BoothPost): void {
    // Only while connected: a card event nobody will hear in time is not worth sending later.
    if (this.current.status !== "open") return;
    this.deps.post(`/api/booth/${encodeURIComponent(this.gameId)}/cards`, JSON.stringify(post)).catch(() => {
      // Lost: the partner's screen just misses this card. Ours already has it.
    });
  }

  listen(handler: (message: BoothMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  state(): BoothState {
    return this.current;
  }

  subscribe(onChange: () => void): () => void {
    this.watchers.add(onChange);
    return () => this.watchers.delete(onChange);
  }

  private update(next: BoothState): void {
    this.current = next;
    for (const watcher of this.watchers) watcher();
  }
}
