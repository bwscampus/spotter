import { afterEach, describe, expect, it, vi } from "vitest";
import { DRIVE_REREAD_TIMEOUT_MS, REREAD_TIMEOUT, StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { creditsLine, driveWindow, DRIVE_TAIL_LINES, drivesOf } from "@/lib/livestats/drives";
import { DRIVE_REREAD_PROMPT, volatileContent } from "@/lib/livestats/extract";
import { readRequest } from "@/lib/livestats/request";
import { correctPlay, EMPTY_SESSION, freshReads, okPlay, readPlays, undoLast, type StatsSession } from "@/lib/livestats/session";
import { NO_PENALTY, NO_USAGE, type Action, type ExtractStatsRequest, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import { validatePlays } from "@/lib/livestats/validate";
import type { StatsRecord } from "@/lib/log/statsLog";

// =============================================================================
// The drive re-read (Part 7): when a drive ends, the whole drive goes back to
// the reader with the plays counted for it, for corrections only, in the
// background. Corrections go through the same checks, never touch anything
// typed, and carry R39. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H34-GRIMSBY", side: "home", jersey: "34", first: "Hal", last: "Grimsby", position: "RB" },
  { playerId: "H5-DRAKE", side: "home", jersey: "5", first: "Wes", last: "Drake", position: "P" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
  { playerId: "A22-VANTREE", side: "away", jersey: "22", first: "Cole", last: "Vantree", position: "RB" },
];
const SIDE = new Map(ROSTER.map((player) => [player.playerId, player.side]));

function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}

function play(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
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

const LINES = [
  "kickoff is away",
  "fennimore takes the handoff or was that grimsby",
  "picks up eight quillon on the stop with vantree",
  "second and two",
  "castellane throws it away",
  "third and two",
  "drake back to punt",
  "a long one downed at the 20",
  "vantree carries it for the visitors",
  "and that is a first down",
];

describe("the drive's window and credits", () => {
  it("runs from the drive's first line to a few lines after its last, no further than the reader has seen, newest kept past the cap", () => {
    const plays = [
      { playId: "1-2", play: play(1, 2, [ev("H22-FENNIMORE", "rush", 8)]), status: "applied" },
      { playId: "6-7", play: play(6, 7, [ev("H5-DRAKE", "punt", 40)], { playType: "punt" }), status: "applied" },
    ];
    const drive = drivesOf(plays, SIDE)[0];
    const lines = LINES.map((text, seq) => ({ seq, text }));
    expect(driveWindow(drive, lines, 9, 400).map((line) => line.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(driveWindow(drive, lines, 7, 400).map((line) => line.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(driveWindow(drive, lines, 99, 3).map((line) => line.seq)).toEqual([7, 8, 9]);
    expect(DRIVE_TAIL_LINES).toBe(5);
    expect(creditsLine(play(1, 2, [ev("H22-FENNIMORE", "rush", 8), ev("A17-QUILLON", "tackle")], { touchdown: true }))).toBe("H22-FENNIMORE rush 8 yds; A17-QUILLON tackle; touchdown");
  });

  it("is asked for as a drive re-read, with the plays and their credits, and the route takes the longer window", () => {
    const request: ExtractStatsRequest = {
      utterances: LINES.map((text, seq) => ({ seq, text, offsetMs: 0 })),
      rosters: ROSTER,
      recentPlays: [{ playId: "1-2", summary: "FENNIMORE 8 yd run", detail: "H22-FENNIMORE rush 8 yds" }],
      look: "drive",
    };
    const content = volatileContent(request);
    expect(content).toContain("PLAYS ALREADY APPLIED FOR THIS DRIVE");
    expect(content).toContain("credited: H22-FENNIMORE rush 8 yds");
    expect(content).toContain(DRIVE_REREAD_PROMPT);
    const parsed = readRequest({ ...request, utterances: Array.from({ length: 300 }, (_, seq) => ({ seq, text: "x" })) });
    expect(parsed && typeof parsed === "object" ? parsed.recentPlays[0].detail : null).toBe("H22-FENNIMORE rush 8 yds");
    expect(readRequest({ ...request, look: undefined, utterances: Array.from({ length: 300 }, (_, seq) => ({ seq, text: "x" })) })).toBe("too_long");
    // A removal is only a re-read's to ask for.
    const removal = { ...play(1, 2, []), updates: "1-2", remove: true };
    expect(validatePlays({ plays: [removal] }, { utterances: request.utterances, look: "drive" })[0].remove).toBe(true);
    expect(validatePlays({ plays: [removal] }, { utterances: request.utterances })[0].remove).toBeUndefined();
  });
});

describe("corrections through readPlays", () => {
  const utterances = LINES.map((text, seq) => ({ seq, text }));

  /** A drive counted as the loop would count it: the run, the incompletion and the punt. */
  function drive(): StatsSession {
    let session = EMPTY_SESSION;
    const read = readPlays(
      session,
      [
        play(1, 2, [ev("H22-FENNIMORE", "rush", 8), ev("A17-QUILLON", "tackle")]),
        play(4, 4, [ev("H7-CASTELLANE", "pass_incomplete")], { playType: "pass", down: 2, distance: 2 }),
        play(6, 7, [ev("H5-DRAKE", "punt", 40)], { playType: "punt", down: 3, distance: 2 }),
      ],
      ROSTER,
      100,
      { utterances },
    );
    session = read.session;
    for (const each of read.added) session = okPlay(session, 200, each.playId).session;
    return session;
  }
  const ids = new Set(["1-2", "4-4", "6-7"]);
  const reread = { reread: { ids }, source: { rule: "R39" as const, reason: "corrected by the drive's re-read" }, utterances };

  it("replaces a player the re-read corrects, and keeps what was typed", () => {
    let session = drive();
    // The announcer typed 12 yards on the run.
    session = correctPlay(session, "1-2", { type: "amount", index: 1, amount: 12 }).session;
    // The re-read says the runner was Grimsby and the tackle was Vantree's, 9 yards.
    const correction = play(1, 2, [ev("H34-GRIMSBY", "rush", 9), ev("A22-VANTREE", "tackle")], { updates: "1-2", evidence: "grimsby vantree" });
    const read = readPlays(session, freshReads([correction], session, 7, ids, true), ROSTER, 300, reread);
    const fixed = read.session.plays.find((p) => p.playId === "1-2")!;
    expect(read.updated.map((p) => p.playId)).toEqual(["1-2"]);
    expect(fixed.status).toBe("applied");
    // The carrier is one player's slot and is replaced; a tackle is shared, so the re-read's is added beside the first.
    expect(fixed.play.events.map((e) => e.playerId)).toEqual(["H34-GRIMSBY", "A17-QUILLON", "A22-VANTREE"]);
    // The typed yards stay the announcer's, on the player he typed them for; nothing typed moved.
    expect(fixed.changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 12, estimated: false });
    expect(fixed.changes).toContainEqual({ playerId: "H34-GRIMSBY", key: "rush_att", amount: 1, estimated: false });
    expect(fixed.dropped).toContainEqual(expect.objectContaining({ rule: "R39", kind: "noted" }));
    expect(fixed.dropped).toContainEqual(expect.objectContaining({ rule: "R22", to: "H34-GRIMSBY" }));
  });

  it("adds a play the drive missed once, and a second identical reply adds nothing", () => {
    const session = drive();
    const missed = play(8, 9, [ev("A22-VANTREE", "rush", 11)], { offense: "away", evidence: "vantree carries" });
    const first = readPlays(session, freshReads([missed], session, 7, ids, true), ROSTER, 300, reread);
    expect(first.added.map((p) => p.playId)).toEqual(["8-9"]);
    expect(first.added[0].dropped).toContainEqual(expect.objectContaining({ rule: "R39" }));
    let counted = first.session;
    for (const each of first.added) counted = okPlay(counted, 301, each.playId).session;
    const again = readPlays(counted, freshReads([missed], counted, 9, ids, true), ROSTER, 400, reread);
    expect(again.added).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(again.session.plays).toHaveLength(4);
  });

  it("takes out a play that was not a play, but never one the announcer corrected", () => {
    let session = drive();
    const removal = { ...play(4, 4, [], { updates: "4-4", playType: "other" }), remove: true };
    const read = readPlays(session, [removal], ROSTER, 300, reread);
    expect(read.removed?.map((p) => p.playId)).toEqual(["4-4"]);
    expect(read.session.plays.find((p) => p.playId === "4-4")?.status).toBe("discarded");
    expect(read.session.plays.find((p) => p.playId === "4-4")?.dropped).toContainEqual(expect.objectContaining({ rule: "R39", kind: "dropped", action: "remove" }));

    session = correctPlay(drive(), "1-2", { type: "amount", index: 1, amount: 12 }).session;
    const refused = readPlays(session, [{ ...play(1, 2, [], { updates: "1-2" }), remove: true }], ROSTER, 300, reread);
    expect(refused.removed).toBeUndefined();
    expect(refused.session.plays.find((p) => p.playId === "1-2")?.status).toBe("applied");
    expect(refused.session.plays.find((p) => p.playId === "1-2")?.dropped).toContainEqual(expect.objectContaining({ rule: "R39", kind: "noted", action: "remove" }));
    // A removal outside a re-read, or of a play the re-read was not sent, does nothing.
    expect(readPlays(drive(), [removal], ROSTER, 300, { utterances }).session.plays.find((p) => p.playId === "4-4")?.status).toBe("applied");
  });

  it("keeps undo exact: U after a re-read takes back exactly one play", () => {
    const session = drive();
    const correction = play(1, 2, [ev("H34-GRIMSBY", "rush", 9)], { updates: "1-2", evidence: "grimsby" });
    const read = readPlays(session, [correction], ROSTER, 300, reread);
    const undone = undoLast(read.session, 400);
    expect(undone.play?.playId).toBe("6-7");
    expect(undone.session.plays.filter((p) => p.status === "applied").map((p) => p.playId)).toEqual(["1-2", "4-4"]);
  });
});

describe("the loop's drive re-read", () => {
  const START = 1_800_000_000_000;

  function harness() {
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
        readLog: async () => [],
        track: () => undefined,
        now: () => now,
      },
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    return {
      controller,
      requests,
      logged,
      settle,
      say(text: string, ms = 1000) {
        now += ms;
        controller.heard(text, now);
      },
      async answer(reply: ExtractReply) {
        answers.shift()!(reply);
        await settle();
      },
      /** Under fake timers: resolve the call, then let the fake clock run the continuation. */
      async answerFaked(reply: ExtractReply) {
        answers.shift()!(reply);
        await vi.advanceTimersByTimeAsync(1);
      },
      pending: () => answers.length,
    };
  }

  /** The drive read in one reply at the punt, so the re-read fires once. */
  async function afterTheDrive(h: ReturnType<typeof harness>) {
    await h.controller.start();
    h.say(LINES[0], 1_000);
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    // Said inside the 10 s floor, so nothing asks until the first down call after the punt.
    for (const text of LINES.slice(1, 8)) h.say(text, 1_000);
    h.say(LINES[9], 4_000);
    expect(h.requests).toHaveLength(2);
    expect(h.requests[1].utterances.map((line) => line.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    await h.answer({
      ok: true,
      plays: [
        play(1, 2, [ev("H22-FENNIMORE", "rush", 8), ev("A17-QUILLON", "tackle")]),
        play(4, 4, [ev("H7-CASTELLANE", "pass_incomplete")], { playType: "pass", down: 2, distance: 2 }),
        play(6, 7, [ev("H5-DRAKE", "punt", 40)], { playType: "punt", down: 3, distance: 2 }),
      ],
      usage: NO_USAGE,
    });
  }

  afterEach(() => vi.useRealTimers());

  it("is triggered by the play that ends a drive, in the background, with the drive's lines and credits", async () => {
    const h = harness();
    await afterTheDrive(h);
    expect(h.requests).toHaveLength(3);
    const reread = h.requests[2];
    expect(reread.look).toBe("drive");
    expect(reread.utterances.map((line) => line.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(reread.recentPlays.map((p) => p.playId)).toEqual(["1-2", "4-4", "6-7"]);
    expect(reread.recentPlays[0].detail).toBe("H22-FENNIMORE rush 8 yds; A17-QUILLON tackle");
    expect(reread.gameState?.teams).toBeUndefined();
    // The loop is not blocked: a new down and distance asks as usual while the re-read is out.
    h.say("vantree again", 11_000);
    h.say("second and three", 1_000);
    expect(h.requests).toHaveLength(4);
    expect(h.requests[3].look).toBeUndefined();
    expect(h.controller.bridge.counts().driveRereads).toBe(1);
  });

  it("applies a correction with R39, logs it, and leaves what was typed", async () => {
    const h = harness();
    await afterTheDrive(h);
    h.controller.correct("1-2", { type: "amount", index: 1, amount: 12 });
    await h.answer({ ok: true, plays: [play(1, 2, [ev("H34-GRIMSBY", "rush", 9), ev("A17-QUILLON", "tackle")], { updates: "1-2", evidence: "grimsby quillon" })], usage: NO_USAGE });
    const fixed = h.controller.getView().session.plays.find((p) => p.playId === "1-2")!;
    expect(fixed.play.events[0].playerId).toBe("H34-GRIMSBY");
    expect(fixed.changes).toContainEqual({ playerId: "H22-FENNIMORE", key: "rush_yds", amount: 12, estimated: false });
    expect(fixed.dropped).toContainEqual(expect.objectContaining({ rule: "R39" }));
    const replies = h.logged.filter((r) => r.kind === "stats_reply");
    expect(replies[replies.length - 1]).toMatchObject({ ok: true, look: "drive" });
    expect(h.logged.filter((r) => r.kind === "stats_update").map((r) => (r.kind === "stats_update" ? r.playId : ""))).toContain("1-2");
  });

  it("leaves the drive alone when the re-read fails or takes too long, and says so in the log", async () => {
    const h = harness();
    await afterTheDrive(h);
    const before = JSON.stringify(h.controller.getView().session);
    await h.answer({ ok: false, code: "claude_timeout" });
    expect(JSON.stringify(h.controller.getView().session)).toBe(before);
    expect(h.logged.filter((r) => r.kind === "stats_reply").pop()).toMatchObject({ ok: false, code: "claude_timeout", look: "drive" });

    vi.useFakeTimers();
    const slow = harness();
    await slow.controller.start();
    slow.say(LINES[0], 1_000);
    await slow.answerFaked({ ok: true, plays: [], usage: NO_USAGE });
    for (const text of LINES.slice(1, 8)) slow.say(text, 1_000);
    slow.say(LINES[9], 4_000);
    await slow.answerFaked({ ok: true, plays: [play(1, 2, [ev("H22-FENNIMORE", "rush", 8)]), play(6, 7, [ev("H5-DRAKE", "punt", 40)], { playType: "punt" })], usage: NO_USAGE });
    expect(slow.requests).toHaveLength(3);
    const untouched = JSON.stringify(slow.controller.getView().session);
    await vi.advanceTimersByTimeAsync(DRIVE_REREAD_TIMEOUT_MS + 1);
    expect(slow.logged.filter((r) => r.kind === "stats_reply").pop()).toMatchObject({ ok: false, code: REREAD_TIMEOUT, look: "drive" });
    // The late reply is ignored.
    await slow.answerFaked({ ok: true, plays: [play(1, 2, [ev("H34-GRIMSBY", "rush", 9)], { updates: "1-2", evidence: "grimsby" })], usage: NO_USAGE });
    expect(JSON.stringify(slow.controller.getView().session)).toBe(untouched);
  });

  it("re-reads a drive once", async () => {
    const h = harness();
    await afterTheDrive(h);
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    // Another read of later lines ends no new drive: no second re-read of the same one.
    h.say("vantree again", 11_000);
    h.say("second and three", 1_000);
    await h.answer({ ok: true, plays: [play(8, 8, [ev("A22-VANTREE", "rush", 11)], { offense: "away" })], usage: NO_USAGE });
    expect(h.requests.filter((r) => r.look === "drive")).toHaveLength(1);
    expect(h.pending()).toBe(0);
  });
});
