import { describe, expect, it, vi } from "vitest";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import type { TonightTally } from "@/lib/cards/tonight";
import { reachedOf, type SessionPlay, type StatsSession } from "@/lib/livestats/session";
import { fitCategory, fitText, numberPx, type PanelMeasure } from "@/lib/panel/fit";
import { panelFits } from "@/lib/panel/fits";
import { LEADER_NAME_WIDTH_PX, OPPONENT_WIDTH_PX, rowsThatFit } from "@/lib/panel/layout";
import { hasLeaders, NO_LEADER, seasonLeaders, tonightLeaders, type TonightBoard } from "@/lib/panel/leaders";
import { createThrottle } from "@/lib/panel/throttle";
import { NO_SCHEDULE_TEXT, scheduleView, streakLine } from "@/lib/panel/view";
import type { ScheduleGame } from "@/lib/schedule/types";

// =============================================================================
// The team panel's pure parts (docs/PANEL_SPEC.md): how many games fit a half,
// how a name steps down and wraps without being cut, who leads each box, when
// a player reached their total, the half's words, and the 500ms throttle.
// Every player and school here is made up.
// =============================================================================

/** A stand-in for the canvas: every character 0.6em wide, a bold one a little wider. */
const measure: PanelMeasure = (text, weight, px) => [...text].length * px * (weight >= 700 ? 0.6 : 0.55);

describe("how many games fit a half", () => {
  it("is what is left of the half's fixed height, in 21px rows", () => {
    // 14+14 padding, a 60px band, 10, an 18px label, 4+18 for the streak, then 10 and 102 for the leaders.
    expect(rowsThatFit(445, { leaders: true })).toBe(9);
    expect(rowsThatFit(445, { leaders: false })).toBe(14);
    expect(rowsThatFit(270, { leaders: true })).toBe(0);
    expect(rowsThatFit(0, { leaders: true })).toBe(0);
  });

  it("depends on the height alone, never on what the rows say", () => {
    expect(rowsThatFit(500, { leaders: true })).toBe(rowsThatFit(500, { leaders: true }));
    expect(rowsThatFit(250 + 21 * 3, { leaders: true })).toBe(3);
    expect(rowsThatFit(250 + 21 * 3 - 1, { leaders: true })).toBe(2);
  });
});

describe("a leader's name", () => {
  const options = { widthPx: LEADER_NAME_WIDTH_PX, maxPx: 15, minPx: 10, weight: 700, wrap: true };

  it("stays at 15px when it fits", () => {
    expect(fitText("Brandt", measure, options)).toEqual({ px: 15, lines: ["Brandt"], overflow: false });
  });

  it("steps down 1px at a time until it fits", () => {
    const fit = fitText("Castellanos", measure, options);
    expect(fit.px).toBe(13);
    expect(fit.lines).toEqual(["Castellanos"]);
  });

  it("below 10px wraps at its hyphen, and is never cut", () => {
    const fit = fitText("Vanderkellen-Ruiz", measure, options);
    expect(fit).toEqual({ px: 10, lines: ["Vanderkellen-", "Ruiz"], overflow: false });
    for (const line of fit.lines) expect(measure(line, 700, fit.px)).toBeLessThanOrEqual(LEADER_NAME_WIDTH_PX);
    expect(fit.lines.join("")).toBe("Vanderkellen-Ruiz");
  });

  it("with no hyphen or space, wraps onto two lines and keeps every letter", () => {
    const fit = fitText("Vanderkellenruizson", measure, options);
    expect(fit.px).toBe(10);
    expect(fit.lines).toHaveLength(2);
    expect(fit.lines.join("")).toBe("Vanderkellenruizson");
    for (const line of fit.lines) expect(measure(line, 700, 10)).toBeLessThanOrEqual(LEADER_NAME_WIDTH_PX);
  });

  it("wraps at a space when it has one", () => {
    expect(fitText("Van Der Kellenberg", measure, options).lines).toEqual(["Van Der", "Kellenberg"]);
  });

  it("an opponent, whose row cannot wrap, steps down and only then ends in an ellipsis", () => {
    const row = { widthPx: OPPONENT_WIDTH_PX, maxPx: 14, minPx: 10, weight: 600, wrap: false };
    expect(fitText("Harlow Ridge", measure, row)).toEqual({ px: 14, lines: ["Harlow Ridge"], overflow: false });
    expect(fitText("Saint Bartholomew of the Valley Prep", measure, row).overflow).toBe(true);
  });

  it("is fitted once for every surname on both rosters", () => {
    const fits = panelFits(
      { roster: ROSTER, away: { school: "Kettle Creek", view: scheduleView([], null) }, home: { school: "Delmar", view: scheduleView([], null) } },
      measure,
    );
    expect([...fits.names.keys()]).toEqual(["Brandt", "Okafor", "Vanderkellen-Ruiz", "Pruett", "Lindqvist"]);
    expect(fits.names.get("Vanderkellen-Ruiz")!.lines).toEqual(["Vanderkellen-", "Ruiz"]);
  });
});

describe("a leader's category line", () => {
  const options = { widthPx: LEADER_NAME_WIDTH_PX, maxPx: 11, minPx: 9, twoLineMaxPx: 10 };

  it("stays one line at 11px when it fits", () => {
    expect(fitCategory("REC · 3 rec", measure, options)).toEqual({ px: 11, lines: ["REC · 3 rec"], overflow: false });
  });

  it("steps down for bigger numbers", () => {
    const fit = fitCategory("RUSH · 140 car", measure, options);
    expect(fit).toEqual({ px: 10, lines: ["RUSH · 140 car"], overflow: false });
  });

  it("breaks after its comma when even 9px is too wide, and every line fits", () => {
    const fit = fitCategory("RUSH · 140 car, 11 TD", measure, options);
    expect(fit.lines).toEqual(["RUSH · 140 car,", "11 TD"]);
    expect(fit.px).toBeLessThanOrEqual(10);
    for (const line of fit.lines) expect(measure(line, 700, fit.px)).toBeLessThanOrEqual(LEADER_NAME_WIDTH_PX);
  });
});

describe("a big number", () => {
  it("steps down until it fits the 58px column", () => {
    const advances = new Map([..."0123456789,-~–"].map((char) => [char, 60]));
    expect(numberPx("212", advances, 58, 26, 14)).toBe(26);
    expect(numberPx("2,431", advances, 58, 26, 14)).toBe(19);
    expect(numberPx("212", null, 58, 26, 14)).toBe(26);
  });
});

// -----------------------------------------------------------------------------
// The leaders
// -----------------------------------------------------------------------------

function player(playerId: string, side: "home" | "away", last: string, season: KeyedPlayer["season"] = null): KeyedPlayer {
  return { playerId, side, jersey: playerId.replace(/\D/g, ""), first: null, last, position: null, season };
}

const ROSTER: KeyedPlayer[] = [
  player("H7-BRANDT", "home", "Brandt", { pass_yds: 1840, pass_cmp: 120, pass_att: 190, rush_yds: 60, rush_att: 22 }),
  player("H22-OKAFOR", "home", "OKAFOR", { rush_yds: 902, rush_att: 140, rush_td: 11, rec: 12, rec_yds: 95, tkl: 0 }),
  player("H4-VANDERKELLEN-RUIZ", "home", "Vanderkellen-Ruiz", { rec: 40, rec_yds: 610 }),
  player("H44-PRUETT", "home", "Pruett", { tkl: 61 }),
  player("A9-LINDQVIST", "away", "Lindqvist", { pass_yds: 900, pass_cmp: 70, pass_att: 120 }),
];

function tally(stats: TonightTally["stats"], estimated: TonightTally["estimated"] = []): TonightTally {
  return { stats, estimated };
}

describe("tonight's leaders", () => {
  it("is the player on the team with the most of the big number, with the supporting line", () => {
    const board: TonightBoard = {
      tallies: new Map([
        ["H7-BRANDT", tally({ pass_yds: 140, pass_cmp: 9, pass_att: 14, rush_yds: 12, rush_att: 3 })],
        ["H22-OKAFOR", tally({ rush_yds: 88, rush_att: 14, rush_td: 1, rec: 3, rec_yds: 31, tkl: 1 })],
        ["H44-PRUETT", tally({ tkl: 6 })],
        ["A9-LINDQVIST", tally({ pass_yds: 200, pass_cmp: 12, pass_att: 20 })],
      ]),
      reached: new Map(),
    };
    const boxes = tonightLeaders(board, ROSTER, "home");
    expect(boxes.map((box) => [box.category, box.number, box.unit, box.support, box.name])).toEqual([
      ["PASS", "140", "YDS", "9-14", "Brandt"],
      ["RUSH", "88", "YDS", "14 car, 1 TD", "Okafor"],
      ["REC", "31", "YDS", "3 rec", "Okafor"],
      ["TKL", "6", "TKL", "", "Pruett"],
    ]);
    // The other side is its own.
    expect(tonightLeaders(board, ROSTER, "away")[0]).toMatchObject({ number: "200", name: "Lindqvist" });
  });

  it("leaves the TD out when there is none", () => {
    const board: TonightBoard = { tallies: new Map([["H22-OKAFOR", tally({ rush_yds: 40, rush_att: 6 })]]), reached: new Map() };
    expect(tonightLeaders(board, ROSTER, "home")[1].support).toBe("6 car");
  });

  it("gives a tie to whoever reached it first", () => {
    const board: TonightBoard = {
      tallies: new Map([
        ["H22-OKAFOR", tally({ tkl: 4 })],
        ["H44-PRUETT", tally({ tkl: 4 })],
      ]),
      reached: new Map([
        ["H22-OKAFOR", { tkl: 120 }],
        ["H44-PRUETT", { tkl: 80 }],
      ]),
    };
    expect(tonightLeaders(board, ROSTER, "home")[3].name).toBe("Pruett");
    const later: TonightBoard = { ...board, reached: new Map([["H22-OKAFOR", { tkl: 60 }], ["H44-PRUETT", { tkl: 80 }]]) };
    expect(tonightLeaders(later, ROSTER, "home")[3].name).toBe("Okafor");
  });

  it("marks a number with any estimated part with the cards' ~", () => {
    const board: TonightBoard = {
      tallies: new Map([["H7-BRANDT", tally({ pass_yds: 140, pass_cmp: 9, pass_att: 14 }, ["pass_yds", "pass_att"])]]),
      reached: new Map(),
    };
    expect(tonightLeaders(board, ROSTER, "home")[0]).toMatchObject({ number: "~140", support: "~9-14" });
  });

  it("shows – and no name before anyone has a stat in a category", () => {
    const empty: TonightBoard = { tallies: new Map(), reached: new Map() };
    for (const box of tonightLeaders(empty, ROSTER, "home")) {
      expect(box).toMatchObject({ number: NO_LEADER, support: "", name: null });
    }
  });

  it("counts a player with a stat in the category even at zero yards", () => {
    const board: TonightBoard = { tallies: new Map([["H22-OKAFOR", tally({ rush_att: 2, rush_yds: -3 })]]), reached: new Map() };
    expect(tonightLeaders(board, ROSTER, "home")[1]).toMatchObject({ number: "-3", support: "2 car", name: "Okafor" });
  });
});

describe("the season's leaders, for a game without live stats", () => {
  it("come from the uploaded season stats, thousands with a comma", () => {
    const boxes = seasonLeaders(ROSTER, "home");
    expect(boxes.map((box) => [box.number, box.support, box.name])).toEqual([
      ["1,840", "120-190", "Brandt"],
      ["902", "140 car, 11 TD", "Okafor"],
      ["610", "40 rec", "Vanderkellen-Ruiz"],
      ["61", "", "Pruett"],
    ]);
  });

  it("are left out for a sport without these categories", () => {
    expect(hasLeaders("football")).toBe(true);
    expect(hasLeaders("volleyball")).toBe(false);
    expect(hasLeaders(null)).toBe(false);
  });
});

describe("when a player reached their total", () => {
  function play(seqStart: number, changes: Array<[string, string, number]>, status = "applied"): SessionPlay {
    return {
      status,
      play: { seqStart },
      changes: changes.map(([playerId, key, amount]) => ({ playerId, key, amount, estimated: false })),
    } as unknown as SessionPlay;
  }

  it("is the line of the last counted play that changed it", () => {
    const session: StatsSession = {
      plays: [
        play(10, [["H22-OKAFOR", "tkl", 1]]),
        play(30, [["H44-PRUETT", "tkl", 1]]),
        play(50, [["H22-OKAFOR", "rush_yds", 8], ["H22-OKAFOR", "rush_att", 1]]),
        play(70, [["H44-PRUETT", "tkl", 1]], "discarded"),
      ],
      boothLines: [],
    };
    const reached = reachedOf(session);
    expect(reached.get("H22-OKAFOR")).toEqual({ tkl: 10, rush_yds: 50 });
    expect(reached.get("H44-PRUETT")).toEqual({ tkl: 30 });
  });

  it("takes a booth line's line when it set the total, and ignores a play it already counted", () => {
    const session: StatsSession = {
      plays: [play(10, [["H7-BRANDT", "pass_yds", 20]]), play(40, [["H7-BRANDT", "pass_yds", 15]])],
      boothLines: [{ seq: 25, playerId: "H7-BRANDT", key: "pass_yds", value: 60, scope: "game", had: 20 } as never],
    };
    // 20 at line 10, the booth's 60 at line 25, then 75 at line 40.
    expect(reachedOf(session).get("H7-BRANDT")).toEqual({ pass_yds: 40 });
    const noLater: StatsSession = { ...session, plays: [session.plays[0]!] };
    expect(reachedOf(noLater).get("H7-BRANDT")).toEqual({ pass_yds: 25 });
  });

  it("is in the order said, not the order read", () => {
    const session: StatsSession = { plays: [play(50, [["H22-OKAFOR", "tkl", 1]]), play(20, [["H22-OKAFOR", "tkl", -1]])], boothLines: [] };
    expect(reachedOf(session).get("H22-OKAFOR")).toEqual({ tkl: 50 });
  });
});

// -----------------------------------------------------------------------------
// The half's words, and the throttle
// -----------------------------------------------------------------------------

describe("a half's schedule", () => {
  const games: ScheduleGame[] = [
    { date: "2026-10-23", opponent: "Kettle Creek", site: "A", teamScore: 24, opponentScore: 21, league: true },
    { date: "2026-10-16", opponent: "Harlow Ridge", site: "H", teamScore: 10, opponentScore: 17, league: false },
    { date: "2026-11-06", opponent: "Coastline", site: "N", teamScore: null, opponentScore: null, league: true },
  ];

  it("has the record, the league record, the rows newest first, the streak and the next game", () => {
    const view = scheduleView(games, "2026-10-28");
    expect(view).toMatchObject({ hasSchedule: true, record: "1-1", league: "1-0 league", streak: "Won 1", next: "Fri Nov 6 vs Coastline" });
    expect(view.rows.map((row) => [row.date, row.result, row.site, row.opponent, row.score])).toEqual([
      ["Oct 23", "W", "@", "Kettle Creek", "24-21"],
      ["Oct 16", "L", "vs", "Harlow Ridge", "10-17"],
    ]);
    expect(streakLine(view)).toBe("Won 1 · Next: Fri Nov 6 vs Coastline");
  });

  it("shows the streak only when no game is left, and no league line without league games", () => {
    const view = scheduleView(games.slice(0, 2), "2026-10-28");
    expect(streakLine(view)).toBe("Won 1");
    expect(view.league).toBe("1-0 league");
    expect(scheduleView([games[1]!], "2026-10-28").league).toBe("");
  });

  it("says there is none with no schedule saved", () => {
    expect(scheduleView(undefined, "2026-10-28")).toMatchObject({ hasSchedule: false, record: "", rows: [] });
    expect(NO_SCHEDULE_TEXT).toBe("No schedule. Add one on the team page.");
  });
});

describe("the panel's throttle", () => {
  it("runs at once, then at most once every 500ms, folding the pokes in between into one", () => {
    vi.useFakeTimers();
    try {
      const run = vi.fn();
      const throttle = createThrottle(run, 500, {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      });
      throttle.poke();
      expect(run).toHaveBeenCalledTimes(1);
      throttle.poke();
      throttle.poke();
      vi.advanceTimersByTime(499);
      expect(run).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(run).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(600);
      throttle.poke();
      expect(run).toHaveBeenCalledTimes(3);
      throttle.poke();
      throttle.cancel();
      vi.advanceTimersByTime(1000);
      expect(run).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
