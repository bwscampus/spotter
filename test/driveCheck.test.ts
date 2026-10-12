import { describe, expect, it } from "vitest";
import { driveCheck, driveNet, drivesOf, newlyEnded } from "@/lib/livestats/drives";
import { START_STATE } from "@/lib/livestats/gameState";
import { EMPTY_SESSION, okPlay, readPlays, type SessionPlay } from "@/lib/livestats/session";
import { NO_PENALTY, type Action, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// Drives and the drive check (lib/livestats/drives.ts, R36), and the back-fill
// across a wiped-out play and an incompletion (Part 4). Made-up names.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Dax", last: "Prewitt", position: "WR" },
  { playerId: "H5-DRAKE", side: "home", jersey: "5", first: "Wes", last: "Drake", position: "P" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
  { playerId: "A22-VANTREE", side: "away", jersey: "22", first: "Cole", last: "Vantree", position: "RB" },
];
const SIDE = new Map(ROSTER.map((player) => [player.playerId, player.side]));

function ev(playerId: string, action: Action, yards: number | null = null, source: StatsEvent["yardsSource"] = yards === null ? null : "stated"): StatsEvent {
  return { playerId, action, yards, yardsSource: source, made: null };
}

let seq = 0;
function play(events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  seq += 2;
  return {
    seqStart: seq,
    seqEnd: seq + 1,
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
    summary: "a play",
    evidence: events.map((e) => e.playerId.split("-")[1].toLowerCase()).join(" "),
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: NO_PENALTY,
    ...extra,
  };
}

const run = (yards: number | null, extra: Partial<StatsPlay> = {}) => play([ev("H22-FENNIMORE", "rush", yards)], extra);
const punt = (extra: Partial<StatsPlay> = {}) => play([ev("H5-DRAKE", "punt", 40)], { playType: "punt", ...extra });

/** Read in and counted, one reply at a time, so the drive check runs when the drive ends. */
function counted(plays: StatsPlay[], replies: number[][] = [plays.map((_, i) => i)]): SessionPlay[] {
  let session = EMPTY_SESSION;
  for (const indexes of replies) {
    const read = readPlays(session, indexes.map((i) => plays[i]), ROSTER, 0);
    session = read.session;
    for (const each of read.added) session = okPlay(session, 1, each.playId).session;
  }
  return session.plays;
}

describe("drives", () => {
  it("cuts the counted plays at a punt, a field goal, a touchdown and its try, a turnover and a change of offense", () => {
    seq = 0;
    const plays = counted([
      run(5),
      punt(),
      play([ev("A22-VANTREE", "rush", 3)], { offense: "away" }),
      play([ev("A22-VANTREE", "rush", 12)], { offense: "away", touchdown: true }),
      play([ev("A17-QUILLON", "extra_point", null)], { offense: "away", playType: "extra_point" }),
      play([], { playType: "kickoff", offense: "away" }),
      run(4),
      play([ev("H7-CASTELLANE", "pass_intercepted"), ev("A17-QUILLON", "interception", 5)], { playType: "pass" }),
      play([ev("A22-VANTREE", "rush", 2)], { offense: "away" }),
      run(1),
    ]);
    const drives = drivesOf(plays, SIDE);
    expect(drives.map((drive) => `${drive.offense} ${drive.plays.length} ${drive.endedBy}`)).toEqual([
      "home 2 punt",
      "away 3 touchdown",
      "home 2 turnover",
      "away 1 possession",
      "home 1 null",
    ]);
    // The try rides with the touchdown.
    expect(drives[1].plays[2].play.playType).toBe("extra_point");
  });

  it("knows which drives ended in this read", () => {
    seq = 0;
    const before = counted([run(5)]);
    const after = counted([run(5), punt()]);
    expect(newlyEnded(drivesOf(before, SIDE), drivesOf(after, SIDE)).map((drive) => drive.endedBy)).toEqual(["punt"]);
    expect(newlyEnded(drivesOf(after, SIDE), drivesOf(after, SIDE))).toEqual([]);
  });
});

describe("the drive check (R36)", () => {
  it("fills the one blank play from the drive's net gain, marked estimated, and logs the rule", () => {
    seq = 0;
    const plays = [
      run(6, { startSpot: { yardLine: 20, territory: "home" }, down: 1, distance: 10 }),
      run(null, { down: 2, distance: 4 }),
      run(3, { down: 1, distance: 10 }),
      // Punted from the home 41: 21 net, 9 credited, so the blank play is 12.
      punt({ down: 4, distance: 7, startSpot: { yardLine: 41, territory: "home" } }),
    ];
    const read = counted(plays, [[0], [1], [2], [3]]);
    const blank = read[1];
    expect(blank.play.events[0]).toMatchObject({ yards: 12, yardsSource: "drive" });
    expect(blank.changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 12, estimated: true });
    expect(blank.dropped).toContainEqual(expect.objectContaining({ rule: "R36", kind: "changed" }));
    expect(driveNet(drivesOf(read, SIDE)[0], START_STATE)).toBe(21);
  });

  it("logs the mismatch and fills nothing when no play is blank, and fills nothing when two are", () => {
    seq = 0;
    const noBlank = counted(
      [
        run(6, { startSpot: { yardLine: 20, territory: "home" } }),
        run(5),
        punt({ startSpot: { yardLine: 41, territory: "home" } }),
      ],
      [[0], [1], [2]],
    );
    expect(noBlank[1].play.events[0].yards).toBe(5);
    expect(noBlank[2].dropped).toContainEqual(expect.objectContaining({ rule: "R36", kind: "noted", reason: expect.stringMatching(/do not add up: 21 net/) }));

    seq = 0;
    const twoBlank = counted(
      [run(6, { startSpot: { yardLine: 20, territory: "home" } }), run(null), run(null), punt({ startSpot: { yardLine: 41, territory: "home" } })],
      [[0], [1], [2], [3]],
    );
    expect(twoBlank[1].play.events[0].yards).toBeNull();
    expect(twoBlank[2].play.events[0].yards).toBeNull();
    expect(twoBlank.flatMap((play) => play.dropped).filter((note) => note.rule === "R36")).toEqual([]);
  });

  it("counts penalty yards, and fills nothing when a flag's yards were not said", () => {
    seq = 0;
    // A 10-yard flag on the defense, tacked on to a 3-yard run (a hold on the
    // offense would blank the run's own yards, R28).
    const flag = { on: "defense" as const, noPlay: false, beforeSnap: false, penaltyYards: 10 };
    const withFlag = counted(
      [run(6, { startSpot: { yardLine: 20, territory: "home" } }), run(3, { penalty: flag }), run(null), punt({ startSpot: { yardLine: 41, territory: "home" } })],
      [[0], [1], [2], [3]],
    );
    // 21 net; 6 + 3 + 10 = 19 credited, so the blank play is 2.
    expect(withFlag[2].play.events[0]).toMatchObject({ yards: 2, yardsSource: "drive" });

    seq = 0;
    const unsaid = counted(
      [run(6, { startSpot: { yardLine: 20, territory: "home" } }), run(3, { penalty: { ...flag, penaltyYards: null } }), run(null), punt({ startSpot: { yardLine: 41, territory: "home" } })],
      [[0], [1], [2], [3]],
    );
    expect(unsaid[2].play.events[0].yards).toBeNull();
  });

  it("is a decision the check reports, not a running count", () => {
    seq = 0;
    const drives = drivesOf(counted([run(3)]), SIDE);
    expect(driveCheck(drives[0], START_STATE)).toEqual({ filled: null, mismatch: null });
  });
});

describe("back-fill across a wiped-out play and an incompletion", () => {
  it("takes the stated down and distance of a play that was later wiped out: they were true at its snap", () => {
    seq = 0;
    const first = run(null, { down: 1, distance: 10 });
    const wiped = run(4, { down: 2, distance: 3, nullified: true, penalty: { on: "offense", noPlay: true, beforeSnap: false, penaltyYards: 10 } });
    const read = counted([first, wiped], [[0], [1]]);
    expect(read[0].play.events[0]).toMatchObject({ yards: 7, yardsSource: "downs" });
    expect(read[1].changes).toEqual([]);
  });

  it("carries the spot and the down across an incomplete pass to settle the play before it", () => {
    seq = 0;
    const first = run(null, { down: 1, distance: 10, startSpot: { yardLine: 30, territory: "home" } });
    const incomplete = play([ev("H7-CASTELLANE", "pass_incomplete")], { playType: "pass", down: 2, distance: null });
    const next = run(2, { down: 3, distance: 4, startSpot: { yardLine: 36, territory: "home" } });
    const read = counted([first, incomplete, next], [[0], [1], [2]]);
    // The next play's start spot, the home 36, is where the first play ended: 6 yards.
    expect(read[0].play.events[0]).toMatchObject({ yards: 6, yardsSource: "spots" });

    seq = 0;
    const byDowns = counted([run(null, { down: 1, distance: 10 }), play([ev("H7-CASTELLANE", "pass_incomplete")], { playType: "pass", down: 2, distance: null }), run(2, { down: 3, distance: 4 })], [[0], [1], [2]]);
    expect(byDowns[0].play.events[0]).toMatchObject({ yards: 6, yardsSource: "downs" });
  });
});
