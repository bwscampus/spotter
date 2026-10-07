import { describe, expect, it } from "vitest";
import { teamPhrases, teamSoundWarnings } from "@/lib/game/teamSounds";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";

// Made-up names. Scored with the real matcher, so these are the cards a game
// would actually put up when the announcer names a team.

const player = (jersey: string, last_name: string, extra: Partial<GamePlayer> = {}): GamePlayer => ({
  jersey,
  last_name,
  spoken_forms: spokenForms(last_name),
  ...extra,
});

const TEAMS = [
  { school: "Brentwood High School", mascot: "Eagles" },
  { school: "Estancia", mascot: "Matadors" },
];

describe("teamPhrases", () => {
  it("says a school the ways an announcer does, and a plural mascot both ways", () => {
    expect(teamPhrases(TEAMS)).toEqual([
      "brentwood high school",
      "brentwood",
      "eagles",
      "eagle",
      "estancia",
      "matadors",
      "matador",
    ]);
  });

  it("drops words that name no team on their own, and only makes a mascot singular", () => {
    expect(teamPhrases([{ school: "Saint Francis High School", mascot: null }])).toEqual([
      "saint francis high school",
      "francis",
    ]);
    expect(teamPhrases([{ school: "The Prep", mascot: null }])).toEqual([]);
  });
});

describe("teamSoundWarnings", () => {
  const { entries } = buildGameWatchlist(
    [player("4", "Eagle"), player("1", "Langan")],
    [player("6", "Estanza"), player("5", "Stancia"), player("17", "Mariner")],
  );
  const warnings = teamSoundWarnings(TEAMS, entries);
  const named = (name: string) => warnings.find((warning) => warning.name === name);

  it("warns when a surname would go up on a mascot", () => {
    expect(named("Eagle")).toMatchObject({ verdict: "would_fire", hits: [{ word: "eagle" }] });
  });

  it("warns when a surname would go up on the other school's name", () => {
    expect(named("Estanza")).toMatchObject({ verdict: "would_fire", hits: [{ word: "estancia" }] });
  });

  it("says close, not fires, for a name just under the threshold", () => {
    expect(named("Stancia")?.verdict).toBe("close");
  });

  it("leaves names that sound like neither team alone", () => {
    expect(named("Langan")).toBeUndefined();
    expect(named("Mariner")).toBeUndefined();
  });

  it("lists names that would fire before names that only come close", () => {
    const verdicts = warnings.map((warning) => warning.verdict);
    expect(verdicts.indexOf("close")).toBeGreaterThan(verdicts.lastIndexOf("would_fire"));
  });

  it("never warns about a player whose spotting is off, who can never put a card up", () => {
    const game = buildGameWatchlist([player("4", "Eagle", { spot_mode: "off" })], []);
    expect(teamSoundWarnings(TEAMS, game.entries)).toEqual([]);
  });
});
