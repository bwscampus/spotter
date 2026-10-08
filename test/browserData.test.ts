import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getGameSnapshot,
  isSnapshot,
  ownSnapshot,
  readGameSnapshot,
  stampOwner,
  storedGameId,
  subscribeGameSnapshot,
  writeGameSnapshot,
  type GameSnapshot,
} from "@/lib/game/snapshot";
import { announceViewer, rememberViewer, visibleTo } from "@/lib/game/viewer";
import { keepSince, LOG_KEEP_DAYS, ownRecords, withOwner } from "@/lib/log/gameLog";
import { toReplayFile, type LogRecord, type StoredRecord } from "@/lib/log/records";

// =============================================================================
// Browser data on a shared press-box laptop (pre-launch audit M3): the open
// game and the browser log carry the account that made them, another account
// does not see them, and a game saved before owners were stamped still opens.
// =============================================================================

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const snapshot: GameSnapshot = {
  version: 1,
  builtAt: "2026-09-25T19:00:00.000Z",
  gameId: "5f0c1a52-8d1e-4a57-9d6f-2a8f6e0c9b11",
  recorded: true,
  home: { id: "a", name: "Northfield", wearing: null },
  away: { id: "b", name: "Westmere", wearing: null },
  watchlist: [
    {
      name: "Vexley",
      aliases: [],
      players: [
        {
          jersey: "7",
          first_name: null,
          last_name: "Vexley",
          position: null,
          grade: null,
          height: null,
          weight: null,
          side: "H",
          stat_lines: [],
        },
      ],
    },
  ],
  keyterms: ["Vexley"],
  sport: "football",
  teamCues: [],
  statsEnabled: false,
};

/** A localStorage that lives in a Map, and a window for the storage listener. */
function fakeStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  return map;
}

afterEach(() => {
  vi.unstubAllGlobals();
  rememberViewer(null);
});

describe("who may see what", () => {
  it("lets the owner see their own, and nobody else", () => {
    expect(visibleTo(ALICE, ALICE)).toBe(true);
    expect(visibleTo(ALICE, BOB)).toBe(false);
    expect(visibleTo(ALICE, null)).toBe(false);
  });

  it("lets anyone see what was made before owners were stamped", () => {
    expect(visibleTo(undefined, ALICE)).toBe(true);
    expect(visibleTo(undefined, null)).toBe(true);
  });
});

describe("the open game", () => {
  it("is stamped with the signed-in account when it is written, and keeps an owner it has", () => {
    expect(stampOwner(snapshot, ALICE).owner).toBe(ALICE);
    expect(stampOwner({ ...snapshot, owner: ALICE }, BOB).owner).toBe(ALICE);
    expect(stampOwner(snapshot, null)).toBe(snapshot);
    expect(stampOwner(snapshot, undefined)).toBe(snapshot);
  });

  it("still reads with an owner on it, and refuses a blank one", () => {
    expect(isSnapshot({ ...snapshot, owner: ALICE })).toBe(true);
    expect(isSnapshot({ ...snapshot, owner: "" })).toBe(false);
    expect(isSnapshot({ ...snapshot, owner: 7 })).toBe(false);
  });

  it("is hidden from another account, and an old one without an owner opens for anyone", () => {
    expect(ownSnapshot({ ...snapshot, owner: ALICE }, ALICE)?.gameId).toBe(snapshot.gameId);
    expect(ownSnapshot({ ...snapshot, owner: ALICE }, BOB)).toBeNull();
    expect(ownSnapshot(snapshot, BOB)).toBe(snapshot);
  });

  describe("through storage, as the live screen reads it", () => {
    let storage: Map<string, string>;
    beforeEach(() => {
      storage = fakeStorage();
    });

    it("writes the owner and reads the game back for that account only", () => {
      rememberViewer(ALICE);
      expect(writeGameSnapshot(snapshot)).toBe(true);
      expect(JSON.parse(storage.get("spotter.v3.game") ?? "{}").owner).toBe(ALICE);
      expect(readGameSnapshot()?.gameId).toBe(snapshot.gameId);
      expect(getGameSnapshot()?.gameId).toBe(snapshot.gameId);

      // Bob signs in on the same browser: the game is not his.
      rememberViewer(BOB);
      expect(readGameSnapshot()).toBeNull();
      expect(getGameSnapshot()).toBeNull();
      // Signing out still knows there is a game to clear.
      expect(storedGameId()).toBe(snapshot.gameId);
    });

    it("tells whoever is reading when the account changes", () => {
      rememberViewer(ALICE);
      writeGameSnapshot(snapshot);
      const listener = vi.fn();
      const unsubscribe = subscribeGameSnapshot(listener);
      listener.mockClear();
      if (rememberViewer(BOB)) announceViewer();
      expect(listener).toHaveBeenCalled();
      expect(getGameSnapshot()).toBeNull();
      unsubscribe();
    });

    it("opens a game saved before owners were stamped for whoever is signed in", () => {
      storage.set("spotter.v3.game", JSON.stringify(snapshot));
      rememberViewer(BOB);
      expect(readGameSnapshot()?.gameId).toBe(snapshot.gameId);
    });
  });
});

describe("the browser log", () => {
  const record = (at: number): LogRecord => ({ kind: "utterance", gameId: "g", at, connectionId: 1, text: "vexley up the middle", offsetMs: 0 });

  it("stamps the account on a record as it is stored, and nothing when nobody is known", () => {
    expect(withOwner(record(1), ALICE)).toMatchObject({ owner: ALICE });
    expect(withOwner(record(1), null)).not.toHaveProperty("owner");
    expect(withOwner(record(1), undefined)).not.toHaveProperty("owner");
  });

  it("reads only this account's records and old unstamped ones, with the stamp taken off", () => {
    const stored: StoredRecord[] = [
      { ...record(1), seq: 1 },
      { ...record(2), seq: 2, owner: ALICE },
      { ...record(3), seq: 3, owner: BOB },
    ];
    const alice = ownRecords(stored, ALICE);
    expect(alice.map((each) => each.at)).toEqual([1, 2]);
    expect(alice.some((each) => "owner" in each)).toBe(false);
    expect(ownRecords(stored, BOB).map((each) => each.at)).toEqual([1, 3]);
    expect(ownRecords(stored, null).map((each) => each.at)).toEqual([1]);
  });

  it("never puts an account id in a download", () => {
    const file = toReplayFile("g", [{ ...record(1), seq: 1, owner: ALICE }], new Date(0));
    expect(JSON.stringify(file)).not.toContain(ALICE);
  });

  it("keeps a month of logs", () => {
    const now = Date.UTC(2026, 9, 7);
    expect(LOG_KEEP_DAYS).toBe(30);
    expect(keepSince(now)).toBe(Date.UTC(2026, 8, 7));
  });
});
