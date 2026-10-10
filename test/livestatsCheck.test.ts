import { describe, expect, it } from "vitest";
import { applyPlay } from "@/lib/livestats/apply";
import { checkPlay, currentQbs, playOffense, type CurrentQbs } from "@/lib/livestats/check";
import { isNamedIn, saidToThrow, surnameTokens } from "@/lib/livestats/names";
import { changesOf, EMPTY_SESSION, readPlays } from "@/lib/livestats/session";
import type { Action, StatsEvent, StatsPlay, StatsRosterPlayer, YardsSource } from "@/lib/livestats/types";

// =============================================================================
// Checking every credit before the stat rules see it (lib/livestats/check.ts).
// Since Oct 6 it drops what cannot be true and fills what has one answer,
// and never moves a credit to someone else, except a pass with no usable
// passer to the quarterback on the field. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB", season: { pass_att: 120 } },
  { playerId: "H12-BRINDLE", side: "home", jersey: "12", first: "Ash", last: "Brindle", position: "QB", season: { pass_att: 10 } },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB", season: { rush_att: 70 } },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR", season: { rec: 20 } },
  { playerId: "H11-MARLOWE", side: "home", jersey: "11", first: "Ives", last: "Marlowe", position: "WR", season: { rec: 30 } },
  { playerId: "H24-MARLOWE", side: "home", jersey: "24", first: "Dane", last: "Marlowe", position: "CB" },
  { playerId: "H66-CASTELLANO", side: "home", jersey: "66", first: "Big", last: "Castellano", position: "OL" },
  { playerId: "H3-BOOTHBY", side: "home", jersey: "3", first: "Kit", last: "Boothby", position: "K" },
  { playerId: "H9-PELLAM", side: "home", jersey: "9", first: "Wren", last: "Pellam", position: "P" },
  { playerId: "A5-QUILLON", side: "away", jersey: "5", first: "Marek", last: "Quillon", position: "QB" },
  { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
  { playerId: "A24-ASHGROVE", side: "away", jersey: "24", first: "Penn", last: "Ashgrove", position: "DB" },
  { playerId: "A90-TARROW", side: "away", jersey: "90", first: "Gus", last: "Tarrow", position: "DL" },
  { playerId: "A8-VASKO", side: "away", jersey: "8", first: "Olen", last: "Vasko", position: "P" },
  { playerId: "A2-OAKES", side: "away", jersey: "2", first: "Finn", last: "Oakes", position: "WR" },
  { playerId: "A31-RENNICK", side: "away", jersey: "31", first: "Tad", last: "Rennick", position: "RB" },
];

const QBS: CurrentQbs = { home: "H7-CASTELLANE", away: "A5-QUILLON" };

function ev(playerId: string, action: Action, yards: number | null = null, yardsSource: YardsSource | null = yards === null ? null : "stated"): StatsEvent {
  return { playerId, action, yards, yardsSource, made: null };
}

let seq = 0;
function play(summary: string, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  seq += 2;
  return {
    seqStart: seq,
    seqEnd: seq + 1,
    quarter: 2,
    clock: null,
    down: 2,
    distance: 7,
    offense: "home",
    playType: "pass",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary,
    evidence: "",
    events,
    ...extra,
  };
}

const check = (p: StatsPlay, qbs = QBS) => checkPlay(p, ROSTER, { qbs });
const eventsOf = (p: StatsPlay) => p.events.map((event) => `${event.playerId} ${event.action}${event.estimated ? " ~" : ""}`);
const rulesOf = (notes: ReturnType<typeof check>["notes"]) => notes.map((note) => `${note.rule} ${note.kind} ${note.event.playerId} ${note.event.action}${note.to ? ` -> ${note.to}` : ""}`);

describe("the names behind the check", () => {
  it("knows a surname without its suffix, by every part", () => {
    expect(surnameTokens("Roberts Jr.")).toEqual(["roberts"]);
    expect(surnameTokens("White-McLain")).toEqual(["whitemclain", "white", "mclain"]);
    expect(surnameTokens("De La Cruz III")).toEqual(["delacruz", "cruz"]);
  });

  it("finds a surname in a summary or the words it was read from", () => {
    expect(isNamedIn("Roberts Jr.", "ROBERTS 12 yd run")).toBe(true);
    expect(isNamedIn("White-McLain", "stopped by mclain at the 40")).toBe(true);
    expect(isNamedIn("Cole", "jv on cole on the tackle")).toBe(true);
    expect(isNamedIn("Dunmore", "FENNIMORE 4 yd run")).toBe(false);
    expect(isNamedIn("Fifita", "fafitaga drops back", ["fafitaga"])).toBe(true);
  });

  it(`says a player threw the ball when a throwing word comes within two words of the surname`, () => {
    expect(saidToThrow("Fennimore", "fennimore throws it to prewitt")).toBe(true);
    expect(saidToThrow("Fennimore", "fennimore now passes to prewitt")).toBe(true);
    expect(saidToThrow("Fennimore", "fennimore takes the pitch and then he throws")).toBe(false);
    expect(saidToThrow("Prewitt", "pass to prewitt")).toBe(false);
  });
});

describe("who had the ball", () => {
  it("takes the side most offensive events belong to, with Claude's own answer as a vote and the tie-break", () => {
    expect(playOffense(play("x", [ev("A31-RENNICK", "rush", 4)], { offense: null }), ROSTER)).toBe("away");
    expect(playOffense(play("x", [ev("A31-RENNICK", "rush", 4), ev("A5-QUILLON", "pass_complete", 4)], { offense: "home" }), ROSTER)).toBe("away");
    // One wrongly credited punt cannot outvote the play's own offense.
    expect(playOffense(play("x", [ev("A8-VASKO", "punt", 40)], { offense: "home" }), ROSTER)).toBe("home");
    expect(playOffense(play("x", [], { offense: null }), ROSTER)).toBeNull();
  });
});

describe("the current quarterback", () => {
  it("starts as the quarterback with the most season pass attempts, or the first one listed", () => {
    expect(currentQbs(ROSTER, [])).toEqual({ home: "H7-CASTELLANE", away: "A5-QUILLON" });
    const noStats = ROSTER.map((player) => ({ ...player, season: null }));
    expect(currentQbs(noStats, []).home).toBe("H7-CASTELLANE");
    expect(currentQbs(ROSTER.filter((player) => player.position !== "QB"), []).home).toBeNull();
  });

  it("changes when a second quarterback is named as the passer", () => {
    const first = check(play("BRINDLE to PREWITT for 6", [ev("H12-BRINDLE", "pass_complete", 6), ev("H81-PREWITT", "reception", 6)]));
    expect(first.notes).toEqual([]);
    expect(currentQbs(ROSTER, [first.play]).home).toBe("H12-BRINDLE");

    // Through readPlays: the next catch with no passer is Brindle's completion.
    // A different down, so the second play is not read as a later read of the first.
    const read = readPlays(EMPTY_SESSION, [first.play, play("PREWITT catch for 9", [ev("H81-PREWITT", "reception", 9)], { down: 3, distance: 1 })], ROSTER, 1);
    const second = read.added[1];
    expect(eventsOf(second.play)).toEqual(["H81-PREWITT reception", "H12-BRINDLE pass_complete ~"]);
    expect(second.dropped.map((drop) => `${drop.rule} ${drop.kind} ${drop.to}`)).toEqual(["R16 filled H12-BRINDLE"]);
  });
});

describe("the passer rule", () => {
  it("a non-quarterback passer not said to have thrown it goes to the current quarterback, estimated", () => {
    const { play: fixed, notes } = check(play("FENNIMORE incomplete to PREWITT", [ev("H22-FENNIMORE", "pass_incomplete")]));
    expect(eventsOf(fixed)).toEqual(["H7-CASTELLANE pass_incomplete ~"]);
    expect(rulesOf(notes)).toEqual(["R14 filled H22-FENNIMORE pass_incomplete -> H7-CASTELLANE"]);
  });

  it("a non-quarterback the words say threw it keeps the pass", () => {
    const { play: fixed, notes } = check(
      play("FENNIMORE pass to PREWITT for 20", [ev("H22-FENNIMORE", "pass_complete", 20), ev("H81-PREWITT", "reception", 20)], {
        evidence: "reverse to fennimore he throws it deep to prewitt",
      }),
    );
    expect(notes).toEqual([]);
    expect(eventsOf(fixed)).toEqual(["H22-FENNIMORE pass_complete", "H81-PREWITT reception"]);
  });

  it("a pass attempt on the receiver who dropped it goes to the current quarterback, estimated", () => {
    const { play: fixed, notes } = check(play("pass dropped by PREWITT", [ev("H81-PREWITT", "pass_incomplete")]));
    expect(rulesOf(notes)).toEqual(["R14 filled H81-PREWITT pass_incomplete -> H7-CASTELLANE"]);
    const changes = changesOf(applyPlay(fixed, ROSTER));
    expect(changes).toEqual([{ playerId: "H7-CASTELLANE", key: "pass_att", amount: 1, estimated: true }]);
  });

  it("a quarterback the words never name is replaced by the one on the field; an id on neither roster too", () => {
    const { play: fixed, notes } = check(play("CASTELLANE pass to PREWITT, 7 yards", [ev("H12-BRINDLE", "pass_complete", 7), ev("H81-PREWITT", "reception", 7)]));
    expect(eventsOf(fixed)).toEqual(["H7-CASTELLANE pass_complete ~", "H81-PREWITT reception"]);
    expect(rulesOf(notes)).toEqual(["R14 filled H12-BRINDLE pass_complete -> H7-CASTELLANE"]);
    const offRoster = check(play("pass to PREWITT, 7 yards", [ev("A-CASTELANE", "pass_complete", 7), ev("H81-PREWITT", "reception", 7)]));
    expect(rulesOf(offRoster.notes)).toEqual(["R14 filled A-CASTELANE pass_complete -> H7-CASTELLANE"]);
  });
});

describe("sides, on plays from scrimmage", () => {
  it("a tackle by the team with the ball is dropped, not moved", () => {
    const { play: fixed, notes } = check(play("FENNIMORE 4 yd run, CASTELLANE on the tackle", [ev("H22-FENNIMORE", "rush", 4), ev("H7-CASTELLANE", "tackle")], { playType: "run" }));
    expect(eventsOf(fixed)).toEqual(["H22-FENNIMORE rush"]);
    expect(rulesOf(notes)).toEqual(["R12 dropped H7-CASTELLANE tackle"]);
    expect(notes[0].reason).toMatch(/team with the ball/);
  });

  it("on a turnover a tackle may come from either side", () => {
    const { notes } = check(
      play("CASTELLANE picked off by ASHGROVE, FENNIMORE makes the tackle", [
        ev("H7-CASTELLANE", "pass_intercepted"),
        ev("A24-ASHGROVE", "interception", 12),
        ev("H22-FENNIMORE", "tackle"),
      ]),
    );
    expect(notes).toEqual([]);
  });

  it("position never drops a credit: a cornerback's catch and a lineman's carry both count", () => {
    const catchByCorner = check(play("CASTELLANE to MARLOWE for 9", [ev("H7-CASTELLANE", "pass_complete", 9), ev("H24-MARLOWE", "reception", 9)]));
    expect(catchByCorner.notes).toEqual([]);
    const linemanCarry = check(play("CASTELLANO 2 yd run", [ev("H66-CASTELLANO", "rush", 2)], { playType: "run" }));
    expect(linemanCarry.notes).toEqual([]);
  });

  it("a kick play is not side-checked at all", () => {
    const { notes } = check(play("PELLAM punts, OAKES returns it 8, PREWITT and VASKO in on the stop", [
      ev("H9-PELLAM", "punt", 40),
      ev("A2-OAKES", "punt_return", 8),
      ev("H81-PREWITT", "tackle"),
      ev("A8-VASKO", "tackle"),
    ], { playType: "punt" }));
    expect(notes).toEqual([]);
  });
});

describe("named in the words", () => {
  it("an event whose player is not named is dropped, never moved to the one the summary names", () => {
    const { play: fixed, notes } = check(
      play("FENNIMORE 4 yd run, tackled by DUNMORE", [ev("H22-FENNIMORE", "rush", 4), ev("A90-TARROW", "tackle")], {
        playType: "run",
        evidence: "fennimore up the middle dunmore with the stop",
      }),
    );
    expect(eventsOf(fixed)).toEqual(["H22-FENNIMORE rush"]);
    expect(rulesOf(notes)).toEqual(["R18 dropped A90-TARROW tackle"]);
  });

  it("and dropped when nobody else is named", () => {
    const { play: fixed, notes } = check(play("FENNIMORE 4 yd run", [ev("H22-FENNIMORE", "rush", 4), ev("A90-TARROW", "tackle")], { playType: "run" }));
    expect(eventsOf(fixed)).toEqual(["H22-FENNIMORE rush"]);
    expect(rulesOf(notes)).toEqual(["R18 dropped A90-TARROW tackle"]);
  });

  it("looks in the read's transcript lines when they are given, not the summary", () => {
    const read = play("FENNIMORE 4 yd run, tackled by TARROW", [ev("H22-FENNIMORE", "rush", 4), ev("A90-TARROW", "tackle")], { playType: "run" });
    const withLines = checkPlay(read, ROSTER, { qbs: QBS, lines: "fennimore up the middle for 4" });
    expect(rulesOf(withLines.notes)).toEqual(["R18 dropped A90-TARROW tackle"]);
  });

  it("a surname with a suffix is named by its bare form", () => {
    const roster = ROSTER.map((player) => (player.playerId === "H22-FENNIMORE" ? { ...player, last: "Fennimore Jr." } : player));
    const { notes } = checkPlay(play("FENNIMORE 4 yd run", [ev("H22-FENNIMORE", "rush", 4)], { playType: "run" }), roster, { qbs: QBS });
    expect(notes).toEqual([]);
  });

  it("an id on neither roster is left for R9", () => {
    const tackler = check(play("FENNIMORE 4 yd run", [ev("H22-FENNIMORE", "rush", 4), ev("A-NOBODY", "tackle")], { playType: "run" }));
    expect(eventsOf(tackler.play)).toEqual(["H22-FENNIMORE rush", "A-NOBODY tackle"]);
    expect(tackler.notes).toEqual([]);
    expect(applyPlay(tackler.play, ROSTER).dropped.map((drop) => drop.rule)).toEqual(["R9"]);
  });
});

describe("fill-ins", () => {
  it("a catch with no passer adds the completion for the current quarterback, estimated, with the catch's yards", () => {
    const { play: fixed, notes } = check(play("PREWITT catch for 12", [ev("H81-PREWITT", "reception", 12)]));
    expect(eventsOf(fixed)).toEqual(["H81-PREWITT reception", "H7-CASTELLANE pass_complete ~"]);
    expect(rulesOf(notes)).toEqual(["R16 filled H7-CASTELLANE pass_complete -> H7-CASTELLANE"]);
    const applied = applyPlay(fixed, ROSTER);
    const qb = applied.deltas.find((delta) => delta.playerId === "H7-CASTELLANE")!;
    expect(qb.stats).toEqual({ pass_att: 1, pass_cmp: 1, pass_yds: 12 });
    expect(qb.estimated.sort()).toEqual(["pass_att", "pass_cmp", "pass_yds"]);
    const wr = applied.deltas.find((delta) => delta.playerId === "H81-PREWITT")!;
    expect(wr.estimated).toEqual([]);
  });

  it("a breakup or an interception with no passer adds the attempt", () => {
    const broken = check(play("pass broken up by ASHGROVE", [ev("A24-ASHGROVE", "pass_breakup")]));
    expect(eventsOf(broken.play)).toEqual(["A24-ASHGROVE pass_breakup", "H7-CASTELLANE pass_incomplete ~"]);
    const picked = check(play("picked off by ASHGROVE", [ev("A24-ASHGROVE", "interception", 3)]));
    expect(eventsOf(picked.play)).toEqual(["A24-ASHGROVE interception", "H7-CASTELLANE pass_intercepted ~"]);
    expect(picked.notes[0].rule).toBe("R16");
  });

  it("a pass play with nothing on it is an attempt by the current quarterback", () => {
    const { play: fixed } = check(play("incomplete, low throw", []));
    expect(eventsOf(fixed)).toEqual(["H7-CASTELLANE pass_incomplete ~"]);
  });

  it("a sack with no quarterback adds the sacked event", () => {
    const { play: fixed, notes } = check(play("DUNMORE sacks him for a loss of 7", [ev("A17-DUNMORE", "sack", 7)], { playType: "sack" }));
    expect(eventsOf(fixed)).toEqual(["A17-DUNMORE sack", "H7-CASTELLANE sacked ~"]);
    expect(rulesOf(notes)).toEqual(["R17 filled H7-CASTELLANE sacked -> H7-CASTELLANE"]);
    const applied = applyPlay(fixed, ROSTER);
    const qb = applied.deltas.find((delta) => delta.playerId === "H7-CASTELLANE")!;
    expect(qb.stats).toEqual({ rush_att: 1, rush_yds: -7 });
    expect(qb.estimated.sort()).toEqual(["rush_att", "rush_yds"]);
  });

  it("fills nothing when the side has no quarterback or the passer is already there", () => {
    const noQb = ROSTER.filter((player) => player.position !== "QB");
    const { play: fixed } = checkPlay(play("PREWITT catch for 12", [ev("H81-PREWITT", "reception", 12)]), noQb, { qbs: { home: null, away: null } });
    expect(eventsOf(fixed)).toEqual(["H81-PREWITT reception"]);
    const already = check(play("CASTELLANE to PREWITT for 12", [ev("H7-CASTELLANE", "pass_complete", 12), ev("H81-PREWITT", "reception", 12)]));
    expect(already.notes).toEqual([]);
  });
});

describe("contradictions", () => {
  it("an incompletion beside a reception with no completion drops the reception", () => {
    const { play: fixed, notes } = check(play("CASTELLANE incomplete to PREWITT", [ev("H7-CASTELLANE", "pass_incomplete"), ev("H81-PREWITT", "reception", 5)]));
    expect(eventsOf(fixed)).toEqual(["H7-CASTELLANE pass_incomplete"]);
    expect(rulesOf(notes)).toEqual(["R19 dropped H81-PREWITT reception"]);
  });

  it("two breakups become one: the one whose surname is in the evidence, else the first", () => {
    const { play: fixed, notes } = check(
      play("CASTELLANE incomplete, broken up by ASHGROVE and DUNMORE", [ev("H7-CASTELLANE", "pass_incomplete"), ev("A24-ASHGROVE", "pass_breakup"), ev("A17-DUNMORE", "pass_breakup")], {
        evidence: "swatted away by dunmore",
      }),
    );
    expect(eventsOf(fixed)).toEqual(["H7-CASTELLANE pass_incomplete", "A17-DUNMORE pass_breakup"]);
    expect(rulesOf(notes)).toEqual(["R20 dropped A24-ASHGROVE pass_breakup"]);

    const first = check(play("CASTELLANE incomplete, broken up by ASHGROVE and DUNMORE", [ev("H7-CASTELLANE", "pass_incomplete"), ev("A24-ASHGROVE", "pass_breakup"), ev("A17-DUNMORE", "pass_breakup")]));
    expect(eventsOf(first.play)).toEqual(["H7-CASTELLANE pass_incomplete", "A24-ASHGROVE pass_breakup"]);
  });

  it("a fair catch is not a return", () => {
    const { play: fixed, notes } = check(play("PELLAM punt, fair catch by OAKES", [ev("H9-PELLAM", "punt", 40), ev("A2-OAKES", "punt_return", 0)], { playType: "punt" }));
    expect(eventsOf(fixed)).toEqual(["H9-PELLAM punt"]);
    expect(rulesOf(notes)).toEqual(["R21 dropped A2-OAKES punt_return"]);
    const returned = check(play("PELLAM punt, OAKES brings it back 8", [ev("H9-PELLAM", "punt", 40), ev("A2-OAKES", "punt_return", 8)], { playType: "punt" }));
    expect(returned.notes).toEqual([]);
  });
});

describe("what the check leaves alone", () => {
  it("a wiped-out play and a two-point try, which the rules already throw away", () => {
    const wiped = play("FENNIMORE 4 yd run, flag", [ev("H7-CASTELLANE", "tackle")], { nullified: true });
    expect(check(wiped)).toEqual({ play: wiped, notes: [], unnamed: [] });
    const two = play("two point try", [ev("H7-CASTELLANE", "tackle")], { playType: "two_point" });
    expect(check(two)).toEqual({ play: two, notes: [], unnamed: [] });
  });

  it("settles the play's offense from its events when Claude left it blank", () => {
    const { play: fixed } = check(play("RENNICK 5 yd run", [ev("A31-RENNICK", "rush", 5)], { offense: null, playType: "run" }));
    expect(fixed.offense).toBe("away");
  });
});
