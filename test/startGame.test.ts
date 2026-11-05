import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedGame } from "@/lib/game/buildGame";

// Starting a draft (Nov 3) turns that same row into the live game: the draft's
// id is the game's id, the start goes to /api/drafts/<id>/start, and nothing
// posts a new row unless the draft is gone. The network and the browser's
// storage are stand-ins; the rest is the real code.

const calls: Array<{ method: string; path: string; body: unknown }> = [];
let answer: (path: string) => { ok: true; status: number; data: unknown } | { ok: false; status: number; error: null; code: null } = () => ({
  ok: true,
  status: 200,
  data: {},
});
vi.mock("@/lib/apiClient", () => ({
  api: async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    return answer(path);
  },
}));
const written: Array<{ gameId: string; recorded: boolean }> = [];
vi.mock("@/lib/game/snapshot", () => ({
  getGameSnapshot: () => null,
  writeGameSnapshot: (snapshot: { gameId: string; recorded: boolean }) => {
    written.push({ gameId: snapshot.gameId, recorded: snapshot.recorded });
    return true;
  },
  clearGameSnapshot: () => undefined,
}));
vi.mock("@/lib/log/shareLog", () => ({ setShareChoice: () => undefined, clearShareChoice: () => undefined, shareGameLog: async () => undefined }));
const tracked: Array<{ name: string; props: unknown }> = [];
vi.mock("@/lib/analytics/track", () => ({ setGameId: () => undefined, track: (name: string, props: unknown) => tracked.push({ name, props }) }));

// startGame checks the browser can keep a game before it starts one.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  setItem: (key: string, value: string) => store.set(key, value),
  getItem: (key: string) => store.get(key) ?? null,
  removeItem: (key: string) => store.delete(key),
});

const { startGame } = await import("@/lib/game/startGame");

const DRAFT = "22222222-3333-4444-8555-666666666666";
const loaded = {
  home: { id: "home-id", school: "Harborview", mascot: "Lions", sport: "football", playerCount: 2, offCount: 0, hiddenTonight: 0, statsAsOf: null },
  away: { id: "away-id", school: "Millbrook", mascot: "Hawks", sport: "football", playerCount: 2, offCount: 0, hiddenTonight: 0, statsAsOf: null },
  sport: "football",
  watchlist: { entries: [{ name: "Quillon", forms: ["quillon"], players: [] }], keyterms: [] },
  keyterm: { kind: "ok" },
  teamSounds: [],
  statsRoster: [],
} as unknown as LoadedGame;
const choices = { loaded, wearing: { home: null, away: null }, share: true, keytermBoost: true, statsEnabled: false };

beforeEach(() => {
  calls.length = 0;
  written.length = 0;
  tracked.length = 0;
  answer = () => ({ ok: true, status: 200, data: {} });
});

describe("starting a draft", () => {
  it("keeps the draft's id as the game's and starts that row, never posting a new one", async () => {
    const started = await startGame({ ...choices, draftId: DRAFT, from: "games" });
    expect(started).toEqual({ ok: true, gameId: DRAFT });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /api/drafts/${DRAFT}/start`]);
    expect(calls[0].body).toMatchObject({ id: DRAFT, home_roster_id: "home-id", away_roster_id: "away-id", home_school: "Harborview", away_school: "Millbrook", stats_enabled: false });
    expect(written).toEqual([{ gameId: DRAFT, recorded: true }]);
    expect(tracked.map((event) => event.name)).toEqual(["game.started", "game.draft_started"]);
    expect(tracked[1].props).toEqual({ from: "games", date_passed: false });
  });

  it.each([
    ["started already on another computer or tab", 409],
    ["deleted elsewhere", 404],
    ["unreachable", 0],
  ])("records the game under a new id, never the draft's, when the draft was %s", async (_, status) => {
    answer = (path) => (path.includes("/api/drafts/") ? { ok: false, status, error: null, code: null } : { ok: true, status: 201, data: { ok: true } });
    const started = await startGame({ ...choices, draftId: DRAFT, from: "home" });
    expect(started.ok).toBe(true);
    const gameId = started.ok ? started.gameId : "";
    expect(gameId).not.toBe(DRAFT);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`POST /api/drafts/${DRAFT}/start`, "POST /api/games"]);
    expect((calls[1].body as { id: string }).id).toBe(gameId);
    expect(written[0]).toEqual({ gameId, recorded: true });
    // It is a game, not the draft starting.
    expect(tracked.map((event) => event.name)).toEqual(["game.started"]);
  });

  it("starts a game that is not a draft as before: a new id and POST /api/games", async () => {
    const started = await startGame(choices);
    expect(started.ok).toBe(true);
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["POST /api/games"]);
    expect(tracked.map((event) => event.name)).toEqual(["game.started"]);
  });
});

describe("a browser that cannot keep the game", () => {
  it("starts nothing, so a draft is never turned into a game nobody holds", async () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    });
    const started = await startGame({ ...choices, draftId: DRAFT });
    expect(started.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
