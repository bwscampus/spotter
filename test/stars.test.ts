import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Summary } from "@/components/game/GameSetup";
import { callRate, teamGamesPlayed } from "@/lib/cards/callRate";
import type { DeepgramResults } from "@/lib/deepgram/config";
import { assembleGame, buildSnapshot, type GamePlayerRow } from "@/lib/game/buildGame";
import { keytermsByPriority } from "@/lib/game/keytermBudget";
import { parseSnapshot } from "@/lib/game/snapshot";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import { STAR_KEEP_RATIO } from "@/lib/matching/stars";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";

// The players called most do the most (Jed, Oct 3): a first name narrows a
// shared surname, a shared surname or a shared jersey heard alone goes to the
// most called teammates, the name boost goes to the most called when both
// rosters are over Deepgram's limit, and risky bench names are exact-only.
// Through the real engine and the real matcher. Made-up names only.

const player = (
  jersey: string,
  first_name: string,
  last_name: string,
  priority = 0,
  extra: Partial<GamePlayer> = {},
): GamePlayer => ({
  jersey,
  first_name,
  last_name,
  spoken_forms: spokenForms(last_name),
  ...(priority ? { priority } : {}),
  ...extra,
});

/** Brentwood at home with three Smiths and two teammates in #7; Estancia away with its own #7 and a Jordan. */
function engine(rated = true) {
  const r = (value: number) => (rated ? value : 0);
  const { entries } = buildGameWatchlist(
    [
      player("5", "Jeremiah", "Smith", r(2)),
      player("22", "Marcus", "Smith", r(18)),
      player("40", "Dante", "Smith", r(12)),
      player("7", "Tobin", "Okafor", r(15)),
      player("7", "Rhys", "Lindqvist", r(1)),
    ],
    [player("7", "Kai", "Brandt"), player("11", "Elias", "Jordan", r(9)), player("2", "Jordan", "Pell", r(4)), player("33", "Noah", "Pell", r(5))],
  );
  return new SpotterEngine(entries, { sport: "football", teamCues: [] });
}

function result(transcript: string, isFinal = true): DeepgramResults {
  const words = transcript.split(" ").map((word, index) => ({
    word,
    start: index * 0.3,
    end: index * 0.3 + 0.25,
    confidence: 0.98,
  }));
  return {
    type: "Results",
    is_final: isFinal,
    speech_final: isFinal,
    start: 0,
    duration: words.length * 0.3,
    channel: { alternatives: [{ transcript, confidence: 0.98, words }] },
  };
}

/** Cards on screen after this, "First Last #N", in screen order. Null when the screen did not change. */
function cards(spotter: SpotterEngine, transcript: string, { isFinal = true, now = 0 } = {}) {
  const outcome = spotter.process(result(transcript, isFinal), 1, now, now);
  return outcome.display ? outcome.display.players.map((card) => `${card.first_name} ${card.last_name} #${card.jersey}`) : null;
}

describe("first name and surname", () => {
  it("is that player, not every Smith", () => {
    expect(cards(engine(), "jeremiah smith up the middle")).toEqual(["Jeremiah Smith #5"]);
    expect(cards(engine(false), "dante smith on the tackle")).toEqual(["Dante Smith #40"]);
  });

  it("does not put up a player whose surname is that first name", () => {
    // Jordan Pell, not Elias Jordan.
    expect(cards(engine(), "jordan pell with the catch")).toEqual(["Jordan Pell #2"]);
  });

  it("changes nothing for a surname nobody shares", () => {
    expect(cards(engine(), "tobin okafor")).toEqual(["Tobin Okafor #7"]);
  });

  it("corrects an interim that only had the surname, even to a Smith who was not showing", () => {
    const spotter = engine();
    expect(cards(spotter, "smith", { isFinal: false })).toEqual(["Marcus Smith #22", "Dante Smith #40"]);
    expect(cards(spotter, "jeremiah smith")).toEqual(["Jeremiah Smith #5"]);
  });
});

describe("a shared surname heard alone", () => {
  it("goes to the most called, best first, with everyone close to the best beside them", () => {
    // Marcus 18 and Dante 12 are both over half of 18; Jeremiah's 2 is not.
    expect(12 >= 18 * STAR_KEEP_RATIO && 2 < 18 * STAR_KEEP_RATIO).toBe(true);
    expect(cards(engine(), "smith on the carry")).toEqual(["Marcus Smith #22", "Dante Smith #40"]);
  });

  it("is everyone, in roster order, when nobody has stats", () => {
    expect(cards(engine(false), "smith on the carry")).toEqual(["Jeremiah Smith #5", "Marcus Smith #22", "Dante Smith #40"]);
  });

  it("can still be narrowed by a number to a Smith who was not showing", () => {
    const spotter = engine();
    expect(cards(spotter, "smith on the carry")).toEqual(["Marcus Smith #22", "Dante Smith #40"]);
    expect(cards(spotter, "number 5", { now: 1000 })).toEqual(["Jeremiah Smith #5"]);
  });

  it("keeps both teams' best when the surname is on both", () => {
    expect(cards(engine(), "pell")).toEqual(["Noah Pell #33", "Jordan Pell #2"]);
  });
});

describe("a jersey two teammates wear", () => {
  it("goes to the more called teammate, and the other team's player stays", () => {
    expect(cards(engine(), "number 7")).toEqual(["Tobin Okafor #7", "Kai Brandt #7"]);
  });

  it("is everyone wearing it when nobody has stats", () => {
    expect(cards(engine(false), "number 7")).toEqual(["Tobin Okafor #7", "Rhys Lindqvist #7", "Kai Brandt #7"]);
  });

  it("is the named one when the surname is beside it", () => {
    expect(cards(engine(), "lindqvist number 7")).toEqual(["Rhys Lindqvist #7"]);
  });
});

describe("how often a name is called", () => {
  it("is every play the player was named on, per game", () => {
    expect(callRate({ gp: 5, rush_att: 71, rec: 9, rush_yds: 455 })).toBe(16);
    expect(callRate({ gp: 4, tkl: 30, sacks: 2, pbu: 4 })).toBe(9);
    expect(callRate(null)).toBe(0);
    expect(callRate({ gp: 5, rush_yds: 40 })).toBe(0);
  });

  it("uses the team's games for a player the sheet gave no games played", () => {
    expect(teamGamesPlayed([{ gp: 5 }, { gp: 6 }, null, {}])).toBe(6);
    expect(callRate({ rush_att: 60 }, 6)).toBe(10);
  });
});

describe("the name boost when both rosters are over the limit", () => {
  it("lists the most called first, the two teams taking turns", () => {
    const { entries } = buildGameWatchlist(
      [player("1", "A", "Abbot", 3), player("2", "B", "Becker", 20), player("3", "C", "Cole", 0)],
      [player("4", "D", "Dunn", 8), player("5", "E", "Ellis", 11)],
    );
    expect(keytermsByPriority(entries)).toEqual(["Becker", "Ellis", "Abbot", "Dunn", "Cole"]);
  });
});

describe("setup", () => {
  const HOME = { id: "home", school: "Harborview", mascot: "Gulls", sport: "football" };
  const AWAY = { id: "away", school: "Millbrook", mascot: "Foxes", sport: "football" };
  const row = (roster_id: string, jersey: string, last_name: string, season_stats: unknown = null): GamePlayerRow => ({
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
    season_stats,
    season_lines: [],
    stats_as_of: null,
  });

  it("rates every player from season stats, and carries it onto the card", () => {
    const loaded = assembleGame(HOME, AWAY, [row("home", "22", "Fennimore", { gp: 5, rush_att: 71 }), row("away", "9", "Quillon")]);
    const fennimore = loaded.watchlist.entries.find((entry) => entry.name === "Fennimore")!.players![0];
    expect(fennimore.priority).toBe(14.2);
    expect(loaded.watchlist.entries.find((entry) => entry.name === "Quillon")!.players![0].priority).toBeUndefined();
  });

  it("makes a bench name that fires on an everyday word exact-only, on a team with stats only", () => {
    // Ward fires on "word" and "award", Rivers on "reverse" (the roster review's common-word check).
    const loaded = assembleGame(HOME, AWAY, [
      row("home", "22", "Fennimore", { gp: 5, rush_att: 71 }),
      row("home", "48", "Ward"),
      row("home", "12", "Rivers", { gp: 5, tkl: 20 }),
      row("home", "30", "Quillon"),
      // Millbrook imported no stats, so nobody there is a bench player.
      row("away", "9", "Ward"),
    ]);
    expect(loaded.benchExactOnly).toEqual([{ side: "H", name: "Ward" }]);
    // One entry, "Ward", with both players: exact-only because one of them is.
    expect(loaded.watchlist.entries.find((entry) => entry.name === "Ward")?.exactOnly).toBe(true);
    // Rivers has stats, and Quillon's name is no everyday word.
    expect(loaded.watchlist.entries.find((entry) => entry.name === "Rivers")?.exactOnly).toBeUndefined();
    expect(loaded.watchlist.entries.find((entry) => entry.name === "Quillon")?.exactOnly).toBeUndefined();
  });

  it("an exact-only bench name still goes up when the name is heard exactly, and not on the word", () => {
    const loaded = assembleGame(HOME, AWAY, [row("home", "22", "Fennimore", { gp: 5, rush_att: 71 }), row("home", "48", "Ward")]);
    const said = (text: string) =>
      new SpotterEngine(loaded.watchlist.entries, { sport: "football", teamCues: [] })
        .process(result(text), 1, 0, 0)
        .display?.players.map((card) => card.last_name) ?? [];
    expect(said("ward on the tackle")).toEqual(["Ward"]);
    expect(said("what a word for it")).toEqual([]);
  });

  it("keeps the rate through a reload of the game in this browser", () => {
    const loaded = { ...assembleGame(HOME, AWAY, [row("home", "22", "Fennimore", { gp: 5, rush_att: 71 }), row("away", "9", "Quillon")]), keyterm: { kind: "ok" as const } };
    const snapshot = buildSnapshot(loaded, { wearing: { home: null, away: null }, keytermBoost: true, gameId: "game-1", recorded: true });
    const fennimore = (game: typeof snapshot | null) =>
      game?.watchlist.find((entry) => entry.name === "Fennimore")?.players?.[0].priority;
    expect(fennimore(parseSnapshot(JSON.stringify(snapshot)))).toBe(14.2);
    const broken = JSON.parse(JSON.stringify(snapshot));
    broken.watchlist.find((entry: { name: string }) => entry.name === "Fennimore").players[0].priority = "lots";
    expect(parseSnapshot(JSON.stringify(broken))).toBeNull();
  });
});

describe("what setup says", () => {
  const HOME = { id: "home", school: "Harborview", mascot: "Gulls", sport: "football" };
  const AWAY = { id: "away", school: "Millbrook", mascot: "Foxes", sport: "football" };
  const row = (roster_id: string, jersey: string, last_name: string, season_stats: unknown = null): GamePlayerRow => ({
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
    season_stats,
    season_lines: [],
    stats_as_of: null,
  });

  it("says how many names keep the boost, and which bench names are heard exactly", () => {
    const assembled = assembleGame(HOME, AWAY, [
      row("home", "22", "Fennimore", { gp: 5, rush_att: 71 }),
      row("home", "48", "Ward"),
      row("away", "9", "Quillon"),
    ]);
    const loaded = { ...assembled, keyterm: { kind: "trimmed" as const, keyterms: ["Fennimore", "Quillon"], total: 3 } };
    const html = renderToStaticMarkup(
      createElement(Summary, {
        loaded,
        wearing: { home: null, away: null },
        onWearing: () => undefined,
        starting: false,
        onStart: () => undefined,
        today: "2026-10-03",
      }),
    );
    expect(html).toContain("The name boost holds 2 of these 3 names.");
    // A warning row under the home team's panel, naming the bench player.
    expect(html).toContain("Bench names heard exactly: Ward.");
    // Trimmed is not refused: Start is plain Start.
    expect(html).toMatch(/>Start<\/button>/);
    // And what Start sends Deepgram is the trimmed list.
    expect(buildSnapshot(loaded, { wearing: { home: null, away: null }, keytermBoost: true, gameId: "g", recorded: true }).keyterms).toEqual([
      "Fennimore",
      "Quillon",
    ]);
  });
});
