import { describe, expect, it } from "vitest";
import { assembleGame, type GamePlayerRow } from "@/lib/game/buildGame";
import { selectKeyterms } from "@/lib/game/keytermBudget";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";

// Fewer keyterms (Oct 4): Deepgram was told to listen for every name on both
// rosters and wrote bench names in place of starters'. The boost now goes to
// both teams' words and to players with a priority number or season stats; a
// roster with no stats for anyone keeps every name. Made-up names only.

const player = (jersey: string, last_name: string, extra: Partial<GamePlayer> = {}): GamePlayer => ({
  jersey,
  first_name: null,
  last_name,
  spoken_forms: spokenForms(last_name),
  ...extra,
});
const TEAMS = [
  { school: "Harborview High School", mascot: "Gulls" },
  { school: "Millbrook", mascot: "Foxes" },
];

describe("selectKeyterms", () => {
  it("puts both schools and mascots first, then only rated players and players with stats, most called first", () => {
    const { entries } = buildGameWatchlist(
      [player("1", "Abbot", { priority: 3 }), player("2", "Becker", { priority: 20 }), player("3", "Cole"), player("4", "Dunn", { hasStats: true })],
      [player("5", "Ellis", { priority: 11 }), player("6", "Finch")],
    );
    expect(selectKeyterms(entries, TEAMS, { rated: { H: true, A: true } })).toEqual([
      "Harborview High School",
      "Harborview",
      "Gulls",
      "Millbrook",
      "Foxes",
      "Becker",
      "Ellis",
      "Abbot",
      "Dunn",
    ]);
  });

  it("keeps every name on a side that has no stats for anyone", () => {
    const { entries } = buildGameWatchlist([player("2", "Becker", { priority: 20 }), player("3", "Cole")], [player("5", "Ellis"), player("6", "Finch")]);
    const chosen = selectKeyterms(entries, TEAMS, { rated: { H: true, A: false } });
    expect(chosen.slice(5)).toEqual(["Becker", "Ellis", "Finch"]);
  });

  it("leaves out the names it is told to, and never a team word twice", () => {
    const { entries } = buildGameWatchlist([player("2", "Becker", { priority: 20 }), player("3", "Beckett", { priority: 1 })], [player("5", "Gulls", { priority: 4 })]);
    const chosen = selectKeyterms(entries, TEAMS, { rated: { H: true, A: true }, dropped: new Set(["beckett"]) });
    expect(chosen.filter((term) => term.toLowerCase() === "gulls")).toHaveLength(1);
    expect(chosen).not.toContain("Beckett");
    expect(chosen).toContain("Becker");
  });
});

describe("the game's keyterms", () => {
  const HOME = { id: "home", school: "Harborview", mascot: "Gulls", sport: "football" };
  const AWAY = { id: "away", school: "Millbrook", mascot: "Foxes", sport: "football" };
  const row = (roster_id: string, jersey: string, last_name: string, season_stats: unknown = null): GamePlayerRow => ({
    id: `${roster_id}-${jersey}`,
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

  it("boosts the rated home names and every away name when only home imported stats, with the team words first", () => {
    const loaded = assembleGame(HOME, AWAY, [
      row("home", "22", "Fennimore", { gp: 5, rush_att: 71 }),
      row("home", "66", "Hollins", { gp: 5 }),
      row("home", "48", "Quillon"),
      row("away", "9", "Rennick"),
      row("away", "17", "Dunmore"),
    ]);
    expect(loaded.watchlist.keyterms).toEqual(["Harborview", "Gulls", "Millbrook", "Foxes", "Fennimore", "Rennick", "Hollins", "Dunmore"]);
  });

  it("boosts everyone when nobody has stats, team words first", () => {
    const loaded = assembleGame(HOME, AWAY, [row("home", "22", "Fennimore"), row("away", "9", "Rennick")]);
    expect(loaded.watchlist.keyterms.slice(4)).toEqual(["Fennimore", "Rennick"]);
  });
});
