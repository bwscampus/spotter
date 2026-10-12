import { describe, expect, it } from "vitest";
import { chatBody } from "@/lib/ai/openrouter";
import { StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { HALFTIME_PROMPT, volatileContent } from "@/lib/livestats/extract";
import { firstHalfEnd, HALFTIME_MIN_PLAYS, HALFTIME_QUIET_MS, HALFTIME_TIMEOUT_MS, halftimeDue, halftimeSaid, secondHalfKickoff, secondHalfPlay } from "@/lib/livestats/halftime";
import { statsChatRequest } from "@/lib/livestats/openrouter";
import { parseScoreArgs } from "@/lib/livestats/scoreArgs";
import { restoreFromLog } from "@/lib/livestats/session";
import { HALFTIME_MODEL, HALFTIME_RATES, HALFTIME_SETTING, ratesFor, settingLabel } from "@/lib/livestats/settings";
import { NO_PENALTY, NO_USAGE, type Action, type ExtractStatsRequest, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";
import { halftimeWords } from "@/components/livestats/StatsStrip";
import { reduceLiveKey, INITIAL_KEY_STATE } from "@/lib/keys";

// =============================================================================
// The halftime checkup (lib/livestats/halftime.ts, Part 8): one read of the
// whole first half by Claude Sonnet 5.5, once a game, in the background.
// Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H34-GRIMSBY", side: "home", jersey: "34", first: "Hal", last: "Grimsby", position: "RB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}

function play(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
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

describe("what halftime sounds like", () => {
  it("is halftime, the end of the first half or the start of the second, in words or as numerals=true writes them", () => {
    for (const text of [
      "and that will do it for the first half",
      "that'll do it for the 0.5",
      "we go to halftime",
      "we're at halftime",
      "end of the 1st 0.5",
      "the halftime score is 14 to 10",
      "heading to the locker room",
      "the 2nd 0.5 is under way",
      "the kickoff to start the second half",
      "intermission",
    ]) {
      expect(halftimeSaid(text), text).toBe(true);
    }
    // A promo for halftime is not halftime (fix 6, Part 4d: one set the check off at the two-minute warning).
    for (const text of ["half a yard short", "fennimore for 0.5", "the second quarter begins", "first and ten", "coming your way at halftime", "coming up at halftime", "the halftime show", "at halftime we will look at the replay", "half time here"]) {
      expect(halftimeSaid(text), text).toBe(false);
    }
    expect(secondHalfKickoff({ quarter: 3, playType: "kickoff" }, undefined)).toBe(true);
    expect(secondHalfKickoff({ quarter: null, playType: "kickoff" }, "here is the kickoff to open the 2nd 0.5")).toBe(true);
    expect(secondHalfKickoff({ quarter: null, playType: "kickoff" }, "kickoff is away")).toBe(false);
    expect(secondHalfKickoff({ quarter: 3, playType: "run" }, undefined)).toBe(false);
    expect(secondHalfPlay({ quarter: 3 })).toBe(true);
    expect(secondHalfPlay({ quarter: 2 })).toBe(false);
    expect(secondHalfPlay({ quarter: null })).toBe(false);
    expect(halftimeDue({ said: false, secondHalfPlay: false, quietAfterSecondQuarter: false })).toBe(false);
    expect(halftimeDue({ said: false, secondHalfPlay: false, quietAfterSecondQuarter: true })).toBe(true);
  });

  it("ends the first half before the first second-half play, else at the halftime line, else now", () => {
    const plays = [
      { play: play(1, 2, [], { quarter: 2 }), status: "applied" },
      { play: play(40, 41, [], { quarter: 3 }), status: "applied" },
    ];
    expect(firstHalfEnd(plays, 30, 60)).toBe(39);
    expect(firstHalfEnd(plays.slice(0, 1), 30, 60)).toBe(30);
    expect(firstHalfEnd(plays.slice(0, 1), null, 60)).toBe(60);
    expect(HALFTIME_QUIET_MS).toBe(6 * 60_000);
    expect(HALFTIME_TIMEOUT_MS).toBe(90_000);
  });
});

describe("the call", () => {
  it("goes to Claude Sonnet 5.5 at low effort with the same privacy routing, and its prices are in the table", () => {
    const request: ExtractStatsRequest = { utterances: [{ seq: 1, text: "x", offsetMs: 0 }], rosters: ROSTER, recentPlays: [], look: "halftime" };
    const chat = statsChatRequest(request, HALFTIME_SETTING);
    expect(chat.model).toBe("anthropic/claude-sonnet-5.5");
    expect(chat.reasoning).toBe("low");
    expect(chat.maxTokens).toBe(16_000);
    expect(chat.content).toContain(HALFTIME_PROMPT);
    expect(volatileContent(request)).toContain("PLAYS ALREADY APPLIED FOR THIS HALF");
    const body = chatBody(chat);
    expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true });
    expect(body).not.toHaveProperty("temperature");
    expect(ratesFor(HALFTIME_MODEL)).toEqual(HALFTIME_RATES);
    expect(HALFTIME_RATES).toEqual({ input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 });
    expect(settingLabel(HALFTIME_SETTING)).toBe("Sonnet 5.5 low");
  });

  it("is the scorer's to leave out, and H is a stats key", () => {
    expect(parseScoreArgs(["x"]).halftime).toBe(true);
    expect(parseScoreArgs(["x", "--no-halftime"]).halftime).toBe(false);
    const press = { key: "h", repeat: false, modifier: false, textEntry: false, now: 1_000, statsKeys: true };
    expect(reduceLiveKey(INITIAL_KEY_STATE, press)).toMatchObject({ action: { type: "halftimeCheck" }, handled: true });
    expect(reduceLiveKey(INITIAL_KEY_STATE, { ...press, statsKeys: false })).toMatchObject({ action: { type: "none" }, handled: false });
  });

  it("is one quiet line on the strip", () => {
    expect(halftimeWords({ halftime: null })).toBeNull();
    expect(halftimeWords({ halftime: { state: "running" } })).toBe("Halftime check running...");
    expect(halftimeWords({ halftime: { state: "done", changes: 6 } })).toBe("Halftime check: 6 changes.");
    expect(halftimeWords({ halftime: { state: "done", changes: 1 } })).toBe("Halftime check: 1 change.");
    expect(halftimeWords({ halftime: { state: "failed", code: "claude_model_missing" } })).toMatch(/^Halftime check did not finish/);
  });
});

describe("the loop's halftime check", () => {
  const START = 1_800_000_000_000;

  function harness(options: { log?: readonly { kind: string }[]; halftime?: boolean } = {}) {
    let now = START;
    const requests: ExtractStatsRequest[] = [];
    const halftimeRequests: ExtractStatsRequest[] = [];
    const answers: Array<(reply: ExtractReply) => void> = [];
    const halftimeAnswers: Array<(reply: ExtractReply) => void> = [];
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
        ...(options.halftime === false
          ? {}
          : {
              halftime: (request: ExtractStatsRequest) => {
                halftimeRequests.push(request);
                return new Promise<ExtractReply>((resolve) => halftimeAnswers.push(resolve));
              },
            }),
        log: (record) => logged.push(record),
        readLog: async () => options.log ?? [],
        track: () => undefined,
        now: () => now,
      },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    return {
      controller,
      requests,
      halftimeRequests,
      logged,
      say(text: string, ms = 1000) {
        now += ms;
        controller.heard(text, now);
      },
      advance(ms: number) {
        now += ms;
      },
      async answer(reply: ExtractReply) {
        answers.shift()!(reply);
        await settle();
      },
      async answerHalftime(reply: ExtractReply) {
        halftimeAnswers.shift()!(reply);
        await settle();
      },
    };
  }

  /** Enough of a half counted for "halftime" to mean the break: HALFTIME_MIN_PLAYS runs, one a line, in the second quarter. */
  async function withAHalf(h: ReturnType<typeof harness>, quarter = 2) {
    await h.controller.start();
    h.say("kickoff is away", 1_000);
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    const lines = HALFTIME_MIN_PLAYS;
    for (let i = 0; i < lines; i++) h.say(i % 2 ? "grimsby picks up a few" : "fennimore picks up a few", 200);
    h.say("second and six", 11_000);
    const plays = Array.from({ length: lines }, (_, i) => play(i + 1, i + 1, [ev(i % 2 ? "H34-GRIMSBY" : "H22-FENNIMORE", "rush", 3)], { quarter }));
    await h.answer({ ok: true, plays, usage: NO_USAGE });
    expect(h.controller.getView().session.plays.filter((p) => p.status === "applied")).toHaveLength(lines);
  }

  it("runs once when the transcript says halftime, after enough of a half, with the whole half and its plays", async () => {
    const h = harness();
    await withAHalf(h);
    h.say("and that is the end of the 1st 0.5", 2_000);
    h.controller.tick();
    expect(h.halftimeRequests).toHaveLength(1);
    const request = h.halftimeRequests[0];
    expect(request.look).toBe("halftime");
    expect(request.utterances[0].seq).toBe(0);
    expect(request.utterances[request.utterances.length - 1].seq).toBe(HALFTIME_MIN_PLAYS + 2);
    expect(request.recentPlays).toHaveLength(HALFTIME_MIN_PLAYS);
    expect(request.recentPlays[0].detail).toBe("H22-FENNIMORE rush 3 yds");
    expect(h.controller.getView().halftime).toEqual({ state: "running" });
    // Said again, or H pressed: nothing more.
    h.say("we are at halftime", 2_000);
    h.controller.tick();
    h.controller.bridge.key("halftime");
    expect(h.halftimeRequests).toHaveLength(1);
  });

  it("does not run on halftime talk before a half has been counted", async () => {
    const h = harness();
    await h.controller.start();
    h.say("fennimore will carry the load after the halftime show", 1_000);
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    h.controller.tick();
    expect(h.halftimeRequests).toHaveLength(0);
  });

  it("runs when the reader returns a play in the third quarter, and still applies when it comes back after that", async () => {
    const h = harness();
    await withAHalf(h);
    // Said inside the floor, so one call reads both lines at the first down.
    h.say("castellane throws to fennimore", 5_000);
    h.say("first and ten", 6_000);
    await h.answer({ ok: true, plays: [play(HALFTIME_MIN_PLAYS + 2, HALFTIME_MIN_PLAYS + 3, [ev("H7-CASTELLANE", "pass_complete", 9), ev("H22-FENNIMORE", "reception", 9)], { quarter: 3, playType: "pass" })], usage: NO_USAGE });
    expect(h.halftimeRequests).toHaveLength(1);
    // The first half ends the line before the third-quarter play begins.
    expect(h.halftimeRequests[0].utterances[h.halftimeRequests[0].utterances.length - 1].seq).toBe(HALFTIME_MIN_PLAYS + 1);
    // A correction: the first run went for 7, not 3. It applies with R40 and is counted as one change.
    await h.answerHalftime({ ok: true, plays: [play(1, 1, [ev("H22-FENNIMORE", "rush", 7)], { updates: "1-1" })], usage: NO_USAGE });
    const fixed = h.controller.getView().session.plays.find((p) => p.playId === "1-1")!;
    expect(fixed.play.events[0]).toMatchObject({ playerId: "H22-FENNIMORE", yards: 7 });
    expect(fixed.changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 7, estimated: false });
    expect(fixed.dropped).toContainEqual(expect.objectContaining({ rule: "R40" }));
    expect(h.controller.getView().halftime).toEqual({ state: "done", changes: 1 });
    expect(h.controller.bridge.counts().halftimeChanges).toBe(1);
    expect(h.logged.filter((r) => r.kind === "stats_reply").pop()).toMatchObject({ ok: true, look: "halftime" });
  });

  it("runs after six quiet minutes following a second-quarter play, and H runs it at once", async () => {
    const quiet = harness();
    await withAHalf(quiet);
    quiet.advance(HALFTIME_QUIET_MS - 1);
    quiet.controller.tick();
    expect(quiet.halftimeRequests).toHaveLength(0);
    quiet.advance(2);
    quiet.controller.tick();
    expect(quiet.halftimeRequests).toHaveLength(1);

    const key = harness();
    await withAHalf(key);
    key.controller.bridge.key("halftime");
    expect(key.halftimeRequests).toHaveLength(1);
    key.controller.bridge.key("halftime");
    key.controller.halftimeCheck();
    expect(key.halftimeRequests).toHaveLength(1);
  });

  it("leaves the plays alone and says so when it fails, and never runs without a route", async () => {
    const h = harness();
    await withAHalf(h);
    const before = JSON.stringify(h.controller.getView().session);
    h.controller.bridge.key("halftime");
    await h.answerHalftime({ ok: false, code: "claude_model_missing" });
    expect(JSON.stringify(h.controller.getView().session)).toBe(before);
    expect(h.controller.getView().halftime).toEqual({ state: "failed", code: "claude_model_missing" });
    expect(h.controller.bridge.counts().halftimeChanges).toBe(-1);
    expect(h.logged.filter((r) => r.kind === "stats_reply").pop()).toMatchObject({ ok: false, code: "claude_model_missing", look: "halftime" });

    const none = harness({ halftime: false });
    await withAHalf(none);
    none.controller.bridge.key("halftime");
    none.advance(HALFTIME_QUIET_MS + 1);
    none.controller.tick();
    expect(none.halftimeRequests).toHaveLength(0);
    expect(none.controller.getView().halftime).toBeNull();
  });

  it("never runs a second time, a reload included", async () => {
    const log: Array<Record<string, unknown> & { kind: string }> = [
      { kind: "stats_reply", gameId: "g1", at: START + 5, ok: true, plays: [], look: "halftime" },
      { kind: "stats_update", gameId: "g1", at: START + 5, playId: "1-1", play: play(1, 1, []), changes: [], dropped: [] },
    ];
    expect(restoreFromLog(log).halftime).toEqual({ state: "done", changes: 1 });
    const failed: Array<Record<string, unknown> & { kind: string }> = [{ kind: "stats_reply", gameId: "g1", at: START, ok: false, code: "halftime_timeout", look: "halftime" }];
    expect(restoreFromLog(failed).halftime).toEqual({ state: "failed", code: "halftime_timeout" });
    const h = harness({ log });
    await withAHalf(h);
    h.controller.bridge.key("halftime");
    h.advance(HALFTIME_QUIET_MS + 1);
    h.controller.tick();
    expect(h.halftimeRequests).toHaveLength(0);
    expect(h.controller.getView().halftime).toEqual({ state: "done", changes: 1 });
  });
});
