import { describe, expect, it } from "vitest";
import { assembleGame, buildSnapshot, type GamePlayerRow, type LoadedGame } from "@/lib/game/buildGame";
import { isSnapshot } from "@/lib/game/snapshot";
import { buildJerseyIndex } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";

// Made-up names. What a game is made of, from the rows two saved rosters give.

const HOME = { id: "home", school: "Brentwood", mascot: "Eagles", sport: "football" };
const AWAY = { id: "away", school: "Estancia", mascot: "Matadors", sport: "football" };

const row = (roster_id: string, jersey: string, last_name: string, extra: Partial<GamePlayerRow> = {}): GamePlayerRow => ({
  roster_id,
  jersey,
  first_name: null,
  last_name,
  position: null,
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spoken_forms: spokenForms(last_name),
  spot_mode: "normal",
  season_stats: null,
  season_lines: [],
  stats_as_of: null,
  ...extra,
});

const PLAYERS = [
  row("home", "22", "Langan", { season_stats: { rush_att: 64, rush_yds: 420 }, stats_as_of: "2026-09-24" }),
  row("home", "72", "Okafor", { position: "OL", spot_mode: "off" }),
  row("away", "5", "Longhi", { spot_mode: "exact_only" }),
  row("away", "17", "Estanza", { pronunciations: ["es-TAHN-zuh"] }),
];

describe("assembleGame", () => {
  const game = assembleGame(HOME, AWAY, PLAYERS);

  it("leaves players set to off out of the watchlist, the keyterms and the jerseys", () => {
    expect(game.watchlist.entries.map((entry) => entry.name)).toEqual(["Langan", "Longhi", "Estanza"]);
    expect(game.watchlist.keyterms).not.toContain("Okafor");
    expect(buildJerseyIndex(game.watchlist.entries).byJersey.has("72")).toBe(false);
  });

  it("still counts them as saved, and says how many were left out", () => {
    expect(game.home).toMatchObject({ playerCount: 2, offCount: 1 });
    expect(game.away).toMatchObject({ playerCount: 2, offCount: 0 });
  });

  it("carries exact-only on the entry for the engine", () => {
    expect(game.watchlist.entries.find((entry) => entry.name === "Longhi")?.exactOnly).toBe(true);
  });

  it("builds each card through toCardPlayer: season line, card face, pronunciation, side", () => {
    const langan = game.watchlist.entries.find((entry) => entry.name === "Langan")!.players![0];
    expect(langan.side).toBe("H");
    expect(langan.stat_lines.length).toBeGreaterThan(0);
    expect(langan.face?.season.length).toBeGreaterThan(0);
    expect(langan.face?.plain).toBe("Langan");
    const estanza = game.watchlist.entries.find((entry) => entry.name === "Estanza")!.players![0];
    expect(estanza.side).toBe("A");
    expect(estanza.pronunciation).toBe("es-TAHN-zuh");
    expect(estanza.face?.stressed).toBe("TAHN");
  });

  it("warns about a name that sounds like a school", () => {
    expect(game.teamSounds.map((warning) => warning.name)).toContain("Estanza");
  });

  it("takes the sport from the rosters, and says when they disagree", () => {
    expect(game.sport).toBe("football");
    expect(game.sportMismatch).toBe(false);
    expect(assembleGame(HOME, { ...AWAY, sport: "soccer" }, PLAYERS)).toMatchObject({
      sport: "football",
      sportMismatch: true,
    });
  });
});

describe("buildSnapshot", () => {
  const loaded: LoadedGame = { ...assembleGame(HOME, AWAY, PLAYERS), keyterm: { kind: "ok" } };
  const choices = { wearing: { home: " white ", away: "" }, keytermBoost: true, gameId: "game-1", recorded: true };

  it("makes a game the live screen accepts, with stats off", () => {
    const snapshot = buildSnapshot(loaded, choices);
    expect(isSnapshot(snapshot)).toBe(true);
    expect(snapshot.statsEnabled).toBe(false);
    expect(snapshot).toMatchObject({ gameId: "game-1", recorded: true, sport: "football" });
  });

  it("keeps what each side wears, trimmed, and turns it into a team cue", () => {
    const snapshot = buildSnapshot(loaded, choices);
    expect(snapshot.home.wearing).toBe("white");
    expect(snapshot.away.wearing).toBeNull();
    expect(snapshot.teamCues).toContainEqual({ words: ["white"], side: "H" });
  });

  it("sends Deepgram both teams' words and the names, only when they were asked for and it will take them", () => {
    expect(buildSnapshot(loaded, choices).keyterms).toEqual(["Brentwood", "Eagles", "Estancia", "Matadors", "Langan", "Longhi", "Estanza"]);
    expect(buildSnapshot(loaded, { ...choices, keytermBoost: false }).keyterms).toEqual([]);
    const refused: LoadedGame = { ...loaded, keyterm: { kind: "too_many", reason: "" } };
    expect(buildSnapshot(refused, choices).keyterms).toEqual([]);
  });

  it("keeps the sport a refresh passes rather than reading it again", () => {
    expect(buildSnapshot(loaded, { ...choices, sport: "soccer" }).sport).toBe("soccer");
  });
});
