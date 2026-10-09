import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { statsNote, Summary } from "@/components/game/GameSetup";
import { assembleGame, buildSnapshot, type GamePlayerRow, type LoadedGame } from "@/lib/game/buildGame";
import { parseSnapshot } from "@/lib/game/snapshot";
import { spokenForms } from "@/lib/rosters/spokenForms";

// The live stats switch on game setup, and what a game carries for live stats
// (docs/V3_DEFINITION.md 7.1 and 8.6). Made-up names only.

const HOME = { id: "home", school: "Harborview", mascot: "Gulls", sport: "football" };
const AWAY = { id: "away", school: "Millbrook", mascot: "Foxes", sport: "football" };

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
  row("home", "22", "Fennimore", { first_name: "Reed", position: "RB", season_stats: { rush_att: 71, rush_yds: 455, junk: "x" } }),
  row("home", "64", "Ollander", { position: "OL", spot_mode: "off" }),
  row("away", "17", "Quillon", { season_lines: ["SEASON 38 TKL"] }),
];

const loaded = (home = HOME, away = AWAY): LoadedGame => ({ ...assembleGame(home, away, PLAYERS), keyterm: { kind: "ok" } });
const choices = { wearing: { home: null, away: null }, keytermBoost: false, gameId: "game-1", recorded: true };

describe("what a game carries for live stats", () => {
  it("has both full rosters with keys, linemen included, and football season numbers cleaned", () => {
    const game = loaded();
    expect(game.statsRoster.map((player) => player.playerId)).toEqual(["H22-FENNIMORE", "H64-OLLANDER", "A17-QUILLON"]);
    expect(game.statsRoster[0]).toMatchObject({ first: "Reed", position: "RB", season: { rush_att: 71, rush_yds: 455 } });
    expect(game.statsRoster[0].season).not.toHaveProperty("junk");
    // Spotting off is no card, not no stats: the lineman is on the stats roster and not the watchlist.
    expect(game.watchlist.entries.map((entry) => entry.name)).not.toContain("Ollander");
  });

  it("turns stats on only when asked, and only for football", () => {
    expect(buildSnapshot(loaded(), { ...choices, statsEnabled: true }).statsEnabled).toBe(true);
    expect(buildSnapshot(loaded(), { ...choices, statsEnabled: false }).statsEnabled).toBe(false);
    expect(buildSnapshot(loaded(), choices).statsEnabled).toBe(false);
    const soccer = loaded({ ...HOME, sport: "soccer" }, { ...AWAY, sport: "soccer" });
    expect(buildSnapshot(soccer, { ...choices, statsEnabled: true }).statsEnabled).toBe(false);
    // Another sport's numbers are left off rather than misread.
    expect(soccer.statsRoster.every((player) => player.season === null)).toBe(true);
  });

  it("counts plays as they are read only when asked, and a game from before Oct 8 still reads, waiting for OKs", () => {
    expect(buildSnapshot(loaded(), { ...choices, statsEnabled: true, statsAuto: true }).statsAuto).toBe(true);
    expect(buildSnapshot(loaded(), { ...choices, statsEnabled: true, statsAuto: false }).statsAuto).toBe(false);
    const auto = buildSnapshot(loaded(), { ...choices, statsEnabled: true, statsAuto: true });
    expect(parseSnapshot(JSON.stringify(auto))?.statsAuto).toBe(true);
    const old: Record<string, unknown> = { ...auto };
    delete old.statsAuto;
    expect(parseSnapshot(JSON.stringify(old))).not.toBeNull();
    expect(parseSnapshot(JSON.stringify(old))?.statsAuto).toBeUndefined();
    expect(parseSnapshot(JSON.stringify({ ...auto, statsAuto: "yes" }))).toBeNull();
  });

  it("keeps the sport a refresh carries over, so an edit on the teams screen cannot turn stats on or off", () => {
    expect(buildSnapshot(loaded(), { ...choices, statsEnabled: true, sport: "basketball" }).statsEnabled).toBe(false);
  });
});

describe("reading the game back from this browser", () => {
  const snapshot = buildSnapshot(loaded(), { ...choices, statsEnabled: true });

  it("keeps the stats roster", () => {
    expect(parseSnapshot(JSON.stringify(snapshot))?.statsRoster).toEqual(snapshot.statsRoster);
  });

  it("drops a stats roster it cannot read and keeps the game, names and all", () => {
    const broken = parseSnapshot(JSON.stringify({ ...snapshot, statsRoster: [{ playerId: 7 }] }));
    expect(broken).not.toBeNull();
    expect(broken?.statsRoster).toBeUndefined();
    expect(broken?.watchlist).toEqual(snapshot.watchlist);
    expect(parseSnapshot(JSON.stringify({ ...snapshot, statsRoster: "nope" }))?.watchlist).toEqual(snapshot.watchlist);
  });

  it("cleans season numbers that were edited by hand", () => {
    const edited = {
      ...snapshot,
      statsRoster: [{ ...snapshot.statsRoster![0], season: { rush_att: "lots", rush_yds: 455 } }],
    };
    expect(parseSnapshot(JSON.stringify(edited))?.statsRoster?.[0].season).toEqual({ rush_yds: 455 });
  });

  it("still opens a game built before live stats", () => {
    const old: Record<string, unknown> = { ...snapshot };
    delete old.statsRoster;
    expect(parseSnapshot(JSON.stringify(old))?.statsRoster).toBeUndefined();
  });
});

describe("the switch on game setup", () => {
  const render = (game: LoadedGame, stats?: boolean, statsManual?: boolean) =>
    renderToStaticMarkup(
      createElement(Summary, {
        loaded: game,
        wearing: { home: "", away: "" },
        onWearing: () => undefined,
        stats,
        statsManual,
        onStats: () => undefined,
        starting: false,
        onStart: () => undefined,
      }),
    );

  it("is a beta, on by default for football, counting each play as it is read (Jed, Oct 8)", () => {
    const html = render(loaded());
    expect(html).toContain("Live stats (beta)");
    expect(html).toMatch(/aria-checked="true" aria-label="Read stats from the call"/);
    expect(html).toContain(statsNote(false));
    expect(statsNote(false)).toContain("counts it straight away");
    // The box to check each play instead, unticked.
    expect(html).toMatch(/<input type="checkbox"[^>]*\/>Check each play before it counts/);
    expect(html).not.toMatch(/<input type="checkbox"[^>]*checked=""[^>]*\/>Check each play/);
  });

  it("says nothing counts until it is OK'd once the box is ticked", () => {
    const html = render(loaded(), true, true);
    expect(html).toMatch(/<input type="checkbox"[^>]*checked=""[^>]*\/>Check each play before it counts/);
    expect(html).toContain(
      "Beta. StatCast reads each play from your call and lists what it would add. Nothing counts until you OK it: " +
        "Enter or OK keeps it, Backspace or Discard drops it, U takes back the last one. Stats can be wrong; check " +
        "before you read them on air.",
    );
  });

  it("shows neither the box nor the note with stats off", () => {
    const html = render(loaded(), false);
    expect(html).not.toContain("Check each play before it counts");
    expect(html).not.toContain(statsNote(false));
  });

  it("can be turned on", () => {
    expect(render(loaded(), true)).toMatch(/aria-checked="true" aria-label="Read stats from the call"/);
  });

  it("can be off", () => {
    const html = render(loaded(), false);
    // The stats switch, by its label: the share switch beside it is on by default.
    expect(html).toMatch(/aria-checked="false" aria-label="Read stats from the call"/);
    expect(html).not.toMatch(/aria-checked="true" aria-label="Read stats from the call"/);
  });

  it("is not there for any other sport", () => {
    expect(render(loaded({ ...HOME, sport: "soccer" }, { ...AWAY, sport: "soccer" }))).not.toContain("Live stats");
  });
});
