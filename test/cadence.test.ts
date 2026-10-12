import { describe, expect, it } from "vitest";
import { StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { NO_PENALTY, NO_USAGE, type ExtractStatsRequest, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import { CADENCE_MS, MIN_GAP_MS, shouldAsk } from "@/lib/plays/window";

// =============================================================================
// Reading more often (Part 6): the plain cadence is 30 s, and the end of a
// play the reader just returned is a play boundary, so the next call goes at
// the floor once more football is said. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

function run(seqStart: number, seqEnd: number): StatsPlay {
  return {
    seqStart,
    seqEnd,
    quarter: null,
    clock: null,
    down: null,
    distance: null,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.8,
    summary: "FENNIMORE run",
    evidence: "fennimore",
    events: [{ playerId: "H22-FENNIMORE", action: "rush", yards: 4, yardsSource: "stated", made: null }],
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: NO_PENALTY,
  };
}

describe("the cadence", () => {
  it("is 30 s, with the 10 s floor and the play talk gate", () => {
    expect(CADENCE_MS).toBe(30_000);
    expect(MIN_GAP_MS).toBe(10_000);
    expect(shouldAsk({ now: 29_000, lastCallAt: 0, boundarySeen: false, worthReading: true })).toBe(false);
    expect(shouldAsk({ now: 30_000, lastCallAt: 0, boundarySeen: false, worthReading: true })).toBe(true);
    expect(shouldAsk({ now: 30_000, lastCallAt: 0, boundarySeen: true, worthReading: false })).toBe(false);
    expect(shouldAsk({ now: 9_000, lastCallAt: 0, boundarySeen: true, worthReading: true })).toBe(false);
  });
});

describe("the end of a play the reader returned", () => {
  const START = 1_800_000_000_000;

  function harness() {
    let now = START;
    const requests: ExtractStatsRequest[] = [];
    const answers: Array<(reply: ExtractReply) => void> = [];
    const controller = new StatsController({
      gameId: "g1",
      startedAt: START,
      roster: ROSTER,
      autoOk: true,
      deps: {
        extract: (request) => {
          requests.push(request);
          return new Promise((resolve) => answers.push(resolve));
        },
        log: () => undefined,
        readLog: async () => [],
        track: () => undefined,
        now: () => now,
      },
    });
    return {
      controller,
      requests,
      say(text: string, ms = 1000) {
        now += ms;
        controller.heard(text, now);
      },
      advance(ms: number) {
        now += ms;
      },
      async answer(reply: ExtractReply) {
        answers.shift()!(reply);
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    };
  }

  it("is a boundary: the next call goes at the floor once more football is said, not at the cadence", async () => {
    const h = harness();
    await h.controller.start();
    // The first thing said is asked about alone.
    h.say("kickoff is away", 1_000);
    expect(h.requests).toHaveLength(1);
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    h.say("fennimore takes the handoff for four", 11_000);
    h.say("quillon on the stop", 2_000);
    h.say("first and ten", 1_000);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].utterances.map((line) => line.seq)).toEqual([0, 1, 2, 3]);
    // The play ended on line 2; line 3 begins the next snap.
    await h.answer({ ok: true, plays: [run(1, 2)], usage: NO_USAGE });
    h.say("fennimore again up the middle", 11_000);
    h.controller.tick();
    expect(h.requests).toHaveLength(3);

    // A play that ran to the window's last line is not a boundary: the next call waits for a down and distance or the cadence.
    await h.answer({ ok: true, plays: [run(4, 4)], usage: NO_USAGE });
    h.say("fennimore keeps his feet", 11_000);
    h.controller.tick();
    expect(h.requests).toHaveLength(3);
    h.advance(CADENCE_MS);
    h.controller.tick();
    expect(h.requests).toHaveLength(4);
  });
});
