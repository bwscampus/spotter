import { describe, expect, it } from "vitest";
import { readerGameState, renderGameState } from "@/lib/livestats/gameStateBlock";
import { APPROX_SPOT_YARDS, DOWNS_WEIGHT, EXACT_SPOT_WEIGHT, MAX_HALF_COMBOS, MAX_LEDGER_GAIN_YARDS, NEARER_READING_MARGIN, STATED_WEIGHT } from "@/lib/livestats/ledger";
import { discardPlay, EMPTY_SESSION, okPlay, readPlays, settleLedger, solveSessionDrives, talliesOf, undoLast, type SessionPlay, type StatsSession } from "@/lib/livestats/session";
import { NO_PENALTY, type Action, type FieldSpot, type StatsEvent, type StatsPlay, type StatsRosterPlayer, type TeamWords } from "@/lib/livestats/types";

// =============================================================================
// The drive ledger (lib/livestats/ledger.ts, fix 6 Part 2, R43): every snap of
// a drive placed from every fact at once. Made-up teams, names and lines.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Dax", last: "Prewitt", position: "WR" },
  { playerId: "H5-DRAKE", side: "home", jersey: "5", first: "Wes", last: "Drake", position: "P" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];
const TEAMS: TeamWords = { home: { name: "Northfield", phrases: ["northfield", "bears"] }, away: { name: "Southpoint", phrases: ["southpoint", "tigers"] } };

const spot = (yardLine: number, territory: FieldSpot["territory"] = "home", approximate = false): FieldSpot => ({ yardLine, territory, ...(approximate ? { approximate: true } : {}) });
function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}
function play(seqStart: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd: seqStart,
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
const run = (seq: number, yards: number | null, extra: Partial<StatsPlay> = {}) => play(seq, [ev("H22-FENNIMORE", "rush", yards)], extra);
const pass = (seq: number, yards: number | null, extra: Partial<StatsPlay> = {}) => play(seq, [ev("H7-CASTELLANE", "pass_complete", yards), ev("H81-PREWITT", "reception", yards)], { playType: "pass", ...extra });

/** Read one reply at a time and counted, with the words said. */
function counted(plays: StatsPlay[], utterances: Array<{ seq: number; text: string }> = []): StatsSession {
  let session = EMPTY_SESSION;
  for (const each of plays) {
    const read = readPlays(session, [each], ROSTER, 1000, { utterances, teams: TEAMS });
    session = read.session;
    for (const added of read.added) session = okPlay(session, 1001, added.playId).session;
  }
  return session;
}
const gainOf = (entry: SessionPlay) => entry.play.events.find((event) => event.action === "rush" || event.action === "reception")!;
const yards = (session: StatsSession, index: number) => gainOf(session.plays[index]).yards;

describe("what the facts pin", () => {
  it("2nd and 8 to 3rd and 3 is a gain of 5, marked estimated with its rule", () => {
    const session = counted([run(1, null, { down: 2, distance: 8 }), run(3, 2, { down: 3, distance: 3 })]);
    expect(gainOf(session.plays[0])).toMatchObject({ yards: 5, yardsSource: "ledger" });
    expect(session.plays[0].changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 5, estimated: true });
    expect(session.plays[0].dropped).toContainEqual(expect.objectContaining({ rule: "R43", kind: "changed" }));
  });

  it("a long completion to a spot with no half: only the half that fits the next first down", () => {
    // From the home 28 to "the 22": the home 22 is a loss of 6, the away 22 a gain of 50. The next snap is 1st and 10.
    const session = counted([pass(1, null, { startSpot: spot(28), endSpot: spot(22, "unknown") }), run(3, 2, { down: 1, distance: 10 })]);
    expect(gainOf(session.plays[0])).toMatchObject({ yards: 50, yardsSource: "ledger" });
    expect(talliesOf(session).get("H7-CASTELLANE")?.stats.pass_yds).toBe(50);
  });

  it('"tackled at the 22" from the 28 followed by 1st and 10 is 50, not minus 6, and inside the cap', () => {
    const session = counted(
      [run(1, null, { startSpot: spot(28), endSpot: spot(22, "unknown") }), run(3, 1, { down: 1, distance: 10 })],
      [{ seq: 1, text: "fennimore breaks free tackled at the 22" }, { seq: 3, text: "first and ten fennimore for 1" }],
    );
    expect(yards(session, 0)).toBe(50);
    expect(MAX_LEDGER_GAIN_YARDS).toBe(60);
  });

  it('"just past the 30" never beats an exact fact; "4 yards shy of the first down" wins, and alone the approximate spot is all there is', () => {
    // 2nd and 14 from the home 20; the catch was "just past the 30" (approximate) and he came up 4 short: a gain of 10, not 10-or-whatever the 30 says.
    const session = counted(
      [pass(1, null, { down: 2, distance: 14, startSpot: spot(20), endSpot: spot(30, "unknown"), shortBy: 4 })],
      [{ seq: 1, text: "castellane to prewitt gets just past the 30 before he is brought down 4 yards shy of the first down" }],
    );
    expect(session.plays[0].play.endSpot).toMatchObject({ approximate: true });
    expect(gainOf(session.plays[0])).toMatchObject({ yards: 10, yardsSource: "ledger" });
    // Approximate alone, with nothing exact to go on, is still the best there is: filled, estimated.
    const alone = counted([run(1, null, { startSpot: spot(20), endSpot: spot(30, "home", true) })]);
    expect(gainOf(alone.plays[0])).toMatchObject({ yards: 10, yardsSource: "ledger" });
    // But an exact spot a few yards off is what the facts say, within the tolerance the approximate one allows.
    const exact = counted([run(1, null, { startSpot: spot(20), endSpot: spot(30, "home", true) }), run(3, 2, { down: 2, distance: 3, startSpot: spot(27) })]);
    expect(yards(exact, 0)).toBe(7);
    expect(APPROX_SPOT_YARDS).toBe(5);
  });

  it('a "big run to the 38" from the 40 is 22, not minus 2: the words break the tie', () => {
    const session = counted([run(1, null, { startSpot: spot(40), endSpot: spot(38, "unknown") })], [{ seq: 1, text: "big run by fennimore out to the 38" }]);
    expect(yards(session, 0)).toBe(22);
    const loss = counted([run(1, null, { startSpot: spot(40), endSpot: spot(38, "unknown") })], [{ seq: 1, text: "fennimore swallowed up for a loss back to the 38" }]);
    expect(yards(loss, 0)).toBe(-2);
  });

  it("stat talk on the next line is not the play's gain", () => {
    const session = counted([run(1, null)], [{ seq: 2, text: "he had a huge 47 yard gain against them two weeks ago" }]);
    expect(yards(session, 0)).toBeNull();
    const said = counted([run(1, null)], [{ seq: 2, text: "fennimore for 11" }]);
    expect(gainOf(said.plays[0])).toMatchObject({ yards: 11, yardsSource: "stated", late: true });
    expect(said.plays[0].changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 11, estimated: false });
  });

  it("two readings that tie fill only the gains they share", () => {
    // The first run ends at "the 48" from the 45: a gain of 3 or of 7, nothing to choose between them. The second run's gain comes from the downs either way.
    const session = counted([run(1, null, { startSpot: spot(45), endSpot: spot(48, "unknown") }), run(3, null, { down: 1, distance: 10 }), run(5, 1, { down: 2, distance: 5 })]);
    expect(yards(session, 0)).toBeNull();
    expect(yards(session, 1)).toBe(5);
    expect(solveSessionDrives(session, ROSTER)[0].tied).toBe(true);
    // From the 20 to "the 26" is 6 or 54: not equally likely, so the nearer reading wins (NEARER_READING_MARGIN).
    const near = counted([run(1, null, { startSpot: spot(20), endSpot: spot(26, "unknown") })]);
    expect(yards(near, 0)).toBe(6);
    expect(NEARER_READING_MARGIN).toBe(20);
  });

  it("never changes a stated yard, and notes one the drive's yard lines contradict", () => {
    // From the home 20, 6 and 5 said, the punt snapped at the home 41: 21 net against 11 said.
    const session = counted([run(1, 6, { startSpot: spot(20) }), run(3, 5), play(5, [ev("H5-DRAKE", "punt", 40)], { playType: "punt", startSpot: spot(41) })]);
    expect(yards(session, 0)).toBe(6);
    expect(yards(session, 1)).toBe(5);
    expect(session.plays[1].dropped).toContainEqual(expect.objectContaining({ rule: "R43", kind: "noted" }));
    // A stated yard the facts agree with is left alone and unnoted.
    const agreed = counted([run(1, 6, { startSpot: spot(20) }), run(3, 15), play(5, [ev("H5-DRAKE", "punt", 40)], { playType: "punt", startSpot: spot(41) })]);
    expect(agreed.plays.flatMap((entry) => entry.dropped).filter((note) => note.rule === "R43")).toEqual([]);
  });

  it("carries the drive across a no-play penalty: the down is kept, the ball moves by the flag", () => {
    // 1st and 10 at the 20, a 5-yard false start (no play, 1st and 15 at the 15), then a run to 2nd and 6: a gain of 9.
    const flag = play(3, [], { playType: "penalty_only", down: 1, distance: 15, penalty: { on: "offense", noPlay: true, beforeSnap: true, penaltyYards: 5 } });
    const session = counted([run(1, 0, { startSpot: spot(20) }), flag, run(5, null, { down: 1, distance: 15 }), run(7, 2, { down: 2, distance: 6 })]);
    expect(yards(session, 2)).toBe(9);
    const drive = solveSessionDrives(session, ROSTER)[0];
    expect(drive.broken).toBe(0);
    expect(drive.next).toMatchObject({ down: 3, distance: 4, spot: 26 });
  });

  it("a worked-out figure is taken back when the play that pinned it is discarded, and comes back when it counts again", () => {
    let session = counted([run(1, null, { down: 2, distance: 8 }), run(3, 2, { down: 3, distance: 3 })]);
    expect(yards(session, 0)).toBe(5);
    // Taken back with U, then thrown away: the play it pinned no longer counts.
    session = undoLast(session, 1500).session;
    expect(yards(session, 0)).toBe(5);
    session = discardPlay(session, 2000, session.plays[1].playId).session;
    const settled = settleLedger(session, ROSTER, {});
    expect(settled.updated.map((play) => play.playId)).toEqual([session.plays[0].playId]);
    expect(gainOf(settled.updated[0])).toMatchObject({ yards: null, yardsSource: null });
    expect(settled.updated[0].dropped).toContainEqual(expect.objectContaining({ rule: "R43", reason: expect.stringMatching(/taken back/) }));
    expect(talliesOf(settled.session).get("H22-FENNIMORE")?.stats.rush_yds).toBeUndefined();
    // Nothing to do when nothing changed.
    expect(settleLedger(settled.session, ROSTER, {}).updated).toEqual([]);
  });

  it("tells the GAME STATE block the next snap, worked out", () => {
    const session = counted([run(1, 4, { startSpot: spot(20), down: 1, distance: 10 })]);
    const state = readerGameState(session.plays, ROSTER, { teams: TEAMS });
    expect(state).toMatchObject({ possession: "home", down: 2, distance: 6, spot: { yardLine: 24, territory: "home" }, spotSaid: false });
    expect(renderGameState(state)).toContain("Ball: Northfield (home) has the ball, 2nd and 6, at the Northfield 24 (worked out).");
    const said = counted([run(1, 4, { startSpot: spot(20), endSpot: spot(24), down: 1, distance: 10 })]);
    expect(readerGameState(said.plays, ROSTER).spotSaid).toBe(true);
  });

  it("weights the facts as the brief says, and enumerates up to six half-less spots", () => {
    expect(STATED_WEIGHT).toBeGreaterThan(DOWNS_WEIGHT);
    expect(DOWNS_WEIGHT).toBeGreaterThan(EXACT_SPOT_WEIGHT);
    expect(MAX_HALF_COMBOS).toBe(64);
    // Seven half-less spots: the seventh is fixed by its nearer anchor, and the drive still solves.
    const plays = Array.from({ length: 7 }, (_, i) => run(i * 2 + 1, null, { down: 1, distance: 10, startSpot: i === 0 ? spot(20) : null, endSpot: spot(25 + i, "unknown"), firstDown: true }));
    const session = counted(plays);
    expect(session.plays).toHaveLength(7);
    expect(solveSessionDrives(session, ROSTER)).toHaveLength(1);
  });
});
