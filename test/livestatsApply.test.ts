import { describe, expect, it } from "vitest";
import { applyPlay, droppedByRule, tonightTotals, type AppliedPlay } from "@/lib/livestats/apply";
import { statsRoster } from "@/lib/livestats/roster";
import type { Action, StatsEvent, StatsPlay, YardsSource } from "@/lib/livestats/types";
import type { FootballStats } from "@/lib/cards/statKeys";

// =============================================================================
// The stat rules, docs/V3_DEFINITION.md 8.3, one at a time, plus the two
// Sept 25 bugs (8.4) that the rules exist to fix. Names are made up; the
// Sept 25 surnames only appear in the two bug tests that name them.
// =============================================================================

const ROSTER = statsRoster(
  [
    { jersey: "7", first_name: "Dev", last_name: "Mikail", position: "QB" },
    { jersey: "22", first_name: "Sam", last_name: "Langan", position: "RB" },
    { jersey: "81", first_name: "Rio", last_name: "Quell", position: "WR" },
    { jersey: "3", first_name: "Kit", last_name: "Boot", position: "K" },
    // An offensive lineman: spotting off, never a card, still creditable (R9).
    { jersey: "66", first_name: "Big", last_name: "Hollis", position: "OL" },
  ],
  [
    { jersey: "44", first_name: "Abe", last_name: "Keslow", position: "LB" },
    { jersey: "17", first_name: "Jo", last_name: "Ossuetta", position: "DB" },
    { jersey: "21", first_name: "Cy", last_name: "Vargas", position: "DB" },
    { jersey: "90", first_name: "Tim", last_name: "Drue", position: "DL" },
    { jersey: "5", first_name: "Lee", last_name: "Pell", position: "WR" },
  ],
);

const QB = "H7-MIKAIL";
const RB = "H22-LANGAN";
const WR = "H81-QUELL";
const K = "H3-BOOT";
const OL = "H66-HOLLIS";
const LB = "A44-KESLOW";
const DB = "A17-OSSUETTA";
const VARGAS = "A21-VARGAS";
const DL = "A90-DRUE";
const RET = "A5-PELL";

function ev(playerId: string, action: Action, yards: number | null = null, yardsSource: YardsSource | null = yards === null ? null : "stated", made: boolean | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource, made };
}

let seq = 0;
function play(events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  seq += 1;
  return {
    seqStart: seq,
    seqEnd: seq,
    quarter: 2,
    clock: null,
    down: 3,
    distance: 4,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: `play ${seq}`,
    evidence: "",
    events,
    ...extra,
  };
}

function statsOf(applied: AppliedPlay, playerId: string): FootballStats {
  return applied.deltas.find((delta) => delta.playerId === playerId)?.stats ?? {};
}

function rules(applied: AppliedPlay): string[] {
  return applied.dropped.map((drop) => `${drop.rule} ${drop.event.action}`);
}

describe("the Sept 25 bugs (spec 8.4)", () => {
  it('"fumble, scooped up by Vargas" gives Vargas +1 FR and 0 CAR', () => {
    const applied = applyPlay(
      play([ev(RB, "rush", 3), ev(RB, "fumble"), ev(VARGAS, "fumble_recovery", 0)]),
      ROSTER,
    );
    expect(statsOf(applied, VARGAS)).toEqual({ fr: 1, fr_ret_yds: 0 });
    expect(statsOf(applied, VARGAS).rush_att).toBeUndefined();
  });

  it('"broken up by Ossuetta" gives +1 PBU and 0 TKL', () => {
    const applied = applyPlay(
      play([ev(QB, "pass_incomplete"), ev(DB, "pass_breakup"), ev(DB, "tackle")], { playType: "pass" }),
      ROSTER,
    );
    expect(statsOf(applied, DB)).toEqual({ pbu: 1 });
    expect(rules(applied)).toEqual(["R2 tackle"]);
  });
});

describe("R1: only a rush makes a carry", () => {
  it("a run is a carry with its yards", () => {
    expect(statsOf(applyPlay(play([ev(RB, "rush", 8)]), ROSTER), RB)).toEqual({ rush_att: 1, rush_yds: 8 });
  });

  it("a return, a recovery and a catch add no carry and no rushing yards", () => {
    const applied = applyPlay(
      play([ev(RET, "kick_return", 24), ev(VARGAS, "fumble_recovery", 5), ev(WR, "reception", 12)], { playType: "other" }),
      ROSTER,
    );
    for (const delta of applied.deltas) {
      expect(delta.stats.rush_att).toBeUndefined();
      expect(delta.stats.rush_yds).toBeUndefined();
    }
  });
});

describe("R2: a pass breakup is only a PBU", () => {
  it("drops every tackle on a play with an incomplete pass", () => {
    const applied = applyPlay(play([ev(QB, "pass_incomplete"), ev(LB, "tackle")], { playType: "pass" }), ROSTER);
    expect(statsOf(applied, QB)).toEqual({ pass_att: 1 });
    expect(statsOf(applied, LB)).toEqual({});
    expect(rules(applied)).toEqual(["R2 tackle"]);
  });

  it("drops the tackle even when the breakup is by a player the roster does not have", () => {
    const applied = applyPlay(play([ev("A99-GHOST", "pass_breakup"), ev(LB, "tackle")], { playType: "pass" }), ROSTER);
    expect(rules(applied)).toEqual(["R9 pass_breakup", "R2 tackle"]);
  });
});

describe("R3: a tackle needs a ball carrier", () => {
  it("drops a tackle on a punt nobody returned", () => {
    const applied = applyPlay(play([ev(K, "punt", 40), ev(LB, "tackle")], { playType: "punt" }), ROSTER);
    expect(statsOf(applied, K)).toEqual({ punts: 1, punt_yds: 40 });
    expect(rules(applied)).toEqual(["R3 tackle"]);
  });

  it("keeps tackles on a run, a catch, a return and a turnover return", () => {
    const cases: StatsEvent[][] = [
      [ev(RB, "rush", 4), ev(LB, "tackle")],
      [ev(WR, "reception", 9), ev(LB, "tackle")],
      [ev(RET, "punt_return", 11), ev(OL, "tackle")],
      [ev(VARGAS, "interception", 15), ev(QB, "tackle")],
    ];
    for (const events of cases) {
      const applied = applyPlay(play(events, { playType: "other" }), ROSTER);
      expect(applied.dropped).toEqual([]);
    }
  });

  it("keeps a tackle on a run whose carrier was not named", () => {
    const applied = applyPlay(play([ev(LB, "tackle")], { playType: "run" }), ROSTER);
    expect(statsOf(applied, LB)).toEqual({ tkl: 1 });
  });
});

describe("R4: sacks, high school rule", () => {
  it("gives the defender a sack, a tackle and sack yards, and the quarterback a rush attempt with negative yards", () => {
    const applied = applyPlay(play([ev(QB, "sacked", 7), ev(DL, "sack", 7)], { playType: "sack" }), ROSTER);
    expect(statsOf(applied, DL)).toEqual({ sacks: 1, tkl: 1, sack_yds: 7 });
    expect(statsOf(applied, QB)).toEqual({ rush_att: 1, rush_yds: -7 });
  });

  it("takes the loss from whichever side said it, whatever its sign", () => {
    const applied = applyPlay(play([ev(QB, "sacked", -6), ev(DL, "sack")], { playType: "sack" }), ROSTER);
    expect(statsOf(applied, DL)).toEqual({ sacks: 1, tkl: 1, sack_yds: 6 });
    expect(statsOf(applied, QB)).toEqual({ rush_att: 1, rush_yds: -6 });
  });

  it("splits a shared sack evenly, with a tackle each", () => {
    const applied = applyPlay(play([ev(QB, "sacked", 8), ev(DL, "sack"), ev(LB, "sack")], { playType: "sack" }), ROSTER);
    expect(statsOf(applied, DL)).toEqual({ sacks: 0.5, tkl: 1, sack_yds: 4 });
    expect(statsOf(applied, LB)).toEqual({ sacks: 0.5, tkl: 1, sack_yds: 4 });
  });

  it("does not count the sacker's tackle twice", () => {
    const applied = applyPlay(play([ev(QB, "sacked", 5), ev(DL, "sack", 5), ev(DL, "tackle")], { playType: "sack" }), ROSTER);
    expect(statsOf(applied, DL).tkl).toBe(1);
    expect(rules(applied)).toEqual(["R4 tackle"]);
  });
});

describe("R5: interceptions", () => {
  it("gives the defender the pick and its return, the passer an attempt and an interception thrown, and nobody a catch", () => {
    const applied = applyPlay(
      play([ev(QB, "pass_intercepted"), ev(VARGAS, "interception", 23), ev(WR, "reception", 10)], { playType: "pass" }),
      ROSTER,
    );
    expect(statsOf(applied, VARGAS)).toEqual({ def_int: 1, int_ret_yds: 23 });
    expect(statsOf(applied, QB)).toEqual({ pass_att: 1, pass_int: 1 });
    expect(statsOf(applied, WR)).toEqual({});
    expect(rules(applied)).toEqual(["R5 reception"]);
  });
});

describe("R6: fumbles", () => {
  it("keeps the run's own stats, and gives the fumbler FUM and FUM LOST when the other side recovers", () => {
    const applied = applyPlay(
      play([ev(RB, "rush", 6), ev(RB, "fumble"), ev(LB, "forced_fumble"), ev(VARGAS, "fumble_recovery", 12)]),
      ROSTER,
    );
    expect(statsOf(applied, RB)).toEqual({ rush_att: 1, rush_yds: 6, fum: 1, fum_lost: 1 });
    expect(statsOf(applied, LB)).toEqual({ ff: 1 });
    expect(statsOf(applied, VARGAS)).toEqual({ fr: 1, fr_ret_yds: 12 });
  });

  it("is not lost when his own side falls on it, and a lineman can be the one who does", () => {
    const applied = applyPlay(play([ev(RB, "rush", 2), ev(RB, "fumble"), ev(OL, "fumble_recovery", 0)]), ROSTER);
    expect(statsOf(applied, RB)).toEqual({ rush_att: 1, rush_yds: 2, fum: 1 });
    expect(statsOf(applied, OL)).toEqual({ fr: 1, fr_ret_yds: 0 });
  });

  it("is not called lost when nobody on the rosters is named recovering it", () => {
    const applied = applyPlay(play([ev(RB, "rush", 2), ev(RB, "fumble")]), ROSTER);
    expect(statsOf(applied, RB).fum_lost).toBeUndefined();
  });
});

describe("R7: penalties", () => {
  it("a nullified play adds nothing, and says so for every event", () => {
    const applied = applyPlay(
      play([ev(RB, "rush", 30), ev(LB, "tackle")], { nullified: true, touchdown: true }),
      ROSTER,
    );
    expect(applied.deltas).toEqual([]);
    expect(rules(applied)).toEqual(["R7 rush", "R7 tackle"]);
  });
});

describe("R8: yards", () => {
  it("stated yards count plainly, and worked-out yards count with a ~", () => {
    const stated = applyPlay(play([ev(RB, "rush", 8, "stated")]), ROSTER);
    const spots = applyPlay(play([ev(RB, "rush", 12, "spots")]), ROSTER);
    const phrase = applyPlay(play([ev(RB, "rush", 2, "phrase")]), ROSTER);
    expect(stated.deltas[0]).toMatchObject({ stats: { rush_att: 1, rush_yds: 8 }, estimated: [] });
    expect(spots.deltas[0]).toMatchObject({ stats: { rush_att: 1, rush_yds: 12 }, estimated: ["rush_yds"] });
    expect(phrase.deltas[0]).toMatchObject({ stats: { rush_att: 1, rush_yds: 2 }, estimated: ["rush_yds"] });
  });

  it("unknown yards still count the attempt, add no yards, and mark the play YDS ?", () => {
    const applied = applyPlay(play([ev(RB, "rush")]), ROSTER);
    expect(applied.deltas[0]).toMatchObject({ stats: { rush_att: 1 }, yardsUnknown: true });
    expect(applied.yardsUnknown).toBe(true);
  });

  it("a completion's yards go to both ends when only one end said them", () => {
    const applied = applyPlay(play([ev(QB, "pass_complete", null), ev(WR, "reception", 14, "spots")], { playType: "pass" }), ROSTER);
    expect(statsOf(applied, QB)).toEqual({ pass_att: 1, pass_cmp: 1, pass_yds: 14 });
    expect(statsOf(applied, WR)).toEqual({ rec: 1, rec_yds: 14 });
    expect(applied.deltas.every((delta) => delta.estimated.length === 1)).toBe(true);
  });
});

describe("R9: rosters are the only source of players", () => {
  it("drops an event whose playerId is on neither roster, and keeps the rest of the play", () => {
    const applied = applyPlay(play([ev(RB, "rush", 5), ev("A12-NOBODY", "tackle")]), ROSTER);
    expect(statsOf(applied, RB)).toEqual({ rush_att: 1, rush_yds: 5 });
    expect(applied.deltas).toHaveLength(1);
    expect(rules(applied)).toEqual(["R9 tackle"]);
  });

  it("credits a player whose spotting is off", () => {
    const applied = applyPlay(play([ev(RB, "rush", 1), ev(RB, "fumble"), ev(OL, "fumble_recovery", 0)]), ROSTER);
    expect(statsOf(applied, OL).fr).toBe(1);
  });
});

describe("R10: touchdowns", () => {
  it("a rushing touchdown goes to the runner", () => {
    const applied = applyPlay(play([ev(RB, "rush", 5)], { touchdown: true }), ROSTER);
    expect(statsOf(applied, RB)).toEqual({ rush_att: 1, rush_yds: 5, rush_td: 1 });
  });

  it("a passing touchdown goes to the catcher and the passer", () => {
    const applied = applyPlay(
      play([ev(QB, "pass_complete", 20), ev(WR, "reception", 20)], { playType: "pass", touchdown: true }),
      ROSTER,
    );
    expect(statsOf(applied, WR).rec_td).toBe(1);
    expect(statsOf(applied, QB).pass_td).toBe(1);
  });

  it("the passer still gets his touchdown when the catcher was not on the roster", () => {
    const applied = applyPlay(
      play([ev(QB, "pass_complete", 20), ev("H1-GHOST", "reception", 20)], { playType: "pass", touchdown: true }),
      ROSTER,
    );
    expect(statsOf(applied, QB).pass_td).toBe(1);
  });

  it("a return touchdown goes to the returner", () => {
    const applied = applyPlay(play([ev(RET, "kick_return", 88)], { playType: "kickoff", touchdown: true }), ROSTER);
    expect(statsOf(applied, RET)).toEqual({ kr: 1, kr_yds: 88, kr_td: 1 });
  });

  it("a pick-six is the interceptor's int_td, and the passer gets no touchdown", () => {
    const applied = applyPlay(
      play([ev(QB, "pass_intercepted"), ev(VARGAS, "interception", 40)], { playType: "pass", touchdown: true }),
      ROSTER,
    );
    expect(statsOf(applied, VARGAS)).toEqual({ def_int: 1, int_ret_yds: 40, int_td: 1 });
    expect(statsOf(applied, QB).pass_td).toBeUndefined();
  });

  it("a scoop-and-score is the recoverer's fr_td, not the runner's", () => {
    const applied = applyPlay(
      play([ev(RB, "rush", 1), ev(RB, "fumble"), ev(VARGAS, "fumble_recovery", 55)], { touchdown: true }),
      ROSTER,
    );
    expect(statsOf(applied, VARGAS).fr_td).toBe(1);
    expect(statsOf(applied, RB).rush_td).toBeUndefined();
  });
});

describe("R11: two-point tries", () => {
  it("add nothing, run or pass, and say so for every event", () => {
    const applied = applyPlay(
      play([ev(QB, "pass_complete", 3), ev(WR, "reception", 3)], { playType: "two_point", touchdown: true }),
      ROSTER,
    );
    expect(applied.deltas).toEqual([]);
    expect(rules(applied)).toEqual(["R11 pass_complete", "R11 reception"]);
  });
});

describe("kicking and returns", () => {
  it("a made field goal is an attempt, a make and the long; a miss is only an attempt", () => {
    const made = applyPlay(play([ev(K, "field_goal", 42, "stated", true)], { playType: "field_goal" }), ROSTER);
    const missed = applyPlay(play([ev(K, "field_goal", 51, "stated", false)], { playType: "field_goal" }), ROSTER);
    expect(statsOf(made, K)).toEqual({ fga: 1, fgm: 1, fg_long: 42 });
    expect(statsOf(missed, K)).toEqual({ fga: 1 });
  });

  it("extra points, punts and punt returns", () => {
    expect(statsOf(applyPlay(play([ev(K, "extra_point", null, null, true)], { playType: "extra_point" }), ROSTER), K)).toEqual({
      xpa: 1,
      xpm: 1,
    });
    const punt = applyPlay(play([ev(K, "punt", 38), ev(RET, "punt_return", 6), ev(LB, "tackle")], { playType: "punt" }), ROSTER);
    expect(statsOf(punt, K)).toEqual({ punts: 1, punt_yds: 38 });
    expect(statsOf(punt, RET)).toEqual({ pr: 1, pr_yds: 6 });
    expect(statsOf(punt, LB)).toEqual({ tkl: 1 });
  });
});

describe("tonight's totals", () => {
  const game = [
    play([ev(RB, "rush", 8), ev(LB, "tackle")]),
    play([ev(RB, "rush", 3, "phrase"), ev(LB, "tackle")]),
    play([ev(K, "field_goal", 30, "stated", true)], { playType: "field_goal" }),
    play([ev(K, "field_goal", 44, "stated", true)], { playType: "field_goal" }),
  ];

  it("are worked out from the list of plays", () => {
    const totals = tonightTotals(game, ROSTER);
    expect(totals.get(RB)).toEqual({ stats: { rush_att: 2, rush_yds: 11 }, estimated: ["rush_yds"] });
    expect(totals.get(LB)).toEqual({ stats: { tkl: 2 }, estimated: [] });
    expect(totals.get(K)?.stats).toEqual({ fga: 2, fgm: 2, fg_long: 44 });
  });

  it("undo removes exactly one play's deltas", () => {
    const before = tonightTotals(game.slice(0, -1), ROSTER);
    const after = tonightTotals(game, ROSTER);
    const last = applyPlay(game.at(-1)!, ROSTER);
    // What the last play added, taken back off, is exactly the list without it.
    for (const delta of last.deltas) {
      const total = after.get(delta.playerId)!.stats;
      const without = before.get(delta.playerId)?.stats ?? {};
      for (const [key, value] of Object.entries(delta.stats) as Array<[keyof FootballStats, number]>) {
        if (key === "fg_long") continue;
        expect(total[key]! - value).toBe(without[key] ?? 0);
      }
    }
    // Everyone the last play did not touch is unchanged.
    for (const [playerId, tally] of before) {
      if (last.deltas.some((delta) => delta.playerId === playerId)) continue;
      expect(after.get(playerId)).toEqual(tally);
    }
    expect(before.get(K)?.stats).toEqual({ fga: 1, fgm: 1, fg_long: 30 });
  });

  it("undoing the only worked-out play takes the ~ away", () => {
    const withEstimate = tonightTotals(game.slice(0, 2), ROSTER);
    const undone = tonightTotals(game.slice(0, 1), ROSTER);
    expect(withEstimate.get(RB)?.estimated).toEqual(["rush_yds"]);
    expect(undone.get(RB)).toEqual({ stats: { rush_att: 1, rush_yds: 8 }, estimated: [] });
  });

  it("undoing every play leaves nobody with anything", () => {
    expect(tonightTotals([], ROSTER).size).toBe(0);
  });
});

describe("droppedByRule", () => {
  it("counts what each rule dropped, for stats.play_applied", () => {
    const applied = applyPlay(
      play([ev(QB, "pass_incomplete"), ev(LB, "tackle"), ev(DB, "tackle"), ev("A1-NOBODY", "pass_breakup")], { playType: "pass" }),
      ROSTER,
    );
    expect(droppedByRule(applied)).toEqual({ R2: 2, R9: 1 });
  });
});
