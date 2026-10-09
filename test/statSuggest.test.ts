import { describe, expect, it } from "vitest";
import { suggestPlayers, suggestStats, typedAmount } from "@/lib/livestats/suggest";
import type { StatsRosterPlayer } from "@/lib/livestats/types";

// What a correction box offers as it is typed in (Jed, Oct 8: click a player,
// stat or number and type the new one, the prediction filled in). Made-up
// names only.

const player = (side: "home" | "away", jersey: string, last: string, first: string | null = null, position: string | null = null): StatsRosterPlayer => ({
  playerId: `${side === "home" ? "H" : "A"}${jersey}-${last.toUpperCase()}`,
  side,
  jersey,
  first,
  last,
  position,
});

const ROSTER = [
  player("home", "22", "Fennimore", "Reed", "RB"),
  player("home", "7", "Larkspur", "Gus", "QB"),
  player("home", "81", "Lannister", "Ty", "WR"),
  player("away", "22", "Quillon", "Ash", "LB"),
  player("away", "5", "Fenwick", "Lars", "DB"),
];

const ids = (players: readonly StatsRosterPlayer[]) => players.map((p) => p.playerId);

describe("a player box", () => {
  it("offers the predicted player first while it is untouched, then their side, by number", () => {
    expect(ids(suggestPlayers(ROSTER, "FENNIMORE #22", "H22-FENNIMORE"))).toEqual([
      "H22-FENNIMORE",
      "H7-LARKSPUR",
      "H81-LANNISTER",
      "A5-FENWICK",
      "A22-QUILLON",
    ]);
    expect(suggestPlayers(ROSTER, "", "A22-QUILLON")[0].playerId).toBe("A22-QUILLON");
  });

  it("takes a number as the jersey, both teams, the predicted side first", () => {
    expect(ids(suggestPlayers(ROSTER, "22", "A5-FENWICK"))).toEqual(["A22-QUILLON", "H22-FENNIMORE"]);
    expect(ids(suggestPlayers(ROSTER, "#22", "H7-LARKSPUR"))).toEqual(["H22-FENNIMORE", "A22-QUILLON"]);
  });

  it("ties a name and a number together: both must match the same player", () => {
    expect(ids(suggestPlayers(ROSTER, "22 fen", "H7-LARKSPUR"))).toEqual(["H22-FENNIMORE"]);
    expect(suggestPlayers(ROSTER, "5 fennimore", "H7-LARKSPUR")).toEqual([]);
  });

  it("puts a surname's start ahead of a first name's, and a first name ahead of a surname's middle", () => {
    // "lar": Larkspur's surname starts with it, Lars Fenwick's first name does.
    expect(ids(suggestPlayers(ROSTER, "lar", "H22-FENNIMORE"))).toEqual(["H7-LARKSPUR", "A5-FENWICK"]);
    // "nni": only in the middle of two surnames.
    expect(ids(suggestPlayers(ROSTER, "nni", "H22-FENNIMORE"))).toEqual(["H22-FENNIMORE", "H81-LANNISTER"]);
  });

  it("offers nobody for a name on neither roster", () => {
    expect(suggestPlayers(ROSTER, "zzz", "H22-FENNIMORE")).toEqual([]);
  });
});

describe("a stat box", () => {
  it("offers the predicted stat first while it is untouched, and every other after it", () => {
    const offered = suggestStats("CAR", "rush_att");
    expect(offered[0]).toBe("rush_att");
    expect(offered).toContain("tkl");
    expect(offered).not.toContain("gp");
    expect(new Set(offered).size).toBe(offered.length);
  });

  it("finds a stat by its label, its key or the word an announcer would type", () => {
    expect(suggestStats("tkl", "rush_att")[0]).toBe("tkl");
    expect(suggestStats("tackle", "rush_att")[0]).toBe("tkl");
    expect(suggestStats("carry", "rec")[0]).toBe("rush_att");
    expect(suggestStats("rec yds", "rec")[0]).toBe("rec_yds");
    expect(suggestStats("catch", "tkl").slice(0, 3)).toContain("rec");
  });

  it("offers nothing for a word no stat has", () => {
    expect(suggestStats("qqq", "tkl")).toEqual([]);
  });
});

describe("a number box", () => {
  it("reads the number typed, the strip's + and ~ included", () => {
    expect(typedAmount("12")).toEqual({ ok: true, amount: 12 });
    expect(typedAmount("+8")).toEqual({ ok: true, amount: 8 });
    expect(typedAmount("~8")).toEqual({ ok: true, amount: 8 });
    expect(typedAmount("-3")).toEqual({ ok: true, amount: -3 });
  });

  it("takes blank or ? as not known, and anything else as nothing", () => {
    expect(typedAmount("")).toEqual({ ok: true, amount: null });
    expect(typedAmount("?")).toEqual({ ok: true, amount: null });
    expect(typedAmount("eight")).toEqual({ ok: false });
  });
});
