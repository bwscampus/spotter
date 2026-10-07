import { describe, expect, it } from "vitest";
import { gameTitle, isSnapshot, parseSnapshot, type GameSnapshot } from "@/lib/game/snapshot";

const snapshot: GameSnapshot = {
  version: 1,
  builtAt: "2026-09-25T19:00:00.000Z",
  gameId: "5f0c1a52-8d1e-4a57-9d6f-2a8f6e0c9b11",
  recorded: true,
  home: { id: "a", name: "Brentwood", wearing: null },
  away: { id: "b", name: "Estancia", wearing: "white" },
  watchlist: [
    {
      name: "Tremaine",
      aliases: [],
      label: "Tremaine",
      keyterm: "Tremaine",
      players: [
        {
          jersey: "7",
          first_name: null,
          last_name: "Tremaine",
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
  keyterms: ["Tremaine"],
  sport: "football",
  teamCues: [{ words: ["brentwood"], side: "H" }],
  statsEnabled: false,
};

describe("isSnapshot", () => {
  it("accepts a game this version wrote", () => {
    expect(isSnapshot(snapshot)).toBe(true);
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it("rejects junk and half-written values", () => {
    for (const value of [null, "{}", [], {}]) expect(isSnapshot(value)).toBe(false);
    expect(parseSnapshot("{")).toBeNull();
  });

  it("rejects a game with no id, which would have no log to belong to", () => {
    expect(isSnapshot({ ...snapshot, gameId: "" })).toBe(false);
    expect(isSnapshot({ ...snapshot, gameId: undefined })).toBe(false);
  });

  it("rejects an empty watchlist, which would listen for nothing", () => {
    expect(isSnapshot({ ...snapshot, watchlist: [] })).toBe(false);
  });

  it("rejects a V2 game, which has colours and no stats switch", () => {
    const v2: Record<string, unknown> = { ...snapshot, home: { id: "a", name: "Brentwood", color: "#000080" } };
    delete v2.statsEnabled;
    delete v2.recorded;
    expect(isSnapshot(v2)).toBe(false);
  });

  it("accepts an empty keyterm list, which is the no-boost case", () => {
    expect(isSnapshot({ ...snapshot, keyterms: [] })).toBe(true);
  });

  it("rejects a malformed exact-only flag", () => {
    expect(isSnapshot({ ...snapshot, watchlist: [{ ...snapshot.watchlist[0], exactOnly: "yes" }] })).toBe(false);
  });
});

describe("gameTitle", () => {
  it("reads away at home, the way a scoreboard does", () => {
    expect(gameTitle(snapshot)).toBe("Estancia at Brentwood");
  });
});
