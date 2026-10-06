import { buildListenUrl, type DeepgramResults } from "./config";

// Deepgram closes a socket that receives no audio and no KeepAlive for 10 s
// (NET-0001) and recommends a KeepAlive text frame every 3-5 s.
// https://developers.deepgram.com/docs/audio-keep-alive
const KEEPALIVE_INTERVAL_MS = 4000;
const KEEPALIVE_MESSAGE = JSON.stringify({ type: "KeepAlive" });
const CLOSE_STREAM_MESSAGE = JSON.stringify({ type: "CloseStream" });

// Retry fast first, then back off. Capped low: during a broadcast the next
// retry is never more than a few seconds away.
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 3000, 5000];

// A socket can look open after the network silently dropped. While audio is
// flowing Deepgram sends Results about once a second even in silence (measured),
// so this long without any message means the connection is dead.
const STALL_TIMEOUT_MS = 8000;

const TOKEN_ENDPOINT = "/api/deepgram/token";
// Token errors that retrying cannot fix: the key itself has to change.
const FATAL_TOKEN_CODES = new Set(["missing_key", "invalid_key", "forbidden"]);

// Unique per socket, across sessions. Deepgram's word timestamps restart at zero
// on every connection, so results are only comparable within one id.
let nextConnectionId = 1;

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting" }
  | { status: "open" }
  | { status: "reconnecting"; attempt: number; reason: string }
  | { status: "failed"; reason: string };

export interface DeepgramStreamOptions {
  sampleRate: number;
  keyterms: string[];
  /** Called synchronously from the socket's message handler. Keep it fast. */
  onResults: (results: DeepgramResults, receivedAt: number, connectionId: number) => void;
  onState: (state: ConnectionState) => void;
}

class FatalTokenError extends Error {}

async function fetchToken(): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, { method: "POST", cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as {
    accessToken?: string;
    code?: string;
    error?: string;
  };
  if (res.ok && body.accessToken) return body.accessToken;
  const message = body.error ?? `Token request failed (HTTP ${res.status})`;
  throw body.code && FATAL_TOKEN_CODES.has(body.code) ? new FatalTokenError(message) : new Error(message);
}

function describeClose(event: CloseEvent): string {
  if (event.code === 1006) return "Connection lost";
  return `Closed by Deepgram (code ${event.code}${event.reason ? `: ${event.reason}` : ""})`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One live transcription session: a websocket straight to Deepgram, kept alive
 * and reconnected until stop(). Single use: create a new instance per session.
 */
export class DeepgramStream {
  private readonly options: DeepgramStreamOptions;
  private readonly url: string;
  private socket: WebSocket | null = null;
  private connecting = false;
  private stopped = false;
  private attempt = 0;
  private lastMessageAt = 0;
  private lastAudioAt = 0;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private stallTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: DeepgramStreamOptions) {
    this.options = options;
    this.url = buildListenUrl(options.sampleRate, options.keyterms);
  }

  start() {
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("online", this.handleOnline);
    this.options.onState({ status: "connecting" });
    void this.connect();
  }

  /**
   * Sends one PCM chunk if the socket is open. Otherwise the chunk is dropped:
   * audio is never queued or retained, even across a reconnect.
   */
  sendAudio(chunk: ArrayBuffer) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(chunk);
    this.lastAudioAt = performance.now();
  }

  stop() {
    this.stopped = true;
    this.removeListeners();
    clearTimeout(this.retryTimer);
    const socket = this.detach();
    if (socket?.readyState === WebSocket.OPEN) socket.send(CLOSE_STREAM_MESSAGE);
    socket?.close(1000);
    this.options.onState({ status: "idle" });
  }

  private async connect() {
    if (this.stopped || this.connecting || this.socket) return;
    this.connecting = true;

    let token: string;
    try {
      token = await fetchToken();
    } catch (err) {
      this.connecting = false;
      if (this.stopped) return;
      if (err instanceof FatalTokenError) this.fail(err.message);
      else this.scheduleReconnect(`Token request failed: ${errorMessage(err)}`);
      return;
    }
    this.connecting = false;
    if (this.stopped) return;

    let socket: WebSocket;
    try {
      // Browsers cannot put an Authorization header on a WebSocket, so the
      // token travels in the Sec-WebSocket-Protocol header as ["bearer", jwt].
      socket = new WebSocket(this.url, ["bearer", token]);
    } catch (err) {
      this.scheduleReconnect(`Could not open socket: ${errorMessage(err)}`);
      return;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    const connectionId = nextConnectionId++;

    socket.onopen = () => {
      this.lastMessageAt = performance.now();
      this.keepAliveTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(KEEPALIVE_MESSAGE);
      }, KEEPALIVE_INTERVAL_MS);
      this.stallTimer = setInterval(this.checkStall, 1000);
      this.options.onState({ status: "open" });
    };

    socket.onmessage = (event: MessageEvent) => {
      const receivedAt = performance.now();
      this.lastMessageAt = receivedAt;
      // Reset backoff only once Deepgram is actually responding, so a socket
      // that opens and immediately closes cannot cause a tight retry loop.
      this.attempt = 0;
      if (typeof event.data !== "string") return;
      let message: { type?: string };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "Results") {
        this.options.onResults(message as DeepgramResults, receivedAt, connectionId);
      }
    };

    // onerror is always followed by onclose, which owns recovery.
    socket.onclose = (event) => {
      this.detach();
      this.scheduleReconnect(describeClose(event));
    };
  }

  private checkStall = () => {
    const now = performance.now();
    const audioFlowing = now - this.lastAudioAt < 1000;
    if (audioFlowing && now - this.lastMessageAt > STALL_TIMEOUT_MS) {
      this.detach()?.close();
      this.scheduleReconnect(`No response from Deepgram for ${STALL_TIMEOUT_MS / 1000} s`);
    }
  };

  private handleOffline = () => {
    const socket = this.detach();
    if (!socket) return;
    socket.close();
    this.scheduleReconnect("Network offline");
  };

  private handleOnline = () => {
    if (this.stopped || this.socket || this.connecting) return;
    clearTimeout(this.retryTimer);
    void this.connect();
  };

  private scheduleReconnect(reason: string) {
    if (this.stopped) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt++;
    this.options.onState({ status: "reconnecting", attempt: this.attempt, reason });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private fail(reason: string) {
    this.stopped = true;
    this.removeListeners();
    clearTimeout(this.retryTimer);
    this.detach()?.close();
    this.options.onState({ status: "failed", reason });
  }

  /** Stops timers and silences the current socket's handlers. Returns it for closing. */
  private detach(): WebSocket | null {
    clearInterval(this.keepAliveTimer);
    clearInterval(this.stallTimer);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
    }
    return socket;
  }

  private removeListeners() {
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
  }
}
