import { describe, expect, it } from "vitest";
import { resolveIds, resolvePlayerId } from "@/lib/livestats/resolveIds";
import { rostersForPrompt } from "@/lib/livestats/roster";
import { EMPTY_SESSION, readPlays } from "@/lib/livestats/session";
import type { Action, StatsEvent, StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// R33: the id the reader meant (lib/livestats/resolveIds.ts), through readPlays
// the way a live reply goes. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H4-QUELLMAN", side: "home", jersey: "4", first: "Avi", last: "Quellman", position: "QB", season: { pass_att: 90 } },
  { playerId: "H7-SMITH", side: "home", jersey: "7", first: "Joe", last: "Smith", position: "RB" },
  { playerId: "H81-ORVALE", side: "home", jersey: "81", first: "Dax", last: "Orvale", position: "WR" },
  { playerId: "A2-SMITH", side: "away", jersey: "2", first: "Kip", last: "Smith", position: "CB" },
  { playerId: "A33-BRANDT", side: "away", jersey: "33", first: "Ezra", last: "Brandt", position: "LB" },
];
const INDEX = new Map(ROSTER.map((player) => [player.playerId, player]));

function ev(playerId: string, action: Action): StatsEvent {
  return { playerId, action, yards: null, yardsSource: null, made: null };
}
function play(events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart: 10,
    seqEnd: 11,
    quarter: 1,
    clock: null,
    down: 1,
    distance: 10,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: "a play",
    evidence: "quellman smith orvale brandt",
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    ...extra,
  };
}

describe("the id the reader meant", () => {
  it("takes the roster id a line copied whole begins with", () => {
    expect(resolvePlayerId("H7-SMITH Joe RB", INDEX)).toBe("H7-SMITH");
    expect(resolvePlayerId("H7-SMITH | Joe", INDEX)).toBe("H7-SMITH");
    expect(resolvePlayerId("H7-SMITH (heard as smyth)", INDEX)).toBe("H7-SMITH");
    expect(resolvePlayerId("H7-SMITH, Joe", INDEX)).toBe("H7-SMITH");
  });

  it("takes side and surname only when one player on that side has the surname", () => {
    expect(resolvePlayerId("H-SMITH", INDEX)).toBe("H7-SMITH");
    expect(resolvePlayerId("H9-SMITH", INDEX)).toBe("H7-SMITH");
    expect(resolvePlayerId("A-SMITH Kip", INDEX)).toBe("A2-SMITH");
    const twoHomeSmiths = new Map(INDEX).set("H30-SMITH", { playerId: "H30-SMITH", side: "home", jersey: "30", first: "Lou", last: "Smith", position: "LB" });
    expect(resolvePlayerId("H-SMITH", twoHomeSmiths)).toBeNull();
  });

  it("leaves alone an id that is on the roster, empty, or matches nobody", () => {
    expect(resolvePlayerId("H7-SMITH", INDEX)).toBeNull();
    expect(resolvePlayerId("", INDEX)).toBeNull();
    expect(resolvePlayerId("H5-NOBODY Lee", INDEX)).toBeNull();
    expect(resolvePlayerId("Smith", INDEX)).toBeNull();
  });

  it("notes every match with R33, and keeps one event per player and action", () => {
    const resolved = resolveIds(play([ev("H7-SMITH Joe RB", "rush"), ev("H7-SMITH", "rush"), ev("A33-BRANDT", "tackle")]), ROSTER);
    expect(resolved.play.events.map((event) => event.playerId)).toEqual(["H7-SMITH", "A33-BRANDT"]);
    expect(resolved.notes).toEqual([
      expect.objectContaining({ rule: "R33", kind: "matched", to: "H7-SMITH", event: expect.objectContaining({ playerId: "H7-SMITH Joe RB" }) }),
    ]);
  });
});

describe("R33 through readPlays", () => {
  it("credits the player the reader meant, and logs the match", () => {
    const { added } = readPlays(EMPTY_SESSION, [play([ev("H7-SMITH Joe RB", "rush"), ev("A33-BRANDT | Ezra | LB", "tackle")])], ROSTER, 1000);
    expect(added[0].changes.map((change) => `${change.playerId} ${change.key}`)).toEqual(["H7-SMITH rush_att", "H7-SMITH rush_yds", "A33-BRANDT tkl"]);
    expect(added[0].dropped).toContainEqual(
      expect.objectContaining({ rule: "R33", kind: "matched", playerId: "H7-SMITH Joe RB", to: "H7-SMITH" }),
    );
    expect(added[0].dropped.some((drop) => drop.rule === "R9")).toBe(false);
  });

  it("still drops an id that matches nobody, with R9", () => {
    const { added } = readPlays(EMPTY_SESSION, [play([ev("H5-NOBODY Lee RB", "rush")])], ROSTER, 1000);
    expect(added[0].changes).toEqual([]);
    expect(added[0].dropped).toContainEqual(expect.objectContaining({ rule: "R9", playerId: "H5-NOBODY Lee RB" }));
  });

  it("matches the passer before the passer rule, so he needs no fill", () => {
    const pass = play([ev("H4-QUELLMAN Avi QB", "pass_complete"), ev("H81-ORVALE", "reception")], { playType: "pass" });
    const { added } = readPlays(EMPTY_SESSION, [pass], ROSTER, 1000);
    expect(added[0].play.events[0]).toMatchObject({ playerId: "H4-QUELLMAN" });
    expect(added[0].play.events[0].estimated).toBeUndefined();
    expect(added[0].dropped.some((drop) => drop.rule === "R14")).toBe(false);
    expect(added[0].dropped).toContainEqual(expect.objectContaining({ rule: "R33", to: "H4-QUELLMAN" }));
  });
});

describe("the roster block in the prompt", () => {
  it("prints each line with bars and says to copy only the id", () => {
    const text = rostersForPrompt(ROSTER);
    expect(text.split("\n")).toContain("H7-SMITH | Joe | RB");
    expect(text).toContain('Copy the playerId exactly as it appears before the first "|", and nothing after it.');
  });
});
