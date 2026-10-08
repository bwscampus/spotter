import { describe, expect, it } from "vitest";
import type { StatChange } from "@/lib/cards/tonight";
import { amountText, changesText, chipText, header } from "@/lib/livestats/describe";
import type { StatsRosterPlayer } from "@/lib/livestats/types";

// What the strip says about each play: one comma-separated item per change,
// "LANGAN #22 +1 CAR, LANGAN #22 +8 RUSH YDS, OSSUETTA #17 +1 TKL" in Jed's
// words, and the chip on a card a play just added to. Made-up names only.

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

const change = (playerId: string, key: StatChange["key"], amount: number | null, estimated = false): StatChange => ({
  playerId,
  key,
  amount,
  estimated,
});

describe("the strip's items", () => {
  it("is one item per change, each naming the player, the amount and the stat", () => {
    const run = [change("H22-FENNIMORE", "rush_att", 1), change("H22-FENNIMORE", "rush_yds", 8), change("A17-QUILLON", "tkl", 1)];
    expect(header({ quarter: 2, down: 3, distance: 4 })).toBe("Q2 3rd & 4");
    expect(changesText(run, ROSTER)).toBe("FENNIMORE #22 +1 CAR, FENNIMORE #22 +8 RUSH YDS, QUILLON #17 +1 TKL");
  });

  it("marks worked-out yards with ~, unknown yards with ?, losses with -, and a long field goal with no sign", () => {
    expect(amountText(change("x", "rush_yds", 6, true))).toBe("~6");
    expect(amountText(change("x", "rush_yds", null))).toBe("?");
    expect(amountText(change("x", "rush_yds", -7))).toBe("-7");
    expect(amountText(change("x", "sacks", 0.5))).toBe("+0.5");
    expect(amountText(change("x", "fg_long", 42))).toBe("42");
  });

  it("names a player who is on neither roster by the id Claude gave", () => {
    expect(changesText([change("H99-NOBODY", "tkl", 1)], ROSTER)).toContain("H99-NOBODY");
  });
});

describe("the chip on a card", () => {
  it("is that player's part of the play, short", () => {
    expect(chipText([change("H22-FENNIMORE", "rush_att", 1), change("H22-FENNIMORE", "rush_yds", 8)])).toBe("+1 CAR +8");
    expect(chipText([change("A17-QUILLON", "tkl", 1)])).toBe("+1 TKL");
    expect(chipText([change("H22-FENNIMORE", "rush_att", 1), change("H22-FENNIMORE", "rush_yds", 6, true)])).toBe("+1 CAR ~6");
  });

  it("leaves out yards nobody said", () => {
    expect(chipText([change("H22-FENNIMORE", "rush_att", 1), change("H22-FENNIMORE", "rush_yds", null)])).toBe("+1 CAR");
  });
});
