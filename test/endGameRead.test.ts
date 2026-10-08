import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPlay } from "@/lib/livestats/apply";
import { checkPlay } from "@/lib/livestats/check";
import { LAST_READ_TIMEOUT_MS, LAST_READ_UNFINISHED, StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { talliesOf } from "@/lib/livestats/session";
import { NO_USAGE, type Action, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";

// =============================================================================
// Oct 6, Part 4: three small rules (a no-play flag adds nothing, a kickoff is
// never a punt, an unnamed punt is the only punter's) and one last read when
// End game is pressed. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR" },
  { playerId: "H3-BOOTHBY", side: "home", jersey: "3", first: "Kit", last: "Boothby", position: "K" },
  { playerId: "H9-PELLAM", side: "home", jersey: "9", first: "Wren", last: "Pellam", position: "P" },
  { playerId: "A8-VASKO", side: "away", jersey: "8", first: "Olen", last: "Vasko", position: "P" },
  { playerId: "A18-WICKHAM", side: "away", jersey: "18", first: "Ross", last: "Wickham", position: "P/K" },
  { playerId: "A2-OAKES", side: "away", jersey: "2", first: "Finn", last: "Oakes", position: "WR" },
];

function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}

function play(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
    quarter: 4,
    clock: null,
    down: 2,
    distance: 8,
    offense: "home",
    playType: "pass",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: "a play",
    evidence: events.map((event) => event.playerId.split("-")[1].toLowerCase()).join(" "),
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: { on: "none", noPlay: false, beforeSnap: false },
    ...extra,
  };
}

const QBS = { home: "H7-CASTELLANE", away: null };
const statsOf = (p: StatsPlay) => {
  const checked = checkPlay(p, ROSTER, { qbs: QBS });
  const applied = applyPlay(checked.play, ROSTER);
  return { applied, notes: checked.notes, stats: new Map(applied.deltas.map((delta) => [delta.playerId, delta.stats])) };
};

describe("three small rules", () => {
  it("an incompletion with a no-play penalty adds no attempt", () => {
    const flagged = play(1, 2, [ev("H7-CASTELLANE", "pass_incomplete")], { penalty: { on: "defense", noPlay: true, beforeSnap: false } });
    const { applied } = statsOf(flagged);
    expect(applied.deltas).toEqual([]);
    expect(applied.dropped.map((drop) => drop.rule)).toEqual(["R7"]);
  });

  it("a kickoff adds no punt", () => {
    const kickoff = play(1, 2, [ev("H3-BOOTHBY", "punt", 55), ev("A2-OAKES", "kick_return", 20)], { playType: "kickoff", down: null, distance: null });
    const { applied, stats } = statsOf(kickoff);
    expect(stats.get("H3-BOOTHBY")).toBeUndefined();
    expect(stats.get("A2-OAKES")).toEqual({ kr: 1, kr_yds: 20 });
    expect(applied.dropped.map((drop) => `${drop.rule} ${drop.event.action}`)).toEqual(["R31 punt"]);
  });

  it("a punt with no punter named goes to that side's only punter, estimated; with two punters it stays blank", () => {
    const home = statsOf(play(1, 2, [], { playType: "punt", down: 4, distance: 9 }));
    expect(home.stats.get("H9-PELLAM")).toEqual({ punts: 1 });
    expect(home.notes.map((note) => `${note.rule} ${note.kind} ${note.to}`)).toEqual(["R15 filled H9-PELLAM"]);
    expect(home.applied.deltas[0].estimated).toEqual(["punts"]);
    const away = statsOf(play(1, 2, [], { playType: "punt", offense: "away", down: 4, distance: 9 }));
    expect(away.applied.deltas).toEqual([]);
    expect(away.notes).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// The last read on End game.
// -----------------------------------------------------------------------------

const START = 1_800_000_000_000;

function harness(answer: (call: number) => Promise<ExtractReply>) {
  let now = START;
  let calls = 0;
  const logged: StatsRecord[] = [];
  const controller = new StatsController({
    gameId: "game-1",
    startedAt: START,
    roster: ROSTER,
    autoOk: true,
    deps: {
      extract: () => answer(++calls),
      log: (record) => logged.push(record),
      readLog: async () => [],
      track: () => {},
      now: () => now,
    },
  });
  return {
    controller,
    logged,
    get calls() {
      return calls;
    },
    say(text: string) {
      now += 1000;
      controller.heard(text, now);
    },
  };
}

const kick = (seq: number): StatsPlay =>
  play(seq, seq, [{ ...ev("H3-BOOTHBY", "field_goal", 40), made: true }], { playType: "field_goal", down: 4, distance: 3 });
const reply = (...plays: StatsPlay[]): ExtractReply => ({ ok: true, plays, usage: NO_USAGE });

afterEach(() => {
  vi.useRealTimers();
});

describe("End game reads the lines nobody has read yet", () => {
  it("applies the final play before the game closes", async () => {
    // The first call reads nothing; the last read finds the kick.
    const h = harness(async (call) => (call === 1 ? reply() : reply(kick(1))));
    await h.controller.start();
    h.say("4th and 3 boothby on to try it from 40");
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.say("boothby the kick is good");
    expect(h.calls).toBe(1);
    await h.controller.bridge.finish();
    expect(h.calls).toBe(2);
    expect(talliesOf(h.controller.getView().session).get("H3-BOOTHBY")?.stats).toMatchObject({ fga: 1, fgm: 1 });
    expect(h.logged.map((record) => record.kind)).toEqual(["stats_reply", "stats_reply", "stats_play", "stats_decision"]);
  });

  it("makes no call when everything said has been read", async () => {
    const h = harness(async () => reply(kick(0)));
    await h.controller.start();
    h.say("boothby the kick is good");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.controller.finish();
    expect(h.calls).toBe(1);
    expect(h.logged.some((record) => record.kind === "stats_reply" && record.ok === false)).toBe(false);
  });

  it("a failed last read still ends the game, and the log says so", async () => {
    const h = harness(async (call) => (call === 1 ? reply() : { ok: false, code: "network" }));
    await h.controller.start();
    h.say("4th and 3");
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.say("boothby the kick is good");
    await h.controller.finish();
    const last = h.logged.at(-1);
    expect(last).toMatchObject({ kind: "stats_reply", ok: false, code: LAST_READ_UNFINISHED });
  });

  it(`a last read that takes more than ${LAST_READ_TIMEOUT_MS / 1000} s is given up on, logged, and its late reply ignored`, async () => {
    vi.useFakeTimers();
    let release: (value: ExtractReply) => void = () => {};
    const h = harness(async (call) => (call === 1 ? reply() : new Promise<ExtractReply>((resolve) => (release = resolve))));
    await h.controller.start();
    h.say("4th and 3");
    await vi.advanceTimersByTimeAsync(0);
    h.say("boothby the kick is good");
    const finished = h.controller.finish();
    await vi.advanceTimersByTimeAsync(LAST_READ_TIMEOUT_MS + 1);
    await finished;
    expect(h.logged.at(-1)).toMatchObject({ kind: "stats_reply", ok: false, code: LAST_READ_UNFINISHED });
    release(reply(kick(1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(talliesOf(h.controller.getView().session).size).toBe(0);
  });
});
