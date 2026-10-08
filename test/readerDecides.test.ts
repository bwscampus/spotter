import { describe, expect, it } from "vitest";
import { tallyChanges } from "@/lib/cards/tonight";
import { EMPTY_SESSION, okPlay, readPlays, type StatsSession } from "@/lib/livestats/session";
import type { Action, Score, StatsEvent, StatsPlay, StatsRosterPlayer, YardsSource } from "@/lib/livestats/types";

// =============================================================================
// The reader decides what happened (Oct 6, after the two Gemini games). Code
// applies rules of football, fills in what has one answer, and drops what
// cannot be true; it never moves a credit, and position never drops one.
// Every case here goes through readPlays with the transcript lines, the way
// the live loop runs it. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB", season: { pass_att: 120 } },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR" },
  { playerId: "H95-ORTWINE", side: "home", jersey: "95", first: "Bram", last: "Ortwine", position: "DT" },
  { playerId: "H3-BOOTHBY", side: "home", jersey: "3", first: "Kit", last: "Boothby", position: "K" },
  { playerId: "A5-QUILLON", side: "away", jersey: "5", first: "Marek", last: "Quillon", position: "QB" },
  { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
  { playerId: "A24-ASHGROVE", side: "away", jersey: "24", first: "Penn", last: "Ashgrove", position: "CB" },
  { playerId: "A21-HOLLIS-TEAGUE", side: "away", jersey: "21", first: "Jory", last: "Hollis-Teague", position: "S" },
  { playerId: "A2-OAKES", side: "away", jersey: "2", first: "Finn", last: "Oakes", position: "WR" },
];

function ev(playerId: string, action: Action, yards: number | null = null, yardsSource: YardsSource | null = yards === null ? null : "stated", made: boolean | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource, made };
}

function play(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
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
    summary: "",
    evidence: "",
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: { on: "none", noPlay: false, beforeSnap: false },
    ...extra,
  };
}

/** Reads each batch in turn, OK'ing every new play, the way testrun counts. */
function game(lines: string[], ...batches: StatsPlay[][]) {
  const utterances = lines.map((text, seq) => ({ seq, text, offsetMs: seq * 5000 }));
  let session: StatsSession = EMPTY_SESSION;
  batches.forEach((batch, i) => {
    const read = readPlays(session, batch, ROSTER, (i + 1) * 1000, { utterances });
    session = read.session;
    for (const added of read.added) session = okPlay(session, (i + 1) * 1000 + 1, added.playId).session;
  });
  const tally = tallyChanges(session.plays.filter((p) => p.status === "applied").flatMap((p) => p.changes));
  return { session, stats: (playerId: string) => tally.get(playerId)?.stats, rules: session.plays.flatMap((p) => p.dropped.map((d) => `${d.rule} ${d.kind} ${d.playerId}`)) };
}

describe("kicks are not side-checked", () => {
  it("a kick return by the receiving team with a tackle by the kicking team keeps both credits", () => {
    const g = game(
      ["boothby kicks it deep", "oakes takes it out to the 30 and boothby makes the stop"],
      [play(0, 1, [ev("A2-OAKES", "kick_return", 25), ev("H3-BOOTHBY", "tackle")], { playType: "kickoff", offense: "home", down: null, distance: null })],
    );
    expect(g.stats("A2-OAKES")).toEqual({ kr: 1, kr_yds: 25 });
    expect(g.stats("H3-BOOTHBY")).toEqual({ tkl: 1 });
    expect(g.rules).toEqual([]);
  });

  it("a tackle by a kicker on a kickoff counts", () => {
    const g = game(["boothby boots it", "oakes returns it, boothby with the tackle"], [play(0, 1, [ev("A2-OAKES", "kick_return", 18), ev("H3-BOOTHBY", "tackle")], { playType: "kickoff", down: null, distance: null })]);
    expect(g.stats("H3-BOOTHBY")).toEqual({ tkl: 1 });
  });
});

describe("position never drops a credit", () => {
  it("a carry by a player listed as a defensive lineman counts", () => {
    const g = game(["4th and 1", "ortwine the big defensive tackle lines up at fullback and gets 3"], [play(0, 1, [ev("H95-ORTWINE", "rush", 3)], { down: 4, distance: 1 })]);
    expect(g.stats("H95-ORTWINE")).toEqual({ rush_att: 1, rush_yds: 3 });
    expect(g.rules).toEqual([]);
  });
});

describe("a credit that cannot be true is dropped, never moved", () => {
  it("a catch credited to the defense is dropped and the quarterback's completion stays; a later read naming the receiver fills the slot", () => {
    const lines = ["castellane looks deep", "complete, ashgrove was right there, 12 yards", "replay shows prewitt made the catch"];
    const first = play(0, 1, [ev("H7-CASTELLANE", "pass_complete", 12), ev("A24-ASHGROVE", "reception", 12)], { playType: "pass" });
    const g1 = game(lines, [first]);
    expect(g1.stats("H7-CASTELLANE")).toEqual({ pass_att: 1, pass_cmp: 1, pass_yds: 12 });
    expect(g1.stats("A24-ASHGROVE")).toBeUndefined();
    expect(g1.rules).toEqual(["R12 dropped A24-ASHGROVE"]);

    const later = play(2, 2, [ev("H81-PREWITT", "reception", 12)], { playType: "pass", updates: "0-1" });
    const g2 = game(lines, [first], [later]);
    expect(g2.session.plays).toHaveLength(1);
    expect(g2.stats("H81-PREWITT")).toEqual({ rec: 1, rec_yds: 12 });
    expect(g2.stats("H7-CASTELLANE")).toEqual({ pass_att: 1, pass_cmp: 1, pass_yds: 12 });
  });
});

describe("the name check", () => {
  it("a hyphenated surname written as two words, or as one half, is named", () => {
    const twoWords = game(["fennimore runs for 4", "stopped by hollis teague"], [play(0, 1, [ev("H22-FENNIMORE", "rush", 4), ev("A21-HOLLIS-TEAGUE", "tackle")])]);
    expect(twoWords.stats("A21-HOLLIS-TEAGUE")).toEqual({ tkl: 1 });
    const oneHalf = game(["fennimore runs for 4", "teague brings him down"], [play(0, 1, [ev("H22-FENNIMORE", "rush", 4), ev("A21-HOLLIS-TEAGUE", "tackle")])]);
    expect(oneHalf.stats("A21-HOLLIS-TEAGUE")).toEqual({ tkl: 1 });
  });

  it("a tackler named three lines after the short evidence quote is named", () => {
    const g = game(
      ["fennimore off tackle", "he's loose", "still going", "dunmore finally gets him"],
      [play(0, 3, [ev("H22-FENNIMORE", "rush", 9), ev("A17-DUNMORE", "tackle")], { evidence: "fennimore off tackle" })],
    );
    expect(g.stats("A17-DUNMORE")).toEqual({ tkl: 1 });
  });

  it("a player the lines never name is dropped (R18)", () => {
    const g = game(["fennimore for 4", "brought down near the sideline"], [play(0, 1, [ev("H22-FENNIMORE", "rush", 4), ev("A17-DUNMORE", "tackle")], { summary: "FENNIMORE 4, DUNMORE tackle" })]);
    expect(g.stats("A17-DUNMORE")).toBeUndefined();
    expect(g.rules).toEqual(["R18 dropped A17-DUNMORE"]);
  });
});

describe("rules that guessed are gone", () => {
  it("a sack with no 'sack' word stays a sack and gives the quarterback one carry", () => {
    const g = game(["castellane drops back", "dunmore gets him down"], [play(0, 1, [ev("H7-CASTELLANE", "sacked"), ev("A17-DUNMORE", "sack")], { playType: "sack" })]);
    expect(g.stats("H7-CASTELLANE")).toEqual({ rush_att: 1 });
    expect(g.stats("A17-DUNMORE")).toEqual({ sacks: 1, tkl: 1 });
  });

  it("a touchdown is not removed when no score is heard, or when the score is heard unchanged", () => {
    const score = (home: number, away: number): Score => ({ home, away });
    const td = play(2, 3, [ev("H22-FENNIMORE", "rush", 5)], { touchdown: true });
    const lines = ["7 7 ballgame", "1st and 10", "fennimore in for six", "touchdown", "still 7 7 here"];
    const none = game(lines, [td]);
    expect(none.stats("H22-FENNIMORE")?.rush_td).toBe(1);
    const unchanged = game(lines, [play(0, 0, [], { playType: "other", score: score(7, 7) })], [td], [play(4, 4, [], { playType: "other", score: score(7, 7) })]);
    expect(unchanged.stats("H22-FENNIMORE")?.rush_td).toBe(1);
  });

  it("a false start read after a run leaves the run alone", () => {
    const g = game(
      ["fennimore for 6", "dunmore on the stop", "flag, false start on the offense"],
      [play(0, 1, [ev("H22-FENNIMORE", "rush", 6), ev("A17-DUNMORE", "tackle")])],
      [play(2, 2, [], { playType: "penalty_only", nullified: true, penalty: { on: "offense", noPlay: true, beforeSnap: true } })],
    );
    expect(g.stats("H22-FENNIMORE")).toEqual({ rush_att: 1, rush_yds: 6 });
  });

  it("an extra point read with no result becomes made when the score goes up 7", () => {
    const score = (home: number, away: number): Score => ({ home, away });
    const g = game(
      ["0 0", "fennimore scores", "boothby on for the extra point", "7 nothing"],
      [play(0, 0, [], { playType: "other", score: score(0, 0) })],
      [play(1, 1, [ev("H22-FENNIMORE", "rush", 3)], { touchdown: true })],
      [play(2, 2, [ev("H3-BOOTHBY", "extra_point")], { playType: "extra_point", down: null, distance: null })],
      [play(3, 3, [], { playType: "other", score: score(7, 0) })],
    );
    expect(g.stats("H3-BOOTHBY")).toEqual({ xpa: 1, xpm: 1 });
  });
});
