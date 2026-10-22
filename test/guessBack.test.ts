import { describe, expect, it } from "vitest";
import { GUESS_MIN_CARRIES, GUESS_SHARE, leadingRushers } from "@/lib/livestats/check";
import { EMPTY_SESSION, okPlay, readPlays, type StatsSession } from "@/lib/livestats/session";
import { guessBackSetting } from "@/lib/livestats/settings";
import { NO_PENALTY, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// R51 (Oct 22, the v6 push): a run nobody was named for goes to tonight's
// leading rusher, estimated, behind LIVE_STATS_GUESS_RB. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-ALDERWICK", side: "home", jersey: "7", first: "Tam", last: "Alderwick", position: "QB", season: { pass_att: 140 } },
  { playerId: "H22-WEXCOMBE", side: "home", jersey: "22", first: "Bram", last: "Wexcombe", position: "RB" },
  { playerId: "H30-VENRO", side: "home", jersey: "30", first: "Ike", last: "Venro", position: "RB" },
  { playerId: "H66-ORLOP", side: "home", jersey: "66", first: "Dag", last: "Orlop", position: "OL" },
  { playerId: "A5-MARDEN", side: "away", jersey: "5", first: "Cy", last: "Marden", position: "LB" },
];

function run(seq: number, playerId: string, extra: Partial<StatsPlay> = {}, event: Partial<StatsEvent> = {}): StatsPlay {
  return {
    seqStart: seq, seqEnd: seq, quarter: 2, clock: null, down: 1, distance: 10, offense: "home", playType: "run", nullified: false, touchdown: false, firstDown: false, confidence: 0.9,
    summary: "run", evidence: "", updates: "", startSpot: null, endSpot: null, shortBy: null, penalty: NO_PENALTY,
    events: [{ playerId, action: "rush", yards: 3, yardsSource: "stated", made: null, ...event }],
    ...extra,
  };
}

/** Four carries named for the back, read and counted one by one, then the lines for one more run. */
function afterCarries(count: number, by = "H22-WEXCOMBE"): { session: StatsSession; lines: Array<{ seq: number; text: string }> } {
  let session = EMPTY_SESSION;
  const lines: Array<{ seq: number; text: string }> = [];
  for (let n = 0; n < count; n++) {
    const seq = n * 3 + 1;
    lines.push({ seq, text: `${by === "H22-WEXCOMBE" ? "wexcombe" : "venro"} up the middle for 3` });
    session = readPlays(session, [run(seq, by)], ROSTER, 1000 + n, { utterances: lines, readThrough: seq }).session;
    session = okPlay(session, 1000 + n).session;
  }
  return { session, lines };
}
const UNNAMED = (seq: number, text: string, extra: Partial<StatsPlay> = {}) => ({ play: run(seq, "", { summary: "run up the middle", ...extra }, { yards: 4 }), line: { seq, text } });
const rusher = (session: StatsSession) => session.plays.at(-1)!.play.events.find((event) => event.action === "rush")!;

describe("R51: a guessed back on a run nobody was named for", () => {
  it("counts only named carries by skill players, and leads only by enough", () => {
    expect([GUESS_MIN_CARRIES, GUESS_SHARE]).toEqual([4, 0.7]);
    const named = (n: number, id: string) => Array.from({ length: n }, (_, k) => run(k, id));
    expect(leadingRushers(ROSTER, named(4, "H22-WEXCOMBE")).home).toEqual({ playerId: "H22-WEXCOMBE", carries: 4, total: 4 });
    expect(leadingRushers(ROSTER, named(3, "H22-WEXCOMBE")).home).toBeNull();
    // 4 of 6 is under the share.
    expect(leadingRushers(ROSTER, [...named(4, "H22-WEXCOMBE"), ...named(2, "H30-VENRO")]).home).toBeNull();
    // A filled-in carry is not a named one; a lineman never leads; nor does a player out tonight.
    expect(leadingRushers(ROSTER, [...named(3, "H22-WEXCOMBE"), run(9, "H22-WEXCOMBE", {}, { estimated: true })]).home).toBeNull();
    expect(leadingRushers(ROSTER, named(5, "H66-ORLOP")).home).toBeNull();
    expect(leadingRushers(ROSTER, named(5, "H22-WEXCOMBE"), new Set(["H22-WEXCOMBE"])).home).toBeNull();
    expect(leadingRushers(ROSTER, named(5, "H22-WEXCOMBE")).away).toBeNull();
  });

  it("gives the unnamed run to the leading rusher, estimated, only when the switch is on", () => {
    const { session, lines } = afterCarries(4);
    const next = UNNAMED(20, "hand off up the middle for 4");
    const on = readPlays(session, [next.play], ROSTER, 2000, { utterances: [...lines, next.line], readThrough: 20, guessBack: true });
    expect(rusher(on.session)).toMatchObject({ playerId: "H22-WEXCOMBE", estimated: true });
    expect(on.added[0].dropped).toContainEqual(expect.objectContaining({ rule: "R51", kind: "filled", to: "H22-WEXCOMBE", reason: "no runner named; tonight's leading rusher (4 of 4 named carries)" }));
    const off = readPlays(session, [next.play], ROSTER, 2000, { utterances: [...lines, next.line], readThrough: 20 });
    expect(rusher(off.session).playerId).toBe("");
  });

  it("never guesses on a keeper, at the goal line, or for a player out tonight", () => {
    const { session, lines } = afterCarries(4);
    const guess = (text: string, extra: Partial<StatsPlay> = {}, out?: Set<string>) => {
      const next = UNNAMED(20, text, extra);
      return rusher(readPlays(session, [next.play], ROSTER, 2000, { utterances: [...lines, next.line], readThrough: 20, guessBack: true, ...(out ? { out } : {}) }).session).playerId;
    };
    expect(guess("quarterback keeps it for 4")).toBe("");
    expect(guess("first and goal hand off")).toBe("");
    expect(guess("hand off", { startSpot: { yardLine: 2, territory: "away" } })).toBe("");
    expect(guess("hand off", {}, new Set(["H22-WEXCOMBE"]))).toBe("");
    // From his own 2, the goal line is 98 yards away.
    expect(guess("hand off", { startSpot: { yardLine: 2, territory: "home" } })).toBe("H22-WEXCOMBE");
  });
});

describe("LIVE_STATS_GUESS_RB", () => {
  it("is off unless set to 1, true or on", () => {
    expect(guessBackSetting({})).toBe(false);
    expect(guessBackSetting({ LIVE_STATS_GUESS_RB: "1" })).toBe(true);
    expect(guessBackSetting({ LIVE_STATS_GUESS_RB: " On " })).toBe(true);
    expect(guessBackSetting({ LIVE_STATS_GUESS_RB: "yes please" })).toBe(false);
  });
});
