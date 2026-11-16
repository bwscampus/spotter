import { randomUUID } from "node:crypto";
import pg from "pg";
import type { BoothMessage, BoothSlot, MemberState } from "@/lib/booth/wire";
import { sslFor } from "@/scripts/ssl.mjs";

// =============================================================================
// Booth partners (Nov 15): the live relay between the laptops in one booth.
//
// Each laptop holds one server-sent events connection open
// (app/api/booth/[gameId]/events) and posts what its own engine did
// (app/api/booth/[gameId]/cards). A post is delivered at once to every
// connection this process holds for that game, and sent with pg_notify for
// any other process (Railway's deploy overlap runs the old and the new server
// side by side for a moment; a second replica later would need nothing new).
// One connection per process, its own and never one of the pool's, both
// LISTENs and NOTIFYs, and skips what it sent itself.
//
// PRIVACY: nothing here is stored. A NOTIFY payload is held by Postgres only
// until every listener has it, and carries roster player ids, never a name.
// If LISTEN is down the relay still works inside this process, which on one
// replica is every laptop.
// =============================================================================

const CHANNEL = "booth";
/** This process, so its own notifications are not delivered twice. */
const INSTANCE = randomUUID();
/** Waits before the LISTEN connection is tried again. */
const LISTEN_RETRY_MS = [1_000, 5_000, 15_000, 60_000];

type Send = (message: BoothMessage) => void;
interface Subscriber {
  slot: BoothSlot;
  send: Send;
}

/** Every open connection in this process, by game. */
const games = new Map<string, Set<Subscriber>>();

/** Where a message goes: everyone, one slot, or everyone but one. */
export interface Route {
  to?: BoothSlot;
  except?: BoothSlot;
}

function deliver(gameId: string, message: BoothMessage, route: Route): void {
  const subscribers = games.get(gameId);
  if (!subscribers) return;
  for (const subscriber of subscribers) {
    if (route.to !== undefined && subscriber.slot !== route.to) continue;
    if (route.except !== undefined && subscriber.slot === route.except) continue;
    try {
      subscriber.send(message);
    } catch {
      // A connection that just closed; its own cleanup takes it out.
    }
  }
}

/** Who has the connection open in this process. */
export function membersOnline(gameId: string, slots: readonly BoothSlot[]): MemberState[] {
  const online = new Set([...(games.get(gameId) ?? [])].map((subscriber) => subscriber.slot));
  return slots.map((slot) => ({ slot, online: online.has(slot) }));
}

/** Sends a message to the booth, here and in every other process. Never throws. */
export function publish(gameId: string, message: BoothMessage, route: Route = {}): void {
  deliver(gameId, message, route);
  // Only on the relay's own connection, once it is listening: a notify must
  // never hold one of the five pooled connections the rest of the app needs.
  if (!listener || !ready) return;
  const payload = JSON.stringify({ i: INSTANCE, g: gameId, m: message, r: route });
  // Postgres refuses a payload of 8000 bytes or more; a booth message is a few hundred.
  if (payload.length >= 7900) return;
  listener.query("select pg_notify($1, $2)", [CHANNEL, payload]).catch(() => {
    // The other processes miss this one; this process already has it.
  });
}

/** Opens a laptop's place in the booth. Returns how to leave it. */
export function subscribe(gameId: string, slot: BoothSlot, send: Send): () => void {
  ensureListening();
  const subscriber: Subscriber = { slot, send };
  let set = games.get(gameId);
  if (!set) games.set(gameId, (set = new Set()));
  set.add(subscriber);
  return () => {
    const current = games.get(gameId);
    if (!current) return;
    current.delete(subscriber);
    if (current.size === 0) games.delete(gameId);
  };
}

// -----------------------------------------------------------------------------
// One LISTEN connection per process, opened the first time a laptop connects.
// -----------------------------------------------------------------------------

let listener: pg.Client | null = null;
let listening = false;
/** The connection is open and listening, so it can notify too. */
let ready = false;
let failures = 0;

function ensureListening(): void {
  if (listener || listening) return;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  listening = true;
  const client = new pg.Client({ connectionString, ssl: sslFor(connectionString) });
  listener = client;
  const retry = () => {
    if (listener !== client) return;
    listener = null;
    listening = false;
    ready = false;
    client.removeAllListeners();
    client.end().catch(() => {});
    const wait = LISTEN_RETRY_MS[Math.min(failures, LISTEN_RETRY_MS.length - 1)];
    failures += 1;
    // Only while some laptop is connected; the next subscribe opens it otherwise.
    setTimeout(() => {
      if (games.size > 0) ensureListening();
    }, wait).unref();
  };
  client.on("error", retry);
  client.on("end", retry);
  client.on("notification", (note) => {
    if (note.channel !== CHANNEL || !note.payload) return;
    try {
      const { i, g, m, r } = JSON.parse(note.payload) as { i: string; g: string; m: BoothMessage; r: Route };
      if (i === INSTANCE || typeof g !== "string") return;
      deliver(g, m, r ?? {});
    } catch {
      // Not one of ours.
    }
  });
  client
    .connect()
    .then(() => client.query(`listen ${CHANNEL}`))
    .then(() => {
      if (listener !== client) return;
      failures = 0;
      ready = true;
    })
    .catch(retry);
}

/** Test hook: forget every connection, and close the relay's own. */
export async function resetBoothBus(): Promise<void> {
  games.clear();
  const client = listener;
  listener = null;
  listening = false;
  ready = false;
  if (client) {
    client.removeAllListeners();
    await client.end().catch(() => {});
  }
}
