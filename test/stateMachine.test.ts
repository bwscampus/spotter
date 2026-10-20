import { describe, expect, it } from "vitest";
import { parseContextFor, parseLine } from "@/lib/livestats/parse";
import { GameTracker } from "@/lib/livestats/stateMachine";
import { NO_PENALTY, type StatsPlay } from "@/lib/livestats/types";
import { ROSTER, TEAMS } from "./parse/roster";

// The game-state tracker (v7, Part 4): phases, the next snap as the booth
// says it and as the plays imply it. Synthetic.

const context = parseContextFor(ROSTER, TEAMS, "home");

function run(seqStart: number, seqEnd: number, yards: number | null, extra: Partial<StatsPlay> = {}): StatsPlay {
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
    summary: "FENNIMORE run",
    evidence: "",
    events: [{ playerId: "H22-FENNIMORE", action: "rush", yards, yardsSource: yards === null ? null : "stated", made: null }],
    penalty: NO_PENALTY,
    startSpot: null,
    endSpot: null,
    ...extra,
  };
}

describe("GameTracker", () => {
  it("walks PRE_SNAP, LIVE, DEAD and back on a call, a snap, a result and a play", () => {
    const tracker = new GameTracker(TEAMS);
    tracker.onLine(parseLine("sharks ball first and 10 at their own 25", context, 0));
    expect(tracker.snapshot()).toMatchObject({ phase: "PRE_SNAP", possession: "home", next: { down: 1, distance: 10, spot: 25, spotSaid: true } });
    tracker.onLine(parseLine("castellane takes the snap hands off to fennimore", context, 1));
    expect(tracker.snapshot().phase).toBe("LIVE");
    tracker.onLine(parseLine("brought down by quillon", context, 2));
    expect(tracker.snapshot().phase).toBe("DEAD");
    tracker.onPlay(run(1, 2, 4, { startSpot: { yardLine: 25, territory: "home" } }));
    expect(tracker.snapshot()).toMatchObject({ phase: "PRE_SNAP", next: { down: 2, distance: 6, spot: 29, spotSaid: false } });
    expect(tracker.transitions.map((t) => `${t.from}>${t.to}:${t.by}`)).toEqual(["PRE_SNAP>LIVE:snap", "LIVE>DEAD:result", "DEAD>PRE_SNAP:play"]);
  });

  it("goes through the pending states on a flag, a score and a turnover", () => {
    const tracker = new GameTracker(TEAMS);
    tracker.onLine(parseLine("castellane throws deep", context, 0));
    tracker.onLine(parseLine("caught and brought down at the 40 but there is a flag", context, 1));
    expect(tracker.snapshot().phase).toBe("PENALTY_PENDING");
    tracker.onLine(parseLine("second and 15", context, 2));
    expect(tracker.snapshot().phase).toBe("PRE_SNAP");
    tracker.onLine(parseLine("castellane keeps it himself", context, 3));
    tracker.onLine(parseLine("touchdown sharks", context, 4));
    expect(tracker.snapshot().phase).toBe("SCORE_PENDING");
    tracker.onPlay(run(3, 4, 15, { touchdown: true }));
    expect(tracker.snapshot().phase).toBe("PRE_SNAP");
    tracker.onLine(parseLine("langan throws it", context, 5));
    tracker.onLine(parseLine("intercepted by brown", context, 6));
    expect(tracker.snapshot().phase).toBe("CHANGE_OF_POSSESSION");
  });

  it("prefers the booth's call to the play's arithmetic for the next snap, until a play spends it", () => {
    const tracker = new GameTracker(TEAMS);
    tracker.onLine(parseLine("first and 10 at the 25", context, 0));
    tracker.onPlay(run(1, 2, 4, { startSpot: { yardLine: 25, territory: "home" } }));
    expect(tracker.expectedNext()).toMatchObject({ down: 2, distance: 6, spot: 29 });
    // The booth says otherwise: a flag moved it.
    tracker.onLine(parseLine("second and 11 from the 24", context, 3));
    expect(tracker.expectedNext()).toMatchObject({ down: 2, distance: 11, spot: 24, spotSaid: true });
    tracker.onPlay(run(4, 5, null, { down: 2, distance: 11, startSpot: { yardLine: 24, territory: "home" } }));
    // The call is spent: third down follows, by how much nobody said.
    expect(tracker.expectedNext()).toMatchObject({ down: 3, distance: null, spotSaid: false });
  });

  it("renders what it knows for the GAME STATE block", () => {
    const tracker = new GameTracker(TEAMS);
    tracker.onLine(parseLine("bulldogs ball second and 3 at the 44", context, 0));
    tracker.onPlay(run(1, 1, 5, { offense: "away", down: 2, distance: 3, quarter: 2, score: { home: 7, away: 3 }, startSpot: { yardLine: 44, territory: "away" } }));
    expect(tracker.readerState()).toEqual({
      teams: { home: "Harborview", away: "Millbrook" },
      quarter: 2,
      score: { home: 7, away: 3 },
      possession: "away",
      down: 1,
      spot: { yardLine: 49, territory: "away" },
      spotSaid: false,
    });
  });
});
