import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Summary } from "@/components/game/GameSetup";
import { assembleGame, type GamePlayerRow } from "@/lib/game/buildGame";
import { droppedKeyterms, HIGH_PRIORITY, lookAlikeDrops } from "@/lib/game/crossLookAlikes";
import { STAR_KEEP_RATIO } from "@/lib/matching/stars";
import { buildGameWatchlist, findCrossPlayerCollisions, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { CLOSE_RATIO } from "@/lib/rosters/commonWordHits";
import { spokenForms } from "@/lib/rosters/spokenForms";

// A bench name that sounds like a star's (Oct 4): its keyterm is dropped and
// setup offers one click to turn its spotting off. Made-up names: Fennimore
// is the star, Fenimore the reserve who sounds like him.

const player = (jersey: string, last_name: string, extra: Partial<GamePlayer> = {}): GamePlayer => ({
  jersey,
  first_name: null,
  last_name,
  spoken_forms: spokenForms(last_name),
  ...extra,
});

describe("lookAlikeDrops", () => {
  it(`drops the name called ${STAR_KEEP_RATIO} of the star's rate or less, when the star is called ${HIGH_PRIORITY} a game or more`, () => {
    const { entries } = buildGameWatchlist([player("22", "Fennimore", { priority: 14 }), player("38", "Fenimore")], [player("9", "Quillon", { priority: 5 })]);
    const collisions = findCrossPlayerCollisions(entries, CLOSE_RATIO);
    expect(collisions.map((pair) => [pair.a, pair.b].sort())).toContainEqual(["Fenimore", "Fennimore"]);
    const drops = lookAlikeDrops(entries, collisions, (card) => `row-${card.jersey}`);
    expect(drops).toEqual([
      { low: "Fenimore", lowRate: 0, high: "Fennimore", highRate: 14, score: collisions[0].score, players: [{ side: "H", jersey: "38", last_name: "Fenimore", id: "row-38" }] },
    ]);
    expect(droppedKeyterms(entries, drops)).toEqual(new Set(["fenimore"]));
  });

  it("drops nothing when the two are close in rate, or when neither is a star", () => {
    const close = buildGameWatchlist([player("22", "Fennimore", { priority: 14 }), player("38", "Fenimore", { priority: 10 })], []);
    expect(lookAlikeDrops(close.entries, findCrossPlayerCollisions(close.entries, CLOSE_RATIO))).toEqual([]);
    const unrated = buildGameWatchlist([player("22", "Fennimore"), player("38", "Fenimore")], []);
    expect(lookAlikeDrops(unrated.entries, findCrossPlayerCollisions(unrated.entries, CLOSE_RATIO))).toEqual([]);
  });
});

describe("at setup", () => {
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

  it("leaves the bench name out of the boost and offers spotting off, with the saved row to write to", () => {
    const assembled = assembleGame(HOME, AWAY, [row("home", "22", "Fennimore", { gp: 5, rush_att: 71 }), row("home", "38", "Fenimore"), row("away", "9", "Quillon")]);
    expect(assembled.lookAlikeDrops.map((drop) => [drop.low, drop.high, drop.players[0].id])).toEqual([["Fenimore", "Fennimore", "home-38"]]);
    expect(assembled.watchlist.keyterms).toContain("Fennimore");
    expect(assembled.watchlist.keyterms).not.toContain("Fenimore");
    // Still listened for: only the boost is gone until spotting is turned off.
    expect(assembled.watchlist.entries.some((entry) => entry.name === "Fenimore")).toBe(true);

    const html = renderToStaticMarkup(
      createElement(Summary, {
        loaded: { ...assembled, keyterm: { kind: "ok" } },
        wearing: { home: null, away: null },
        onWearing: () => undefined,
        starting: false,
        onStart: () => undefined,
        onSpotOff: () => undefined,
        today: "2026-10-04",
      }),
    );
    // One warning row under both teams' panels, naming the pair, with the one-click fix at its right.
    expect(html).toContain("Bench name that sounds like a star: Fenimore sounds like Fennimore");
    expect(html).toContain(">Spotting off</button>");
  });
});
