import { describe, expect, it } from "vitest";
import { StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { SECOND_LOOK_PROMPT, volatileContent } from "@/lib/livestats/extract";
import { readRequest } from "@/lib/livestats/request";
import { ACTION_WORDS, SECOND_LOOK_WORD_SPAN, SECOND_LOOKS_PER_GAME, secondLookLines, soundsLikeAPlay } from "@/lib/livestats/secondLook";
import { restoreFromLog } from "@/lib/livestats/session";
import { NO_PENALTY, NO_USAGE, type ExtractStatsRequest, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";

// =============================================================================
// The second look at a quiet window (lib/livestats/secondLook.ts, Part 5).
// Made-up names only; no phrase from any real game.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
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

describe("what sounds like a play", () => {
  it("is a roster surname within a few words of an action word", () => {
    expect(soundsLikeAPlay("fennimore off the left side slips a tackle", ROSTER)).toBe(true);
    expect(soundsLikeAPlay("quillon with the sack", ROSTER)).toBe(true);
    // A close spelling of the surname counts, as it does for the name check.
    expect(soundsLikeAPlay("fenimore carries it again", ROSTER)).toBe(true);
  });

  it("is not a name alone, an action word alone, or the two far apart", () => {
    expect(soundsLikeAPlay("fennimore is a junior from up the road", ROSTER)).toBe(false);
    expect(soundsLikeAPlay("what a run that was last week by the band", ROSTER)).toBe(false);
    // SECOND_LOOK_WORD_SPAN words apart is the edge: one more word between and it is not one clause.
    expect(soundsLikeAPlay(`fennimore ${Array(SECOND_LOOK_WORD_SPAN).fill("very").join(" ")} run`, ROSTER)).toBe(false);
    expect(soundsLikeAPlay(`fennimore ${Array(SECOND_LOOK_WORD_SPAN - 1).fill("very").join(" ")} run`, ROSTER)).toBe(true);
    expect(ACTION_WORDS).toContain("handoff");
    expect(ACTION_WORDS).not.toContain("yards");
  });

  it("looks only at the window's new lines, and keeps a line each side", () => {
    const window = [
      { seq: 10, text: "fennimore carries it", offsetMs: 0 },
      { seq: 11, text: "nice night for it", offsetMs: 1 },
      { seq: 12, text: "the band is here", offsetMs: 2 },
      { seq: 13, text: "fennimore takes the handoff", offsetMs: 3 },
      { seq: 14, text: "slips a tackle", offsetMs: 4 },
    ];
    // Line 10 is the overlap: already read, so it does not trigger on its own.
    expect(secondLookLines(window.slice(0, 3), 11, ROSTER)).toBeNull();
    expect(secondLookLines(window, 11, ROSTER)?.map((line) => line.seq)).toEqual([12, 13, 14]);
    expect(secondLookLines(window, 10, ROSTER)?.map((line) => line.seq)).toEqual([10, 11, 12, 13, 14]);
  });

  it("is said to the reader in one line, and the route keeps the kind of read", () => {
    const request: ExtractStatsRequest = { utterances: [{ seq: 1, text: "x", offsetMs: 0 }], rosters: ROSTER, recentPlays: [], look: "second" };
    expect(volatileContent(request)).toContain(SECOND_LOOK_PROMPT);
    expect(volatileContent({ ...request, look: undefined })).not.toContain("SECOND LOOK");
    const parsed = readRequest({ utterances: [{ seq: 1, text: "x" }], rosters: [], look: "second" });
    expect(parsed && typeof parsed === "object" ? parsed.look : null).toBe("second");
    const first = readRequest({ utterances: [{ seq: 1, text: "x" }], rosters: [], look: "first" });
    expect(first && typeof first === "object" && "look" in first).toBe(false);
  });
});

describe("the loop's second look", () => {
  const START = 1_800_000_000_000;

  function harness(log: readonly { kind: string }[] = []) {
    let now = START;
    const requests: ExtractStatsRequest[] = [];
    const answers: Array<(reply: ExtractReply) => void> = [];
    const logged: StatsRecord[] = [];
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
        log: (record) => logged.push(record),
        readLog: async () => log,
        track: () => undefined,
        now: () => now,
      },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    return {
      controller,
      requests,
      logged,
      say(text: string, ms = 1000) {
        now += ms;
        controller.heard(text, now);
      },
      async answer(reply: ExtractReply) {
        answers.shift()!(reply);
        await settle();
      },
      pending: () => answers.length,
    };
  }

  const empty: ExtractReply = { ok: true, plays: [], usage: NO_USAGE };

  it("asks once more about the lines that sound like a play when the first read returns nothing", async () => {
    const h = harness();
    await h.controller.start();
    h.say("first and ten", 11_000);
    expect(h.requests).toHaveLength(1);
    await h.answer(empty);
    h.say("fennimore off the left side slips a tackle", 11_000);
    h.say("second and six", 1_000);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].look).toBeUndefined();
    await h.answer(empty);
    // The second look: just the new lines that sound like a play, with a line each side.
    expect(h.requests).toHaveLength(3);
    expect(h.requests[2].look).toBe("second");
    expect(h.requests[2].utterances.map((line) => line.seq)).toEqual([0, 1, 2]);
    await h.answer({ ok: true, plays: [run(1, 1)], usage: NO_USAGE });
    expect(h.controller.getView().session.plays).toHaveLength(1);
    const play = h.controller.getView().session.plays[0];
    expect(play.status).toBe("applied");
    expect(play.dropped).toContainEqual(expect.objectContaining({ rule: "R38", kind: "noted" }));
    expect(h.logged.filter((r) => r.kind === "stats_reply").map((r) => (r.kind === "stats_reply" ? r.look : null))).toEqual([undefined, undefined, "second"]);
    expect(h.controller.bridge.counts().secondLooks).toBe(1);
    // A second look is never followed by another, and a reply with plays never gets one.
    h.say("quillon makes the tackle", 11_000);
    h.say("third and two", 1_000);
    await h.answer({ ok: true, plays: [run(3, 3)], usage: NO_USAGE });
    expect(h.requests).toHaveLength(4);
    expect(h.pending()).toBe(0);
  });

  it("takes no second look at lines with only a name or only an action word", async () => {
    const h = harness();
    await h.controller.start();
    h.say("fennimore is a junior from up the road", 11_000);
    h.say("first and ten", 1_000);
    await h.answer(empty);
    expect(h.requests).toHaveLength(1);
    h.say("what a run that was by the band", 11_000);
    h.say("second and ten", 1_000);
    await h.answer(empty);
    expect(h.requests).toHaveLength(2);
  });

  it("holds the game's cap, reloads included", async () => {
    const spent = Array.from({ length: SECOND_LOOKS_PER_GAME }, (_, i) => ({ kind: "stats_reply", gameId: "g1", at: START + i, ok: true, plays: [], look: "second" }));
    expect(restoreFromLog(spent).secondLooks).toBe(SECOND_LOOKS_PER_GAME);
    const h = harness(spent);
    await h.controller.start();
    h.say("fennimore off the left side slips a tackle", 11_000);
    h.say("second and six", 1_000);
    await h.answer(empty);
    expect(h.requests).toHaveLength(1);
    expect(h.controller.bridge.counts().secondLooks).toBe(SECOND_LOOKS_PER_GAME);
  });
});
