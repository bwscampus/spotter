import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Summary } from "@/components/game/GameSetup";
import { NamesTables } from "@/components/game/NamesTables";
import { assembleGame, type GamePlayerRow } from "@/lib/game/buildGame";
import { firstNameCollisions } from "@/lib/rosters/firstNames";
import { reviewRoster } from "@/lib/rosters/reviewPlayers";
import { spokenForms } from "@/lib/rosters/spokenForms";
import type { RosterPlayer } from "@/lib/rosters/types";

// A first name that is, or sounds like, another player's surname (Oct 4:
// "tyler" put up Taylor, "lee" put up Lee). Warned in prep and at setup.
// Made-up names only.

const player = (first_name: string | null, last_name: string, jersey: string, extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  jersey,
  first_name,
  last_name,
  position: null,
  grade: null,
  height: null,
  weight: null,
  pronunciations: [],
  spot_mode: "normal",
  flags: [],
  ...extra,
});

describe("firstNameCollisions", () => {
  it("finds a first name that is another player's surname, and one that sounds like it", () => {
    const hits = firstNameCollisions([player("Lee", "Beebe", "22"), player("Noah", "Lee", "4"), player("Tyler", "Morris", "80"), player("Jace", "Taylor", "12")]);
    expect(hits.map((hit) => `${hit.first} -> ${hit.surname} ${hit.verdict}`)).toEqual(["Lee -> Lee would_fire", "Tyler -> Taylor would_fire"]);
    expect(hits[0]).toMatchObject({ index: 0, jersey: "4" });
  });

  it("ignores short first names, a player's own surname, and players set to off", () => {
    expect(firstNameCollisions([player("Al", "Pell", "1"), player("Kai", "Al", "2")])).toEqual([]);
    expect(firstNameCollisions([player("Lee", "Lee", "1")])).toEqual([]);
    expect(firstNameCollisions([player("Lee", "Beebe", "22"), player("Noah", "Lee", "4", { spot_mode: "off" })])).toEqual([]);
  });
});

describe("in prep", () => {
  it("flags the player whose first name it is, and says whose surname it sounds like", () => {
    const reviews = reviewRoster([player("Lee", "Beebe", "22"), player("Noah", "Lee", "4")], "football");
    expect(reviews[0].flags).toContain("first_name_collision");
    expect(reviews[0].reasons.join(" ")).toContain('The first name "Lee" is heard as Lee #4\'s surname');
    expect(reviews[1].flags).not.toContain("first_name_collision");
  });
});

describe("at setup, across both rosters", () => {
  const HOME = { id: "home", school: "Harborview", mascot: "Gulls", sport: "football" };
  const AWAY = { id: "away", school: "Millbrook", mascot: "Foxes", sport: "football" };
  const row = (roster_id: string, jersey: string, first_name: string, last_name: string): GamePlayerRow => ({
    id: `${roster_id}-${jersey}`,
    roster_id,
    jersey,
    first_name,
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
  });

  it("warns about a first name on one roster that is a surname on the other", () => {
    const assembled = assembleGame(HOME, AWAY, [row("home", "22", "Lee", "Beebe"), row("away", "4", "Noah", "Lee")]);
    expect(assembled.firstNames.map((hit) => `${hit.player}: ${hit.first} -> ${hit.surname} ${hit.side}`)).toEqual(["Lee Beebe #22: Lee -> Lee A"]);
    const html = renderToStaticMarkup(
      createElement(Summary, {
        loaded: { ...assembled, keyterm: { kind: "ok" } },
        wearing: { home: null, away: null },
        onWearing: () => undefined,
        starting: false,
        onStart: () => undefined,
        today: "2026-10-04",
      }),
    );
    expect(html).not.toContain("First names that are surnames");
    // The Names page (/games/new/names) lists it, with the verdict.
    const details = renderToStaticMarkup(createElement(NamesTables, { game: assembled }));
    expect(details).toContain("First names that are surnames");
    expect(details).toMatch(/>Lee<\/td><td[^>]*>Lee Beebe #22<\/td><td[^>]*>Lee #4 \(Millbrook\)<\/td><td[^>]*>Is heard as it</);
  });
});
