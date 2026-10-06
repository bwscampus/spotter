import type { LogRecord, StoredRecord } from "./records";

// =============================================================================
// The browser log, in IndexedDB, one game at a time.
//
// PRIVACY: never leaves this browser except by the announcer's own Download.
// No console line here ever echoes a record; errors name their kind only.
//
// NEVER ON THE HOT PATH. The live screen pushes records from inside afterPaint,
// and push itself only appends to an array: the IndexedDB transaction happens
// later, on a timer, in one batch. test/cardPathIsolation.test.ts holds
// handleResults to that.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** How long records wait in memory before they go to IndexedDB in one transaction. */
export const FLUSH_DELAY_MS = 2000;

/** A buffer this long goes straight away rather than waiting out the timer. */
export const FLUSH_AT_RECORDS = 500;

// =============================================================================

const DB_NAME = "spotter-v3-log";
const DB_VERSION = 1;
const STORE = "records";
const BY_GAME = "gameId";

/** Where a batch goes. IndexedDB in the browser; tests pass a fake. */
export interface LogSink {
  put(records: LogRecord[]): Promise<void>;
}

export interface LogWriter {
  /** Queues one record. Does no I/O. Call it after paint. */
  push(record: LogRecord): void;
  /** Sends everything queued now, and resolves once it is stored. */
  flush(): Promise<void>;
  pending(): number;
}

export interface WriterDeps {
  delay: (fn: () => void, ms: number) => unknown;
}

export function createLogWriter(sink: LogSink, deps: WriterDeps): LogWriter {
  let buffer: LogRecord[] = [];
  let armed = false;
  // Batches go one after another, so the log keeps the order things happened in.
  let chain: Promise<void> = Promise.resolve();

  function flush(): Promise<void> {
    armed = false;
    if (buffer.length > 0) {
      const batch = buffer;
      buffer = [];
      chain = chain.then(() =>
        sink.put(batch).catch((err: unknown) => {
          // The records are gone, and the game goes on. Their kind, never their content.
          console.warn(`[Spotter] Could not write the browser log (${err instanceof Error ? err.name : "unknown"}).`);
        }),
      );
    }
    return chain;
  }

  return {
    push(record) {
      buffer.push(record);
      if (buffer.length >= FLUSH_AT_RECORDS) {
        void flush();
        return;
      }
      if (!armed) {
        armed = true;
        deps.delay(() => void flush(), FLUSH_DELAY_MS);
      }
    },
    flush,
    pending: () => buffer.length,
  };
}

// -----------------------------------------------------------------------------
// IndexedDB. One store, keyed by an increasing sequence, indexed by game.
// -----------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true });
        store.createIndex(BY_GAME, "gameId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
  // A failed open is tried again next time rather than remembered forever.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("aborted"));
  });
}

const indexedDbSink: LogSink = {
  async put(records) {
    const db = await openDb();
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const record of records) store.add(record);
    await done(transaction);
  },
};

/** Every record kept for this game, in the order it was written. */
export async function readGameLog(gameId: string): Promise<StoredRecord[]> {
  const db = await openDb();
  const transaction = db.transaction(STORE, "readonly");
  const request = transaction.objectStore(STORE).index(BY_GAME).getAll(IDBKeyRange.only(gameId));
  await done(transaction);
  return request.result as StoredRecord[];
}

/** How many records this browser holds for the game. Zero means there is no log to download. */
export async function countGameLog(gameId: string): Promise<number> {
  const db = await openDb();
  const transaction = db.transaction(STORE, "readonly");
  const request = transaction.objectStore(STORE).index(BY_GAME).count(IDBKeyRange.only(gameId));
  await done(transaction);
  return request.result;
}

/** Deletes this game's log, and only this game's. */
export async function clearGameLog(gameId: string): Promise<void> {
  const db = await openDb();
  const transaction = db.transaction(STORE, "readwrite");
  const index = transaction.objectStore(STORE).index(BY_GAME);
  const request = index.openKeyCursor(IDBKeyRange.only(gameId));
  const store = transaction.objectStore(STORE);
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    store.delete(cursor.primaryKey);
    cursor.continue();
  };
  await done(transaction);
}

// -----------------------------------------------------------------------------
// The browser's one writer, made on first use so importing this file on the
// server touches no window.
// -----------------------------------------------------------------------------

let browserWriter: LogWriter | null = null;

export function logWriter(): LogWriter {
  if (browserWriter) return browserWriter;
  browserWriter = createLogWriter(indexedDbSink, { delay: (fn, ms) => window.setTimeout(fn, ms) });
  // A hidden tab may never come back. IndexedDB usually finishes a transaction
  // started here; the timer would not get the chance.
  const leave = () => void browserWriter?.flush();
  window.addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
  });
  return browserWriter;
}
