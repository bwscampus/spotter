import { describe, expect, it } from "vitest";
import { cardLines, lineText, type CardLines } from "@/lib/cards/lines";
import { EMPTY_SESSION, linesOf, okPlay, readPlays, UNSURE_BELOW, undoLast } from "@/lib/livestats/session";
import type { StatsEvent, StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";

// A ~ on any stat Spotter is not sure of (Jed, Oct 3, testrun): yards worked
// out from yard lines or phrasing, as before, and now everything from a play
// Claude rated as unsure. On tonight's line and on the season total it went
// into, for as long as that play counts, and kept through the Oct 3 card
// redesign. Made-up names only.

const text = (line: CardLines | undefined) => line && { season: lineText(line.season), tonight: lineText(line.tonight) };

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB", season: { gp: 5, rush_att: 71, rush_yds: 455 } },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB", season: { gp: 5, tkl: 38 } },
];

const ev = (playerId: string, action: StatsEvent["action"], yards: number | null = null): StatsEvent => ({
  playerId,
  action,
  yards,
  yardsSource: yards === null ? null : "stated",
  made: null,
});

function run(seq: number, confidence: number): StatsPlay {
  return {
    // A line apart, so consecutive runs are separate plays, not later reads of one (lib/livestats/merge.ts).
    seqStart: seq * 3,
    seqEnd: seq * 3 + 1,
    quarter: 2,
    clock: null,
    down: 2,
    distance: 6,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence,
    summary: `run ${seq}`,
    evidence: "fennimore up the middle, quillon on the stop",
    events: [ev("H22-FENNIMORE", "rush", 8), ev("A17-QUILLON", "tackle")],
  };
}

/** Reads the plays in and OKs each, the way testrun counts them. */
function counted(...plays: StatsPlay[]) {
  let session = readPlays(EMPTY_SESSION, plays, ROSTER, 0).session;
  for (let i = 0; i < plays.length; i++) session = okPlay(session, i + 1).session;
  return session;
}

describe("a play Claude was unsure of", () => {
  it(`marks every stat it adds when rated under ${UNSURE_BELOW}`, () => {
    const { added } = readPlays(EMPTY_SESSION, [run(0, 0.45)], ROSTER, 0);
    expect(added[0].changes.map((change) => [change.key, change.estimated])).toEqual([
      ["rush_att", true],
      ["rush_yds", true],
      ["tkl", true],
    ]);
  });

  it("leaves a sure play's said numbers unmarked", () => {
    const { added } = readPlays(EMPTY_SESSION, [run(0, 0.9)], ROSTER, 0);
    expect(added[0].changes.every((change) => !change.estimated)).toBe(true);
  });

  it("puts the ~ on counts as well as yards, tonight and on the season total", () => {
    const lines = linesOf(counted(run(0, 0.45)), ROSTER);
    expect(text(lines.get("H22-FENNIMORE"))).toEqual({ season: "~72 car · ~463 yds", tonight: "~1 car · ~8 yds" });
    expect(text(lines.get("A17-QUILLON"))).toEqual({ season: "~39 tkl", tonight: "~1 tkl" });
    expect(lines.get("A17-QUILLON")?.season).toEqual([{ value: "39", label: "tkl", estimated: true, rank: 0, group: 0 }]);
  });

  it("keeps the ~ for the rest of the game, through plays that were sure", () => {
    const lines = linesOf(counted(run(0, 0.45), run(1, 0.95), run(2, 0.9)), ROSTER);
    expect(text(lines.get("H22-FENNIMORE"))?.tonight).toBe("~3 car · ~24 yds");
    expect(text(lines.get("A17-QUILLON"))?.season).toBe("~41 tkl");
  });

  it("goes when that play stops counting, because tonight is always worked out from the plays that count", () => {
    let session = counted(run(0, 0.95), run(1, 0.45));
    session = undoLast(session, 10).session;
    expect(text(linesOf(session, ROSTER).get("A17-QUILLON"))?.tonight).toBe("1 tkl");
  });
});

describe("the lines", () => {
  it("put one ~ in front of a pair when either side of it is unsure", () => {
    expect(text(cardLines(null, { stats: { pass_cmp: 8, pass_att: 11, pass_yds: 96 }, estimated: ["pass_att"] }))?.tonight).toBe(
      "~8-11 · 96 yds",
    );
    expect(text(cardLines(null, { stats: { fgm: 2, fga: 3 }, estimated: ["fgm"] }))?.tonight).toBe("~2-3 FG");
  });

  it("show no ~ at all when nothing is unsure", () => {
    expect(text(cardLines({ rush_att: 71, rush_yds: 455 }, { stats: { rush_att: 1, rush_yds: 8 }, estimated: [] }))).toEqual({
      season: "72 car · 463 yds",
      tonight: "1 car · 8 yds",
    });
  });
});
