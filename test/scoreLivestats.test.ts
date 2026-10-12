import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TonightTally } from "@/lib/cards/tonight";
import { combineScores, COUNT_TRUTH_KEYS, isInside, latencySeconds, matchTruth, scoreGame, scoreJson, scoreLine, yardsClose, YARD_TRUTH_KEYS } from "@/lib/livestats/score";
import { parseScoreArgs, ScoreArgsError } from "@/lib/livestats/scoreArgs";
import { espnSummaryUrl, parseTruthFile, TRUTH_KEYS, truthFromEspn, truthFromManual, TruthError, type Truth } from "@/lib/livestats/truth";
import type { StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// The scorer (lib/livestats/score.ts, truth.ts, scoreArgs.ts): matching a box
// score to the roster, the three measures, and the lines it prints. Made-up
// names only; a real truth file names minors and is never committed.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Dax", last: "Prewitt", position: "WR" },
  { playerId: "H3-BOOTHBY", side: "home", jersey: "3", first: "Lane", last: "Boothby", position: "K" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
  { playerId: "A22-VANTREE", side: "away", jersey: "22", first: "Cole", last: "Vantree", position: "RB" },
  { playerId: "A88-KOLBY", side: "away", jersey: "88", first: "Sol", last: "Kolby", position: "WR" },
  { playerId: "A9-KOLBY", side: "away", jersey: "9", first: "Ty", last: "Kolby", position: "DB" },
];

function tally(stats: TonightTally["stats"]): TonightTally {
  return { stats, estimated: [] };
}

const MANUAL = {
  source: "manual",
  note: "the home kicker's long field goal is not in the box",
  players: [
    { side: "home", jersey: "7", name: "Ivo Castellane", stats: { pass_cmp: 14, pass_att: 20, pass_yds: 180, pass_td: 2, pass_int: 0 } },
    { side: "home", jersey: "22", name: "Reed Fennimore", stats: { rush_att: 12, rush_yds: 70, rush_td: 1 } },
    // No jersey: matched by surname.
    { side: "home", name: "Dax Prewitt Jr.", stats: { rec: 5, rec_yds: 90, rec_td: 1 } },
    { side: "home", jersey: "3", name: "Lane Boothby", stats: { xpm: 3, xpa: 3, fgm: 1, fga: 2 } },
    // Two away Kolbys: a surname alone cannot pick one.
    { side: "away", name: "Kolby", stats: { rec: 2, rec_yds: 20 } },
    { side: "away", jersey: "22", name: "Cole Vantree", stats: { rush_att: 8, rush_yds: 30 } },
  ],
};

const NO_RUN = { calls: 0, costUsd: 0, playsRead: 0, latencies: [] };

describe("truth files", () => {
  it("reads a manual box score on Spotter's keys", () => {
    const file = parseTruthFile(MANUAL);
    expect(file.source).toBe("manual");
    const truth = truthFromManual(file as Extract<typeof file, { source: "manual" }>);
    expect(truth.note).toMatch(/long field goal/);
    expect(truth.players[2]).toMatchObject({ side: "home", jersey: null, last: "Prewitt" });
    expect(truth.players[0].stats.pass_yds).toBe(180);
  });

  it("refuses what it cannot score, with the reason", () => {
    expect(() => parseTruthFile({ source: "manual", players: [{ side: "home", name: "X", stats: { tackles: 3 } }] })).toThrow(/unknown key "tackles"/);
    expect(() => parseTruthFile({ source: "manual", players: [{ side: "north", name: "X", stats: {} }] })).toThrow(TruthError);
    expect(() => parseTruthFile({ source: "espn", league: "xfl", gameId: "1" })).toThrow(/league/);
    expect(() => parseTruthFile({ source: "espn", league: "nfl", gameId: "abc" })).toThrow(/numeric/);
    expect(() => parseTruthFile({ source: "other" })).toThrow(/source/);
  });

  it("points at ESPN's public summary", () => {
    const file = parseTruthFile({ source: "espn", league: "college-football", gameId: "123456" });
    expect(espnSummaryUrl(file as Extract<typeof file, { source: "espn" }>)).toBe(
      "https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=123456",
    );
  });

  it("reads ESPN's box score: sides by team id, slash cells split, one player across sections", () => {
    const summary = {
      header: { competitions: [{ competitors: [{ homeAway: "home", team: { id: "10" } }, { homeAway: "away", team: { id: "20" } }] }] },
      boxscore: {
        players: [
          {
            team: { id: "10" },
            statistics: [
              {
                name: "passing",
                keys: ["completions/passingAttempts", "passingYards", "yardsPerPassAttempt", "passingTouchdowns", "interceptions"],
                athletes: [{ athlete: { id: "1", displayName: "Ivo Castellane", lastName: "Castellane", jersey: "7" }, stats: ["14/20", "180", "9.0", "2", "1"] }],
              },
              {
                name: "rushing",
                keys: ["rushingAttempts", "rushingYards", "rushingTouchdowns"],
                athletes: [
                  { athlete: { id: "2", displayName: "Reed Fennimore", lastName: "Fennimore", jersey: "22" }, stats: ["12", "70", "1"] },
                  { athlete: { id: "1", displayName: "Ivo Castellane", lastName: "Castellane", jersey: "7" }, stats: ["3", "-4", "0"] },
                ],
              },
              {
                name: "fumbles",
                keys: ["fumbles", "fumblesLost", "fumblesRecovered"],
                // No jersey in this section, and ESPN's own "Team" row is nobody.
                athletes: [
                  { athlete: { id: "2", displayName: "Reed Fennimore", lastName: "Fennimore" }, stats: ["1", "0", "0"] },
                  { athlete: { id: "-1", displayName: " Team" }, stats: ["2", "1", "0"] },
                ],
              },
              {
                name: "kicking",
                keys: ["fieldGoalsMade/fieldGoalAttempts", "fieldGoalPct", "longFieldGoalMade", "extraPointsMade/extraPointAttempts", "totalKickingPoints"],
                athletes: [{ athlete: { id: "3", displayName: "Lane Boothby", lastName: "Boothby", jersey: "3" }, stats: ["1/2", "50.0", "38", "3/3", "6"] }],
              },
            ],
          },
          {
            team: { id: "20" },
            statistics: [
              {
                name: "interceptions",
                keys: ["interceptions", "interceptionYards", "interceptionTouchdowns"],
                athletes: [{ athlete: { id: "9", displayName: "Marek Quillon", lastName: "Quillon", jersey: "17" }, stats: ["1", "12", "0"] }],
              },
              { name: "receiving", keys: ["receptions", "receivingYards", "receivingTouchdowns"], athletes: [] },
            ],
          },
        ],
      },
    };
    const truth = truthFromEspn(summary, "a note");
    expect(truth.note).toBe("a note");
    const by = new Map(truth.players.map((player) => [player.name, player]));
    expect(by.get("Ivo Castellane")).toMatchObject({ side: "home", jersey: "7", stats: { pass_cmp: 14, pass_att: 20, pass_yds: 180, pass_td: 2, pass_int: 1, rush_att: 3, rush_yds: -4, rush_td: 0 } });
    expect(by.get("Reed Fennimore")).toMatchObject({ side: "home", jersey: "22", stats: { rush_att: 12, rush_yds: 70, rush_td: 1, fum: 1 } });
    expect(by.get("Lane Boothby")?.stats).toEqual({ fgm: 1, fga: 2, xpm: 3, xpa: 3 });
    // The same column key means a thrown interception in passing and a defensive one in interceptions.
    expect(by.get("Marek Quillon")).toMatchObject({ side: "away", stats: { def_int: 1 } });
    expect(truth.players).toHaveLength(4);
  });

  it("refuses a summary with no home side or no box score", () => {
    expect(() => truthFromEspn({ header: { competitions: [] }, boxscore: { players: [] } })).toThrow(/home/);
    expect(() =>
      truthFromEspn({ header: { competitions: [{ competitors: [{ homeAway: "home", team: { id: "1" } }, { homeAway: "away", team: { id: "2" } }] }] }, boxscore: { players: [] } }),
    ).toThrow(/box score/);
  });
});

describe("matching the truth to the roster", () => {
  const truth = truthFromManual(parseTruthFile(MANUAL) as Extract<ReturnType<typeof parseTruthFile>, { source: "manual" }>);
  const matches = matchTruth(truth, ROSTER);
  const idOf = (name: string) => matches.get(truth.players.find((player) => player.name === name)!);

  it("by side and jersey first", () => {
    expect(idOf("Ivo Castellane")).toBe("H7-CASTELLANE");
    // Both sides have a 22: the side decides.
    expect(idOf("Reed Fennimore")).toBe("H22-FENNIMORE");
    expect(idOf("Cole Vantree")).toBe("A22-VANTREE");
  });

  it("by side and surname when the jersey is missing, suffix ignored", () => {
    expect(idOf("Dax Prewitt Jr.")).toBe("H81-PREWITT");
  });

  it("never guesses between two players with the surname", () => {
    expect(idOf("Kolby")).toBeNull();
  });
});

describe("the three measures", () => {
  const truth = truthFromManual(parseTruthFile(MANUAL) as Extract<ReturnType<typeof parseTruthFile>, { source: "manual" }>);
  const totals = new Map<string, TonightTally>([
    // Passing exact; yards 10% off (within).
    ["H7-CASTELLANE", tally({ pass_cmp: 14, pass_att: 20, pass_yds: 165, pass_td: 2 })],
    // One carry short; yards 4 off on 70 (within 10%).
    ["H22-FENNIMORE", tally({ rush_att: 11, rush_yds: 74, rush_td: 1 })],
    // Catches right, yards 20 short (outside both tolerances).
    ["H81-PREWITT", tally({ rec: 5, rec_yds: 70, rec_td: 1 })],
    ["H3-BOOTHBY", tally({ xpm: 3, xpa: 3, fgm: 1, fga: 2 })],
    // Nothing in the truth for this player: every credit is WRONG, and a tackle is not scored (not a truth key).
    ["A17-QUILLON", tally({ rush_att: 1, rush_yds: 3, tkl: 4 })],
    // The truth has nobody with a reception's yards but a Kolby; the ambiguous Kolby is unmatched, so these are wrong too.
    ["A88-KOLBY", tally({ rec: 2, rec_yds: 20 })],
  ]);
  const score = scoreGame("made-up", truth, totals, ROSTER, { calls: 10, costUsd: 0.1234, playsRead: 7, latencies: [5, 9, 7] });

  it("COUNT is exact matches over the count keys the truth lists", () => {
    // Castellane: cmp, att, td, int (0 vs absent = 0) = 4 hits of 4; Fennimore: att miss, td hit = 1 of 2; Prewitt: rec, rec_td = 2 of 2;
    // Boothby: xpm, xpa, fgm, fga = 4 of 4; Kolby (unmatched): rec = 0 of 1; Vantree (nothing found): rush_att 0 of 1.
    expect(score.count).toEqual({ hit: 11, total: 14 });
    expect(COUNT_TRUTH_KEYS).not.toContain("pass_yds");
    expect(YARD_TRUTH_KEYS).toContain("kr_yds");
  });

  it("YARDS is within max(3 yards, 10%), and the yards found over the truth's total", () => {
    // Castellane 165/180 within; Fennimore 74/70 within; Prewitt 70/90 not; Kolby unmatched not; Vantree 0/30 not.
    expect(score.yards.within).toEqual({ hit: 2, total: 5 });
    expect(score.yards.groups.passing).toEqual({ found: 165, truth: 180 });
    expect(score.yards.groups.rushing).toEqual({ found: 74 + 3, truth: 100 });
    expect(score.yards.groups.receiving).toEqual({ found: 90, truth: 110 });
    expect(yardsClose(0, 3)).toBe(true);
    expect(yardsClose(0, 4)).toBe(false);
    expect(yardsClose(270, 300)).toBe(true);
    expect(yardsClose(269, 300)).toBe(false);
  });

  it("WRONG is a credit to a player the truth gives none of", () => {
    const wrong = score.wrong.items.map((item) => `${item.playerId} ${item.key}`).sort();
    expect(wrong).toEqual(["A17-QUILLON rush_att", "A17-QUILLON rush_yds", "A88-KOLBY rec", "A88-KOLBY rec_yds"]);
    expect(score.wrong.credits).toBe(4);
  });

  it("a stat the truth never lists is not scored at all", () => {
    const partial: Truth = { source: "manual", players: [{ side: "home", jersey: "22", name: "Reed Fennimore", last: "Fennimore", stats: { rush_att: 12 } }] };
    const found = new Map([["H22-FENNIMORE", tally({ rush_att: 12, rush_yds: 70, rec: 3 })]]);
    const partialScore = scoreGame("partial", partial, found, ROSTER, NO_RUN);
    expect(partialScore.count).toEqual({ hit: 1, total: 1 });
    expect(partialScore.yards.within).toEqual({ hit: 0, total: 0 });
    expect(partialScore.wrong.credits).toBe(0);
    expect(TRUTH_KEYS).toContain("rec");
  });

  it("prints one line a game with no player names, and the same numbers as JSON", () => {
    const line = scoreLine(score);
    expect(line).toBe(
      "made-up: COUNT 11/14 (79%) · YARDS 2/5 (40%) within, passing 165/180 (92%), rushing 77/100 (77%), receiving 90/110 (82%) · WRONG 4 · 10 calls, $0.12, 7 plays read, 7.0 s median to stats · 5/6 truth players matched",
    );
    for (const player of ROSTER) expect(line).not.toMatch(new RegExp(player.last, "i"));
    expect(scoreJson(score)).toMatchObject({ label: "made-up", wrong: 4, calls: 10, playsRead: 7, latencyMedianS: 7, players: { truth: 6, matched: 5 } });
  });

  it("adds games up into one combined line", () => {
    const combined = combineScores([score, score]);
    expect(combined.count).toEqual({ hit: 22, total: 28 });
    expect(combined.yards.groups.passing).toEqual({ found: 330, truth: 360 });
    expect(combined.wrong.credits).toBe(8);
    expect(combined.run.calls).toBe(20);
    expect(scoreLine(combined)).toMatch(/^ALL \(2 games\): COUNT 22\/28/);
  });

  it("measures seconds from a play's last line to its stats", () => {
    const at = new Map([
      [3, 1_000],
      [8, 20_000],
    ]);
    const plays = [
      { play: { seqEnd: 3 }, readAt: 12_000 },
      { play: { seqEnd: 8 }, readAt: 25_500 },
      { play: { seqEnd: 99 }, readAt: 30_000 },
    ];
    expect(latencySeconds(plays, (seq) => at.get(seq))).toEqual([11, 5.5]);
  });
});

describe("the scorer's guard rails", () => {
  it("knows a folder inside the repo", () => {
    expect(isInside("/Users/x/code/spotter/test", "/Users/x/code/spotter")).toBe(true);
    expect(isInside("/Users/x/code/spotter", "/Users/x/code/spotter/")).toBe(true);
    expect(isInside("/Users/x/code/spotter-logs", "/Users/x/code/spotter")).toBe(false);
    expect(isInside("/Users/x/SpotterTestSet", "/Users/x/code/spotter")).toBe(false);
  });

  it("parses its flags", () => {
    expect(parseScoreArgs(["~/SpotterTestSet"])).toMatchObject({ folder: "~/SpotterTestSet", recorded: false, json: false });
    expect(parseScoreArgs(["x", "--recorded", "--json"])).toMatchObject({ recorded: true, json: true });
    expect(parseScoreArgs(["x", "--model", "anthropic/claude-haiku-5.5", "--effort", "medium"]).setting).toEqual({ model: "anthropic/claude-haiku-5.5", effort: "medium" });
    expect(() => parseScoreArgs([])).toThrow(ScoreArgsError);
    expect(() => parseScoreArgs(["x", "--recorded", "--model", "anthropic/claude-haiku-5.5"])).toThrow(/--recorded makes no calls/);
    expect(() => parseScoreArgs(["x", "y"])).toThrow(/One folder/);
    expect(() => parseScoreArgs(["x", "--bogus"])).toThrow(/Unknown flag/);
  });

  it("the scorer reads and never writes", () => {
    const script = readFileSync(new URL("../scripts/score-livestats.ts", import.meta.url), "utf8");
    expect(script).not.toMatch(/writeFile|appendFile|mkdir|createWriteStream|copyFile|rename/);
    expect(script).toMatch(/isInside\(/);
    for (const file of ["score.ts", "truth.ts", "scoreArgs.ts", "liveReplay.ts"]) {
      const source = readFileSync(new URL(`../lib/livestats/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/node:fs|from "fs"|node:child_process/);
    }
  });
});

// -----------------------------------------------------------------------------
// Fix 6, Part 5: NFL counting rules, and what the fixes did in a run.
// -----------------------------------------------------------------------------

import { fixCounts, fixLine, leagueTotals } from "@/lib/livestats/score";
import { tallyWithBooth } from "@/lib/cards/tonight";

describe("the truth's counting rules", () => {
  const sackPlay = {
    status: "applied",
    play: { seqStart: 5, events: [{ playerId: "H7-QB", action: "sacked" }, { playerId: "A99-DL", action: "sack" }] },
    changes: [
      { playerId: "H7-QB", key: "rush_att" as const, amount: 1, estimated: false },
      { playerId: "H7-QB", key: "rush_yds" as const, amount: -7, estimated: false },
      { playerId: "A99-DL", key: "sacks" as const, amount: 1, estimated: false },
    ],
  };
  const runPlay = { status: "applied", play: { seqStart: 1, events: [{ playerId: "H7-QB", action: "rush" }] }, changes: [{ playerId: "H7-QB", key: "rush_att" as const, amount: 1, estimated: false }, { playerId: "H7-QB", key: "rush_yds" as const, amount: 12, estimated: false }] };
  const totals = tallyWithBooth([runPlay, sackPlay].map((play) => ({ seqStart: play.play.seqStart, changes: play.changes })), []);

  it("takes a sack out of the carries and rushing yards for an NFL box, and leaves college and manual truth alone", () => {
    expect(totals.get("H7-QB")?.stats).toEqual({ rush_att: 2, rush_yds: 5 });
    expect(leagueTotals(totals, [runPlay, sackPlay], [], "nfl").get("H7-QB")?.stats).toEqual({ rush_att: 1, rush_yds: 12 });
    expect(leagueTotals(totals, [runPlay, sackPlay], [], "college-football").get("H7-QB")?.stats).toEqual({ rush_att: 2, rush_yds: 5 });
    expect(leagueTotals(totals, [runPlay, sackPlay], [], undefined).get("H7-QB")?.stats).toEqual({ rush_att: 2, rush_yds: 5 });
    // A sack before a booth line that set the rushing total is already inside the booth's number.
    const booth = [{ seq: 6, playerId: "H7-QB", key: "rush_att" as const, value: 4 }, { seq: 6, playerId: "H7-QB", key: "rush_yds" as const, value: 20 }];
    const set = tallyWithBooth([runPlay, sackPlay].map((play) => ({ seqStart: play.play.seqStart, changes: play.changes })), booth);
    expect(leagueTotals(set, [runPlay, sackPlay], booth, "nfl").get("H7-QB")?.stats).toEqual({ rush_att: 4, rush_yds: 20 });
  });

  it("counts what fix 6 did, and prints it on one line", () => {
    const plays = [
      { playId: "1-1", status: "applied", dropped: [{ rule: "R43", kind: "changed" }] },
      { playId: "3-3", status: "applied", dropped: [{ rule: "R43", kind: "noted" }] },
      { playId: "gap-4-6", status: "applied", dropped: [{ rule: "R45", kind: "filled" }] },
      { playId: "8-8", status: "discarded", dropped: [{ rule: "R43", kind: "changed" }] },
    ];
    const booth = [{ seq: 2, playerId: "P", key: "pass_yds" as const, value: 100 }, { seq: 9, playerId: "P", key: "pass_yds" as const, value: 150 }, { seq: 9, playerId: "P", key: "pass_cmp" as const, value: 9 }];
    const fixes = fixCounts(plays, booth, { boothRereads: 2, gapRereads: 3 });
    expect(fixes).toEqual({ boothTotals: 2, boothRereads: 2, ledgerFills: 1, gapRereads: 3, gapFills: 1 });
    expect(fixLine(fixes)).toBe("  fix 6: 2 totals set by a booth line (R41), 2 booth re-reads (R42), 1 ledger fills (R43), 3 gap re-reads (R44), 1 inferred incompletions (R45)");
  });
});
