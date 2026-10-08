import { describe, expect, it } from "vitest";
import { applyPlay } from "@/lib/livestats/apply";
import { checkPlay, fixMisreads } from "@/lib/livestats/check";
import { playerLabel } from "@/lib/livestats/describe";
import { validatePlays } from "@/lib/livestats/validate";
import type { Action, StatsEvent, StatsPlay, StatsRosterPlayer, YardsSource } from "@/lib/livestats/types";

// The reader's misreads the code puts right (R29, R30), and a player nobody
// could read (playerId ""). Made-up names only.

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB", season: { pass_att: 120 } },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR" },
  { playerId: "H3-BOOTHBY", side: "home", jersey: "3", first: "Kit", last: "Boothby", position: "K" },
  { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
  { playerId: "A9-VASKO", side: "away", jersey: "9", first: "Olen", last: "Vasko", position: "P" },
];
const QBS = { home: "H7-CASTELLANE", away: null };

function ev(playerId: string, action: Action, yards: number | null = null, yardsSource: YardsSource | null = yards === null ? null : "stated", made: boolean | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource, made };
}
function play(summary: string, evidence: string, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart: 10,
    seqEnd: 11,
    quarter: 2,
    clock: null,
    down: 1,
    distance: 10,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary,
    evidence,
    events,
    ...extra,
  };
}
const eventsOf = (p: StatsPlay) => p.events.map((event) => `${event.playerId} ${event.action}`);

describe("R29: a return that did not follow a kickoff is a run", () => {
  const missedKick = play("VASKO field goal, no good", "vasko from 48, wide left", [ev("A9-VASKO", "field_goal", 48, "stated", false)], { playType: "field_goal", offense: "away" });
  const punt = play("VASKO punt", "vasko punts it away", [ev("A9-VASKO", "punt", 42)], { playType: "punt", offense: "away" });
  const pitch = play("FENNIMORE return", "pitch, and fennimore, there he goes across midfield", [ev("H22-FENNIMORE", "kick_return", 18)], { playType: "kickoff" });

  it("a pitch or handoff right after a missed field goal or a punt is a run", () => {
    for (const previous of [missedKick, punt]) {
      const { play: fixed, notes } = fixMisreads(pitch, previous);
      expect(fixed.playType).toBe("run");
      expect(eventsOf(fixed)).toEqual(["H22-FENNIMORE rush"]);
      expect(notes.map((note) => `${note.rule} ${note.kind}`)).toEqual(["R29 changed"]);
      expect(applyPlay(fixed, ROSTER).deltas[0].stats).toEqual({ rush_att: 1, rush_yds: 18 });
    }
  });

  it("a kick return on a play that is not a kickoff is a run too, and a real kickoff after a score stays", () => {
    const odd = { ...pitch, playType: "run" as const };
    expect(eventsOf(fixMisreads(odd, null).play)).toEqual(["H22-FENNIMORE rush"]);
    const kickoff = play("FENNIMORE kick return", "the kickoff, fennimore brings it out to the 30", [ev("H22-FENNIMORE", "kick_return", 25)], { playType: "kickoff" });
    const madeKick = { ...missedKick, events: [ev("A9-VASKO", "field_goal", 48, "stated", true)] };
    expect(fixMisreads(kickoff, madeKick).notes).toEqual([]);
    // After a punt but with no run word in the words: left as read.
    expect(fixMisreads(kickoff, punt).notes).toEqual([]);
  });

  it("runs inside the check, with the previous play from the context", () => {
    const { play: fixed } = checkPlay(pitch, ROSTER, { qbs: QBS, previous: punt });
    expect(fixed.playType).toBe("run");
  });
});

describe("a sack is a sack (Oct 6: R30 is gone)", () => {
  const goesDown = play("CASTELLANE sacked by DUNMORE", "castellane goes down again, dunmore got him", [ev("H7-CASTELLANE", "sacked"), ev("A17-DUNMORE", "sack")], { playType: "sack" });

  it("with no sack word and no loss stated, the reader's sack stands: one carry for the quarterback, the sack and its tackle for the defender", () => {
    const { play: fixed, notes } = fixMisreads(goesDown, null);
    expect(notes).toEqual([]);
    expect(fixed).toBe(goesDown);
    const checked = checkPlay(goesDown, ROSTER, { qbs: QBS });
    expect(checked.notes).toEqual([]);
    const applied = applyPlay(checked.play, ROSTER);
    expect(applied.deltas.find((delta) => delta.playerId === "H7-CASTELLANE")?.stats).toEqual({ rush_att: 1 });
    expect(applied.deltas.find((delta) => delta.playerId === "A17-DUNMORE")?.stats).toEqual({ sacks: 1, tkl: 1 });
  });
});

describe("a player nobody could read", () => {
  it("validation keeps an empty playerId on a pass, a run or a catch, and drops it on a tackle", () => {
    const raw = {
      plays: [
        {
          seqStart: 0,
          seqEnd: 1,
          quarter: null, clock: null, down: null, distance: null, offense: "home",
          playType: "pass", nullified: false, touchdown: false, firstDown: false, confidence: 0.5,
          summary: "pass to PREWITT", evidence: "x", updates: "", startSpot: null, endSpot: null, shortBy: null, score: null,
          penalty: { on: "none", noPlay: false, beforeSnap: false },
          events: [
            { playerId: "", action: "pass_complete", yards: 9, yardsSource: "stated", made: null },
            { playerId: "H81-PREWITT", action: "reception", yards: 9, yardsSource: "stated", made: null },
            { playerId: "", action: "tackle", yards: null, yardsSource: null, made: null },
            { playerId: "", action: "rush", yards: null, yardsSource: null, made: null },
          ],
        },
      ],
    };
    const [validated] = validatePlays(raw, { utterances: [{ seq: 0, text: "a", offsetMs: 0 }, { seq: 1, text: "b", offsetMs: 0 }] });
    expect(eventsOf(validated)).toEqual([" pass_complete", "H81-PREWITT reception", " rush"]);
    expect(validated.score).toBeNull();
    expect(validated.penalty).toEqual({ on: "none", noPlay: false, beforeSnap: false });
  });

  it("a pass with no passer goes to the quarterback on the field; a carry by nobody shows as unknown and credits nobody", () => {
    const pass = play("pass to PREWITT for 9", "throws to prewitt for 9", [ev("", "pass_complete", 9), ev("H81-PREWITT", "reception", 9)], { playType: "pass" });
    const checked = checkPlay(pass, ROSTER, { qbs: QBS });
    expect(eventsOf(checked.play)).toEqual(["H7-CASTELLANE pass_complete", "H81-PREWITT reception"]);
    expect(checked.notes.map((note) => `${note.rule} ${note.kind} -> ${note.to}`)).toEqual(["R14 filled -> H7-CASTELLANE"]);

    const carry = play("run up the middle for 4, DUNMORE tackle", "up the middle for 4 dunmore", [ev("", "rush", 4), ev("A17-DUNMORE", "tackle")]);
    const kept = checkPlay(carry, ROSTER, { qbs: QBS });
    expect(eventsOf(kept.play)).toEqual([" rush", "A17-DUNMORE tackle"]);
    const applied = applyPlay(kept.play, ROSTER);
    expect(applied.deltas.map((delta) => delta.playerId)).toEqual(["A17-DUNMORE"]);
    expect(applied.dropped).toEqual([{ event: kept.play.events[0], rule: "R9", reason: "nobody could be read for this" }]);
    expect(playerLabel("", undefined)).toBe("UNKNOWN");
  });

  it("validation reads the score and the flag", () => {
    const base = {
      seqStart: 0, seqEnd: 0, quarter: null, clock: null, down: null, distance: null, offense: null,
      playType: "penalty_only", nullified: false, touchdown: false, firstDown: false, confidence: 0.9,
      summary: "flag", evidence: "", updates: "", startSpot: null, endSpot: null, shortBy: null, events: [],
    };
    const window = { utterances: [{ seq: 0, text: "a", offsetMs: 0 }] };
    expect(validatePlays({ plays: [{ ...base, score: { home: 14, away: 7 }, penalty: { on: "offense", noPlay: true, beforeSnap: false } }] }, window)[0]).toMatchObject({
      score: { home: 14, away: 7 },
      penalty: { on: "offense", noPlay: true, beforeSnap: false },
    });
    expect(validatePlays({ plays: [{ ...base, score: { home: 14 }, penalty: { noPlay: true } }] }, window)[0]).toMatchObject({
      score: null,
      penalty: { on: "unknown", noPlay: true, beforeSnap: false },
    });
    expect(validatePlays({ plays: [{ ...base, score: null, penalty: "holding" }] }, window)[0]).toMatchObject({
      score: null,
      penalty: { on: "none", noPlay: false, beforeSnap: false },
    });
  });
});
