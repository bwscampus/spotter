import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeepgramStream, type ConnectionState } from "@/lib/deepgram/DeepgramStream";

// =============================================================================
// The socket's two small additions for the silence alarm (Part 6, Oct 4):
// reconnect() drops the socket and opens a new one with a fresh token, and a
// close carries its code on the reconnecting state. A fake socket and a fake
// token route; no network.
// =============================================================================

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  sent: unknown[] = [];
  closedWith: Array<number | undefined> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    FakeSocket.instances.push(this);
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith.push(code);
    this.readyState = FakeSocket.CLOSED;
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

let tokens = 0;
const states: ConnectionState[] = [];
let stream: DeepgramStream;

beforeEach(() => {
  tokens = 0;
  states.length = 0;
  FakeSocket.instances.length = 0;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ accessToken: `token-${++tokens}` }) })),
  );
  stream = new DeepgramStream({ sampleRate: 16000, keyterms: [], onResults: () => undefined, onState: (state) => states.push(state) });
});

afterEach(() => {
  stream.stop();
  vi.unstubAllGlobals();
});

const socketCount = (count: number) => vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(count));

describe("DeepgramStream", () => {
  it("opens a socket with the token the route gave it", async () => {
    stream.start();
    await socketCount(1);
    expect(FakeSocket.instances[0].protocols).toEqual(["bearer", "token-1"]);
    FakeSocket.instances[0].open();
    expect(states.at(-1)).toEqual({ status: "open" });
  });

  it("reconnect() drops the socket and opens a new one with a fresh token, at once", async () => {
    stream.start();
    await socketCount(1);
    const first = FakeSocket.instances[0];
    first.open();

    stream.reconnect("Not hearing you");
    expect(first.closedWith).toHaveLength(1);
    expect(states.at(-1)).toEqual({ status: "reconnecting", attempt: 0, reason: "Not hearing you" });
    await socketCount(2);
    expect(FakeSocket.instances[1].protocols).toEqual(["bearer", "token-2"]);
    FakeSocket.instances[1].open();
    expect(states.at(-1)).toEqual({ status: "open" });
    // The old socket's handlers are gone: a late close on it changes nothing.
    first.onclose?.({ code: 1006, reason: "" });
    expect(states.at(-1)).toEqual({ status: "open" });
  });

  it("carries the close code when a close is what started the reconnect", async () => {
    stream.start();
    await socketCount(1);
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.onclose?.({ code: 1006, reason: "" });
    expect(states.at(-1)).toEqual({ status: "reconnecting", attempt: 1, reason: "Connection lost", code: 1006 });
    socket.onclose?.({ code: 1011, reason: "server error" });
  });

  it("gives up on a token request that never answers after 8 s, and retries (audit M7)", async () => {
    vi.useFakeTimers();
    try {
      // AbortSignal.timeout runs on Node's own timers; this one runs on the fake clock.
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
        return controller.signal;
      });
      const hung = vi.fn(
        (_url: string, init: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      );
      const answered = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ accessToken: `token-${++tokens}` }) }));
      vi.stubGlobal("fetch", vi.fn((url: string, init: { signal?: AbortSignal }) => (hung.mock.calls.length === 0 ? hung(url, init) : answered())));

      stream.start();
      expect(hung).toHaveBeenCalledTimes(1);
      // While the request hangs, a reconnect cannot start another one.
      stream.reconnect("Not hearing you");
      await vi.advanceTimersByTimeAsync(7_900);
      expect(FakeSocket.instances).toHaveLength(0);
      expect(answered).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);
      expect(states.at(-1)).toMatchObject({ status: "reconnecting", attempt: 1 });
      expect(states.at(-1)).toMatchObject({ reason: expect.stringContaining("Token request failed") });

      // The first retry waits a quarter of a second, then gets a token and a socket.
      await vi.advanceTimersByTimeAsync(250);
      expect(answered).toHaveBeenCalledTimes(1);
      expect(FakeSocket.instances).toHaveLength(1);
      expect(FakeSocket.instances[0].protocols).toEqual(["bearer", "token-1"]);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("does nothing after stop()", async () => {
    stream.start();
    await socketCount(1);
    stream.stop();
    expect(states.at(-1)).toEqual({ status: "idle" });
    stream.reconnect("too late");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(FakeSocket.instances).toHaveLength(1);
    expect(tokens).toBe(1);
  });
});
