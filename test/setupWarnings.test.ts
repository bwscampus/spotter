import { describe, expect, it } from "vitest";
import type { LoadedGame } from "@/lib/game/buildGame";
import { lookAlikeWarning, setupWarnings, staleAge, TEAM_SOUND_ROWS } from "@/lib/game/setupWarnings";
import { phraseSource } from "@/lib/game/teamSounds";

// Setup's warnings in plain words (Jed, Nov 3): a short headline, at most one
// fix, and the long explanation behind "Why?". Made-up teams and players.

const side = (id: string, school: string, mascot: string | null, statsAsOf: string | null = null) => ({
  id,
  school,
  mascot,
  sport: "football",
  playerCount: 40,
  offCount: 0,
  hiddenTonight: 0,
  statsAsOf,
});

function game(overrides: Partial<LoadedGame> = {}): LoadedGame {
  return {
    home: side("home", "Harborview", "Lions"),
    away: side("away", "Millbrook", "Hawks"),
    sport: "football",
    sportMismatch: false,
    colorNote: null,
    watchlist: { entries: [], keyterms: [] },
    collisions: [],
    similarJerseys: [],
    teamSounds: [],
    benchExactOnly: [],
    lookAlikeDrops: [],
    firstNames: [],
    keyterm: { kind: "ok" },
    statsRoster: [],
    hidden: [],
    ...overrides,
  } as LoadedGame;
}

const NAMES = "/games/new/names?away=away&home=home";
const JARGON = /name boost|boost|heard-as|heard as form|spotting|exact-only|exact only|keyterm/i;

function sound(name: string, word: string, verdict: "would_fire" | "close" = "would_fire") {
  return { name, verdict, hits: [{ word, score: 0.9, verdict }] } as LoadedGame["teamSounds"][number];
}

describe("setup warnings", () => {
  it("says stale stats in weeks, with Update stats coming back to setup", () => {
    expect(staleAge(7)).toBe("1 week old");
    expect(staleAge(13)).toBe("1 week old");
    expect(staleAge(14)).toBe("2 weeks old");
    expect(staleAge(21)).toBe("3 weeks old");
    const [warning] = setupWarnings(game({ home: side("home", "Harborview", "Lions", "2026-10-12") }), "2026-11-02", NAMES);
    expect(warning.headline).toBe("Harborview's stats are 3 weeks old.");
    expect(warning.side).toBe("home");
    expect(warning.fixes).toEqual([{ kind: "link", label: "Update stats", href: "/teams/home/stats?for=game&side=home&away=away&home=home" }]);
  });

  it("carries a draft through Update stats", () => {
    const [warning] = setupWarnings(game({ home: side("home", "Harborview", "Lions", "2026-10-12") }), "2026-11-02", NAMES, { draft: "d1" });
    expect(warning.fixes[0]).toMatchObject({ href: expect.stringContaining("&draft=d1") });
  });

  it("names a bench name that sounds like a star's, with Hide tonight per player", () => {
    const drop = {
      low: "Hill",
      lowRate: 0,
      high: "Hall",
      highRate: 9,
      score: 0.8,
      players: [{ side: "A" as const, jersey: "12", last_name: "Hill", id: "row-1" }],
    };
    const warning = lookAlikeWarning(drop);
    expect(warning.headline).toBe("Hill might pull up Hall's card.");
    expect(warning.fixes).toEqual([{ kind: "hide", label: "Hide Hill tonight", playerId: "A12-HILL" }]);
    expect(warning.why).toContain("Your saved team doesn't change.");
    const two = lookAlikeWarning({ ...drop, players: [...drop.players, { side: "A", jersey: "40", last_name: "Hill", id: "row-2" }] });
    expect(two.fixes.map((fix) => fix.label)).toEqual(["Hide Hill tonight #12", "Hide Hill tonight #40"]);
  });

  it("gives each name that sounds like a team its own row up to three, saying mascot or school", () => {
    expect(phraseSource("lions", [{ school: "Harborview", mascot: "Lions" }])).toEqual({ kind: "mascot", school: "Harborview" });
    expect(phraseSource("lion", [{ school: "Harborview", mascot: "Lions" }])).toEqual({ kind: "mascot", school: "Harborview" });
    expect(phraseSource("harborview", [{ school: "Harborview", mascot: "Lions" }])).toEqual({ kind: "school", school: "Harborview" });

    const rows = setupWarnings(game({ teamSounds: [sound("Lyons", "lions"), sound("Harbor", "harborview", "close")] }), "2026-11-02", NAMES);
    expect(rows.map((row) => row.headline)).toEqual(['"Lyons" sounds like the mascot.', '"Harbor" sounds like Harborview.']);
    expect(rows[0].fixes).toEqual([{ kind: "link", label: "Review", href: NAMES }]);
    expect(rows[0].why).toContain('When someone says "lions", the Lyons card can go up.');
  });

  it("folds four or more names that sound like a team into one row", () => {
    const sounds = ["Lyons", "Lyon", "Liang", "Leone"].map((name) => sound(name, "lions"));
    expect(sounds.length).toBeGreaterThan(TEAM_SOUND_ROWS);
    const rows = setupWarnings(game({ teamSounds: sounds }), "2026-11-02", NAMES);
    expect(rows).toHaveLength(1);
    expect(rows[0].headline).toBe("4 names sound like a team.");
    expect(rows[0].why).toContain("Lyons, Lyon, Liang, Leone");
  });

  it("says bench names go up only when said clearly", () => {
    const rows = setupWarnings(
      game({ benchExactOnly: [{ side: "H", name: "Brown" }, { side: "H", name: "Long" }, { side: "A", name: "Ward" }] }),
      "2026-11-02",
      NAMES,
    );
    expect(rows.map((row) => [row.side, row.headline])).toEqual([
      ["away", "Ward only goes up when said clearly."],
      ["home", "Brown, Long only go up when said clearly."],
    ]);
    expect(rows.every((row) => row.fixes.length === 0 && row.why)).toBe(true);
  });

  it("says lots of names instead of the boost, and never mentions the trimmed list", () => {
    const tooMany = setupWarnings(game({ keyterm: { kind: "too_many", reason: "" } }), "2026-11-02", NAMES);
    expect(tooMany.map((row) => row.headline)).toEqual(["Lots of names on these rosters. Unusual names may be missed more often."]);
    expect(tooMany[0].why).toBeTruthy();
    expect(setupWarnings(game({ keyterm: { kind: "trimmed", keyterms: ["a"], total: 2 } }), "2026-11-02", NAMES)).toEqual([]);
  });

  it("keeps every headline short and every word plain", () => {
    const all = setupWarnings(
      game({
        home: side("home", "Harborview", "Lions", "2026-10-01"),
        colorNote: "Both teams are nearly the same color.",
        sportMismatch: true,
        teamSounds: [sound("Lyons", "lions")],
        benchExactOnly: [{ side: "H", name: "Long" }],
        keyterm: { kind: "too_many", reason: "" },
        lookAlikeDrops: [{ low: "Hill", lowRate: 1, high: "Hall", highRate: 9, score: 0.8, players: [{ side: "A", jersey: "12", last_name: "Hill", id: null }] }],
      }),
      "2026-11-02",
      NAMES,
    );
    expect(all).toHaveLength(7);
    for (const warning of all) {
      expect(warning.headline.split(/\s+/).length, warning.headline).toBeLessThanOrEqual(14);
      expect(`${warning.headline} ${warning.why ?? ""} ${warning.fixes.map((fix) => fix.label).join(" ")}`).not.toMatch(JARGON);
    }
    expect(new Set(all.map((warning) => warning.key)).size).toBe(all.length);
  });
});
