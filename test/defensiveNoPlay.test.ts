import { describe, expect, it } from "vitest";
import { defensiveNoPlay, withDefensiveNoPlay } from "@/lib/livestats/penalty";
import { STATS_SYSTEM_PROMPT } from "@/lib/livestats/prompt";
import { EMPTY_SESSION, okPlay, readPlays, talliesOf } from "@/lib/livestats/session";
import { type Action, type Penalty, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// R46 (fix 6, Part 4a): a defensive holding, illegal contact or pass
// interference foul accepted on a pass makes it a no-play. Made-up names.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Dax", last: "Prewitt", position: "WR" },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "CB" },
];
function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}
const DEFENSE: Penalty = { on: "defense", noPlay: false, beforeSnap: false, penaltyYards: 5 };
function play(events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart: 1,
    seqEnd: 2,
    quarter: 1,
    clock: null,
    down: 2,
    distance: 8,
    offense: "home",
    playType: "pass",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: "a pass",
    evidence: "castellane prewitt quillon",
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: DEFENSE,
    ...extra,
  };
}
const catchPlay = (extra: Partial<StatsPlay> = {}) => play([ev("H7-CASTELLANE", "pass_complete", 11), ev("H81-PREWITT", "reception", 11)], extra);
const miss = (extra: Partial<StatsPlay> = {}) => play([ev("H7-CASTELLANE", "pass_incomplete")], extra);

describe("R46", () => {
  it("wipes out a pass with an accepted defensive holding, illegal contact or pass interference foul, caught or not", () => {
    expect(defensiveNoPlay(miss(), "incomplete and a flag illegal contact on quillon automatic first down")).toBe(true);
    expect(defensiveNoPlay(miss(), "flag on the play defensive holding number 17 that is a first down")).toBe(true);
    expect(defensiveNoPlay(catchPlay(), "prewitt makes the catch but the flag is pass interference on quillon and they will take the penalty")).toBe(true);
  });

  it("leaves standing a foul after the play, a declined flag, a run, a foul before the snap and a flag on the offense", () => {
    expect(defensiveNoPlay(miss(), "roughing the passer on quillon tacked on to the end of the play")).toBe(false);
    expect(defensiveNoPlay(catchPlay(), "a face mask on quillon after the catch")).toBe(false);
    expect(defensiveNoPlay(catchPlay(), "holding on the defense but they decline it and take the play")).toBe(false);
    expect(defensiveNoPlay(play([ev("H22-FENNIMORE", "rush", 4)], { playType: "run" }), "holding on the defense")).toBe(false);
    expect(defensiveNoPlay(miss({ penalty: { ...DEFENSE, beforeSnap: true } }), "offside defense free play incomplete")).toBe(false);
    expect(defensiveNoPlay(miss({ penalty: { on: "offense", noPlay: false, beforeSnap: false, penaltyYards: 10 } }), "holding on the offense")).toBe(false);
    // Already a no-play by the reader's own word: nothing to add.
    expect(defensiveNoPlay(miss({ nullified: true }), "illegal contact")).toBe(false);
    expect(withDefensiveNoPlay(miss(), "a clean incompletion").notes).toEqual([]);
  });

  it("counts nothing on the play through readPlays, and notes the rule", () => {
    const utterances = [{ seq: 1, text: "castellane throws to prewitt for 11" }, { seq: 2, text: "but there is a flag defensive holding on quillon automatic first down" }];
    const read = readPlays(EMPTY_SESSION, [catchPlay()], ROSTER, 1000, { utterances });
    const entry = read.added[0];
    expect(entry.play.nullified).toBe(true);
    expect(entry.changes).toEqual([]);
    expect(entry.dropped).toContainEqual(expect.objectContaining({ rule: "R46", kind: "changed" }));
    const session = okPlay(read.session, 1001, entry.playId).session;
    expect(talliesOf(session).get("H7-CASTELLANE")).toBeUndefined();
    // The same words with the flag declined: the catch stands.
    const declined = readPlays(EMPTY_SESSION, [catchPlay()], ROSTER, 1000, { utterances: [utterances[0], { seq: 2, text: "flag for holding on quillon but they will decline it and take the play" }] });
    expect(declined.added[0].play.nullified).toBe(false);
    expect(declined.added[0].changes).toContainEqual({ playerId: "H81-PREWITT", key: "rec_yds", amount: 11, estimated: false });
  });

  it("is in the reader's prompt in general terms", () => {
    expect(STATS_SYSTEM_PROMPT).toContain("A defensive holding, illegal contact or pass interference foul accepted on a pass play");
    expect(STATS_SYSTEM_PROMPT).toContain("roughing the passer, a face mask and fouls after the play leave the play standing");
  });
});
