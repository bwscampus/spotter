import { describe, expect, it } from "vitest";
import { buildGameWatchlist, buildJerseyIndex, findCrossPlayerCollisions, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";

const player = (jersey: string | null, last_name: string): GamePlayer => ({
  jersey,
  last_name,
  spoken_forms: spokenForms(last_name),
});

const labelOf = (entries: { name: string; label?: string }[], name: string) =>
  entries.find((entry) => entry.name === name)?.label;

describe("buildGameWatchlist", () => {
  it("labels a lone player with just the surname", () => {
    const { entries } = buildGameWatchlist([player("7", "Tremaine")], []);
    expect(labelOf(entries, "Tremaine")).toBe("Tremaine");
  });

  it("labels two players on one team with both jerseys", () => {
    const { entries } = buildGameWatchlist([player("10", "Williams"), player("23", "Williams")], []);
    expect(entries).toHaveLength(1);
    expect(labelOf(entries, "Williams")).toBe("Williams #10 · #23");
  });

  it("labels a surname on both teams with the side", () => {
    const { entries } = buildGameWatchlist([player("10", "Williams")], [player("4", "Williams")]);
    expect(labelOf(entries, "Williams")).toBe("Williams #10 H · #4 A");
  });

  it("shows #? for a player with no jersey", () => {
    const { entries } = buildGameWatchlist([player("10", "Williams"), player(null, "Williams")], []);
    expect(labelOf(entries, "Williams")).toBe("Williams #10 · #?");
  });

  it("merges one entry per surname with every spoken form", () => {
    const { entries } = buildGameWatchlist([player("3", "Sanchez-Greenfield")], []);
    expect(entries).toEqual([
      {
        name: "Sanchez-Greenfield",
        aliases: ["sanchez", "greenfield"],
        label: "Sanchez-Greenfield",
        keyterm: "Sanchez-Greenfield",
        // The card the live screen puts on screen when this name is heard.
        players: [
          {
            jersey: "3",
            first_name: null,
            last_name: "Sanchez-Greenfield",
            position: null,
            grade: null,
            height: null,
            weight: null,
            side: "H",
            stat_lines: [],
          },
        ],
      },
    ]);
  });

  it("drops a hyphen part that is another player's whole surname", () => {
    const { entries, droppedParts } = buildGameWatchlist(
      [player("3", "Sanchez-Greenfield")],
      [player("9", "Sanchez")],
    );
    expect(entries.find((entry) => entry.name === "Sanchez-Greenfield")?.aliases).toEqual(["greenfield"]);
    expect(droppedParts).toEqual([
      { from: "Sanchez-Greenfield", part: "sanchez", collidesWith: "Sanchez" },
    ]);
  });

  it("keeps hyphen parts when nothing collides", () => {
    const { entries, droppedParts } = buildGameWatchlist([player("3", "Sanchez-Greenfield")], [player("9", "Okafor")]);
    expect(entries.find((entry) => entry.name === "Sanchez-Greenfield")?.aliases).toEqual(["sanchez", "greenfield"]);
    expect(droppedParts).toEqual([]);
  });

  it("dedupes keyterms in roster order, home first", () => {
    const { keyterms } = buildGameWatchlist(
      [player("10", "Williams"), player("23", "Williams"), player("7", "Tremaine")],
      [player("4", "Williams"), player("1", "Okafor")],
    );
    expect(keyterms).toEqual(["Williams", "Tremaine", "Okafor"]);
  });

  it("uses the first player's spelling when only case differs", () => {
    const { entries, keyterms } = buildGameWatchlist([player("2", "McBride")], [player("5", "MCBRIDE")]);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("McBride");
    expect(keyterms).toEqual(["McBride"]);
  });

  it("recomputes forms for a roster saved without them", () => {
    const { entries } = buildGameWatchlist([{ jersey: "3", last_name: "Sanchez-Greenfield", spoken_forms: [] }], []);
    expect(entries[0].aliases).toEqual(["sanchez", "greenfield"]);
  });

  it("returns nothing for two empty rosters", () => {
    expect(buildGameWatchlist([], [])).toEqual({ entries: [], keyterms: [], droppedParts: [] });
  });
});

describe("findCrossPlayerCollisions", () => {
  it("reports a pair that would fire on each other", () => {
    const { entries } = buildGameWatchlist([player("1", "Clark")], [player("2", "Clarke")]);
    const collisions = findCrossPlayerCollisions(entries);
    expect(collisions).toHaveLength(1);
    expect([collisions[0].a, collisions[0].b].sort()).toEqual(["Clark", "Clarke"]);
  });

  it("reports each pair once, not twice", () => {
    const { entries } = buildGameWatchlist([player("1", "Smith")], [player("2", "Smyth")]);
    expect(findCrossPlayerCollisions(entries)).toHaveLength(1);
  });

  it("reports nothing for names that sound different", () => {
    const { entries } = buildGameWatchlist([player("1", "Tremaine")], [player("2", "Okafor")]);
    expect(findCrossPlayerCollisions(entries)).toEqual([]);
  });

  it("leaves Chen and Chin alone: the matcher's short-name rule already keeps them apart", () => {
    const { entries } = buildGameWatchlist([player("1", "Chen")], [player("2", "Chin")]);
    expect(findCrossPlayerCollisions(entries)).toEqual([]);
  });
});

describe("cards on the watchlist", () => {
  it("carries every card field through, so the live screen needs no fetch", () => {
    const { entries } = buildGameWatchlist(
      [
        {
          jersey: "12",
          first_name: "Marli",
          last_name: "Barnes",
          position: "RB",
          grade: "12",
          height: "5-6",
          weight: "140",
          spoken_forms: ["barnes"],
        },
      ],
      [],
    );
    expect(entries[0].players).toEqual([
      {
        jersey: "12",
        first_name: "Marli",
        last_name: "Barnes",
        // Nothing on screen shows it. The play feed reads it.
        position: "RB",
        grade: "12",
        height: "5-6",
        weight: "140",
        side: "H",
        stat_lines: [],
      },
    ]);
  });

  it("keeps a card per player when a surname is shared, in roster order", () => {
    const { entries } = buildGameWatchlist(
      [{ jersey: "10", last_name: "Williams", spoken_forms: ["williams"] }],
      [{ jersey: "4", last_name: "Williams", spoken_forms: ["williams"] }],
    );
    // One entry, because the engine matches a sound. Two cards, because only a
    // person can tell which of them was called.
    expect(entries).toHaveLength(1);
    expect(entries[0].players?.map((player) => [player.jersey, player.side])).toEqual([
      ["10", "H"],
      ["4", "A"],
    ]);
  });
});

describe("stat lines on the watchlist", () => {
  it("carries them through, so a spotted player's card has them without a fetch", () => {
    const { entries } = buildGameWatchlist(
      [
        {
          jersey: "8",
          last_name: "Mikail",
          spoken_forms: ["mikail"],
          stat_lines: ["826 pass yds, 10 TD, 1 INT", "77-128 passing, 60.2%"],
        },
      ],
      [],
    );
    expect(entries[0].players?.[0].stat_lines).toEqual([
      "826 pass yds, 10 TD, 1 INT",
      "77-128 passing, 60.2%",
    ]);
  });

  it("defaults to none, so a roster saved before stats existed still loads", () => {
    const { entries } = buildGameWatchlist(
      [{ jersey: "1", last_name: "Brooks", spoken_forms: ["brooks"] }],
      [],
    );
    expect(entries[0].players?.[0].stat_lines).toEqual([]);
  });
});

describe("buildGameWatchlist and spotting settings", () => {
  it("leaves a player set to off out of the watchlist and the jersey index", () => {
    const { entries, keyterms } = buildGameWatchlist(
      [player("72", "Okafor"), player("22", "Langan")].map((p, i) => (i === 0 ? { ...p, spot_mode: "off" as const } : p)),
      [],
    );
    expect(entries.map((entry) => entry.name)).toEqual(["Langan"]);
    expect(keyterms).toEqual(["Langan"]);
    expect(buildJerseyIndex(entries).byJersey.has("72")).toBe(false);
  });

  it("carries exact-only on the entry, and only when it is set", () => {
    const { entries } = buildGameWatchlist(
      [{ ...player("5", "Longhi"), spot_mode: "exact_only" }, { ...player("22", "Langan"), spot_mode: "normal" }],
      [],
    );
    expect(entries.find((entry) => entry.name === "Longhi")?.exactOnly).toBe(true);
    expect(entries.find((entry) => entry.name === "Langan")).not.toHaveProperty("exactOnly");
  });

  it("marks a shared surname exact-only when any player with it is, because they share its sound", () => {
    const { entries } = buildGameWatchlist(
      [{ ...player("10", "Aragon"), spot_mode: "exact_only" }],
      [{ ...player("44", "Aragon"), spot_mode: "normal" }],
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].exactOnly).toBe(true);
  });
});
