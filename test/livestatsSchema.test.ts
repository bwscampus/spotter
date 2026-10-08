import { describe, expect, it } from "vitest";
import { playerKey } from "@/lib/cards/playerKey";
import { STATS_SCHEMA, STATS_SYSTEM_PROMPT } from "@/lib/livestats/prompt";
import { rosterFromWatchlist, rostersForPrompt, statsRoster } from "@/lib/livestats/roster";
import { ACTIONS, PLAY_TYPES, READER_YARDS_SOURCES } from "@/lib/livestats/types";
import type { WatchlistEntry } from "@/lib/watchlist";

// =============================================================================
// What live stats asks Claude for, and in what shape (docs/V3_DEFINITION.md
// 8.2 and 8.5). A malformed schema fails every call identically before Claude
// reads anything, which is the trap in CLAUDE.md, so the schema is walked
// rather than spot-checked.
// =============================================================================

type Node = Record<string, unknown>;

function walk(node: unknown, path = "$"): Array<{ path: string; node: Node }> {
  if (typeof node !== "object" || node === null) return [];
  if (Array.isArray(node)) return node.flatMap((entry, index) => walk(entry, `${path}[${index}]`));
  return [{ path, node: node as Node }].concat(Object.entries(node).flatMap(([key, value]) => walk(value, `${path}.${key}`)));
}

const NODES = walk(STATS_SCHEMA);
const PLAY = STATS_SCHEMA.properties.plays.items;
const EVENT = PLAY.properties.events.items;

/** The values a property accepts, from an enum or an anyOf of one and null. */
function accepted(property: unknown): Array<string | null> {
  const node = property as Node;
  if (Array.isArray(node.enum)) return node.enum as string[];
  if (Array.isArray(node.anyOf)) {
    return (node.anyOf as Node[]).flatMap((branch) =>
      Array.isArray(branch.enum) ? (branch.enum as string[]) : branch.type === "null" ? [null] : [],
    );
  }
  return [];
}

describe("STATS_SCHEMA", () => {
  it("never pairs an enum with a type array, and never puts null in an enum", () => {
    expect(NODES.filter(({ node }) => node.enum !== undefined && Array.isArray(node.type)).map(({ path }) => path)).toEqual([]);
    expect(
      NODES.filter(({ node }) => Array.isArray(node.enum) && (node.enum as unknown[]).includes(null)).map(({ path }) => path),
    ).toEqual([]);
  });

  it("writes the nullable enums as anyOf", () => {
    expect(accepted(PLAY.properties.offense).sort()).toEqual(["away", "home", null].sort());
    expect(accepted(EVENT.properties.yardsSource).sort()).toEqual([...READER_YARDS_SOURCES, null].sort());
  });

  it("offers exactly the spec's play types and actions", () => {
    expect(accepted(PLAY.properties.playType)).toEqual([...PLAY_TYPES]);
    expect(accepted(EVENT.properties.action)).toEqual([...ACTIONS]);
  });

  it("carries every field spec 8.2 lists", () => {
    expect(Object.keys(PLAY.properties).sort()).toEqual(
      [
        "seqStart", "seqEnd", "quarter", "clock", "down", "distance", "offense", "playType", "nullified",
        "touchdown", "firstDown", "confidence", "summary", "evidence", "events",
        "updates", "startSpot", "endSpot", "shortBy", "score", "penalty",
      ].sort(),
    );
    expect(Object.keys(EVENT.properties).sort()).toEqual(["action", "made", "playerId", "yards", "yardsSource"]);
  });

  it("uses only keywords structured outputs supports", () => {
    const banned = ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "pattern", "oneOf", "not"];
    const offenders = NODES.flatMap(({ path, node }) =>
      banned.filter((keyword) => node[keyword] !== undefined).map((keyword) => `${path}.${keyword}`),
    );
    expect(offenders).toEqual([]);
  });

  it("closes every object and requires every property", () => {
    for (const { path, node } of NODES.filter(({ node }) => node.type === "object")) {
      expect(node.additionalProperties, path).toBe(false);
      expect([...(node.required as string[])].sort(), path).toEqual(Object.keys(node.properties as Node).sort());
    }
  });

  it("stays under the API's sixteen nullable fields", () => {
    const nullable = NODES.filter(
      ({ node }) =>
        (Array.isArray(node.type) && (node.type as string[]).includes("null")) ||
        (Array.isArray(node.anyOf) && (node.anyOf as Node[]).some((branch) => branch.type === "null")),
    );
    expect(nullable.length).toBeLessThanOrEqual(16);
  });
});

describe("STATS_SYSTEM_PROMPT", () => {
  it("keeps V2's hard rules", () => {
    expect(STATS_SYSTEM_PROMPT).toContain("The transcript given to you is the only source.");
    expect(STATS_SYSTEM_PROMPT).toContain("Never invent one, never adjust one");
    expect(STATS_SYSTEM_PROMPT).toContain("Every playerId must be copied exactly from the roster");
    expect(STATS_SYSTEM_PROMPT).toContain("Prefer a play with low confidence to no play at all.");
    expect(STATS_SYSTEM_PROMPT).toContain("seqEnd is the utterance on which the outcome became known");
    expect(STATS_SYSTEM_PROMPT).toContain("A down and distance call");
    expect(STATS_SYSTEM_PROMPT).toContain("It is the most reliable boundary in the transcript.");
  });

  it("explains every action", () => {
    for (const action of ACTIONS) expect(STATS_SYSTEM_PROMPT).toContain(`- ${action}:`);
  });

  it("carries the whole phrasing guide in spec 8.5", () => {
    const phrases = [
      "brought down by", "wraps him up", "gets him to the ground", "stuffed by", "met by", "cleans it up",
      "breaks it up", "knocks it away", "gets a hand on it", "swats it", "batted down",
      "coughs it up", "puts it on the turf", "ball's loose", "pops out",
      "falls on it", "scoops it", "comes up with it", "recovered by",
      "picked off", "picks it", "undercuts it", "that's intercepted",
      "takes it to the house", "in for six", "scores", "touchdown",
      "picks up a couple", "a handful", "Moves the chains",
    ];
    for (const phrase of phrases) expect(STATS_SYSTEM_PROMPT).toContain(phrase);
  });

  it("states the high school sack rule, the yards sources, nullified plays and the evidence limit", () => {
    expect(STATS_SYSTEM_PROMPT).toMatch(/High school rule: a sack is a rushing attempt by the quarterback for a loss/);
    for (const source of READER_YARDS_SOURCES) expect(STATS_SYSTEM_PROMPT).toContain(`"${source}"`);
    expect(STATS_SYSTEM_PROMPT).toContain("from the 30 to the 42");
    expect(STATS_SYSTEM_PROMPT).toContain("nullified true");
    expect(STATS_SYSTEM_PROMPT).toContain("at most 20 words");
  });

  it("reads nothing that changes during a game, so the cache holds", () => {
    expect(STATS_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("the rosters Claude sees", () => {
  const home = [
    { jersey: "22", first_name: "Sam", last_name: "Langan", position: "RB" },
    { jersey: "66", first_name: "Big", last_name: "Hollis", position: "OL" },
  ];
  const away = [{ jersey: null, first_name: null, last_name: "De La Cruz", position: null }];

  it("gives every player a playerKey id, spotting-off linemen included", () => {
    expect(statsRoster(home, away).map((player) => player.playerId)).toEqual(["H22-LANGAN", "H66-HOLLIS", "A-DE_LA_CRUZ"]);
    expect(playerKey({ side: "H", jersey: "#22", last_name: " Langan " })).toBe("H22-LANGAN");
  });

  it("tells apart two players who would share an id", () => {
    const twins = [
      { jersey: "4", first_name: "A", last_name: "Smith", position: null },
      { jersey: "4", first_name: "B", last_name: "Smith", position: null },
    ];
    expect(statsRoster(twins, []).map((player) => player.playerId)).toEqual(["H4-SMITH", "H4-SMITH-2"]);
  });

  it("is the same bytes whatever order the players arrive in", () => {
    const roster = statsRoster(home, away);
    expect(rostersForPrompt([...roster].reverse())).toBe(rostersForPrompt(roster));
    // Short (Jed, Oct 4): the id already carries side, number and surname.
    expect(rostersForPrompt(roster).split("\n").slice(-3)).toEqual(["A-DE_LA_CRUZ", "H22-LANGAN Sam RB", "H66-HOLLIS Big OL"]);
  });

  it("from a watchlist, has the spotted players only", () => {
    const watchlist: WatchlistEntry[] = [
      {
        name: "Langan",
        aliases: [],
        players: [
          { jersey: "22", first_name: "Sam", last_name: "Langan", position: "RB", grade: null, height: null, weight: null, side: "H", stat_lines: [] },
        ],
      },
      { name: "Label only", aliases: [] },
    ];
    expect(rosterFromWatchlist(watchlist).map((player) => player.playerId)).toEqual(["H22-LANGAN"]);
  });
});
