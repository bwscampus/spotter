import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sanitizeProps, type EventName, type EventProps } from "@/lib/analytics/events";
import { lineText } from "@/lib/cards/lines";
import type { StatsChange } from "@/lib/game/statsBridge";
import { LAST_READ_UNFINISHED, MAX_CATCH_UP_WINDOWS, MAX_FAILURES, SKIPPED_LINES, StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { counted, waiting } from "@/lib/livestats/session";
import { NO_USAGE, type ExtractStatsRequest, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";
import { MAX_WINDOW, WINDOW_OVERLAP, linesInWindows } from "@/lib/plays/window";

// The live stats loop (docs/V3_DEFINITION.md 8.1, 8.6, 8.8) with everything it
// touches faked: the route, the browser log, analytics and the clock. Made-up
// names only.

const ROSTER: StatsRosterPlayer[] = [
  {
    playerId: "H22-FENNIMORE",
    side: "home",
    jersey: "22",
    first: "Reed",
    last: "Fennimore",
    position: "RB",
    season: { gp: 5, rush_att: 71, rush_yds: 455 },
  },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

const START = 1_800_000_000_000;

function run(seqStart: number, seqEnd: number, extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
    quarter: 2,
    clock: "4:10",
    down: 3,
    distance: 4,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: `FENNIMORE 8 yd run (${seqStart}-${seqEnd})`,
    evidence: "fennimore up the middle for eight, quillon on the stop",
    events: [
      { playerId: "H22-FENNIMORE", action: "rush", yards: 8, yardsSource: "stated", made: null },
      { playerId: "A17-QUILLON", action: "tackle", yards: null, yardsSource: null, made: null },
    ],
    ...extra,
  };
}

const plays = (...list: StatsPlay[]): ExtractReply => ({
  ok: true,
  plays: list,
  usage: { ...NO_USAGE, inputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 900, outputTokens: 50 },
});

/** A loop with a fake route that answers only when told to. */
function harness({
  log = [] as readonly { kind: string }[],
  roster = ROSTER,
  autoOk = false,
  retryAfterStopMs = null as number | null,
} = {}) {
  let now = START;
  const requests: ExtractStatsRequest[] = [];
  const answers: Array<(reply: ExtractReply) => void> = [];
  const logged: StatsRecord[] = [];
  const tracked: Array<{ name: EventName; props: EventProps }> = [];
  const changes: StatsChange[] = [];
  let readLog: () => Promise<readonly { kind: string }[]> = async () => log;

  const controller = new StatsController({
    gameId: "game-1",
    startedAt: START,
    roster,
    autoOk,
    retryAfterStopMs,
    deps: {
      extract: (request) => {
        requests.push(request);
        return new Promise((resolve) => answers.push(resolve));
      },
      log: (record) => logged.push(record),
      readLog: () => readLog(),
      track: (name, props) => tracked.push({ name, props }),
      now: () => now,
    },
  });
  controller.bridge.subscribe((change) => changes.push(change));

  return {
    controller,
    requests,
    logged,
    tracked,
    changes,
    advance(ms: number) {
      now += ms;
    },
    get now() {
      return now;
    },
    /** Something was said, `ms` after the last thing. */
    say(text: string, ms = 1000) {
      now += ms;
      controller.heard(text, now);
    },
    /** The route answers the oldest call still waiting. */
    async answer(reply: ExtractReply) {
      const next = answers.shift();
      if (!next) throw new Error("no call is waiting for an answer");
      next(reply);
      await settle();
    },
    setReadLog(next: () => Promise<readonly { kind: string }[]>) {
      readLog = next;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function started(options?: Parameters<typeof harness>[0]) {
  const h = harness(options);
  await h.controller.start();
  return h;
}

/**
 * A loop that has read one run and has it waiting. The first thing said is
 * asked about straight away, alone; the run is read on the next call, at the
 * down and distance that follows it.
 */
async function withOnePlay() {
  const h = await started();
  h.say("fennimore up the middle for eight");
  await h.answer(plays());
  h.say("brought down by quillon");
  h.say("second and four from the thirty one", 11_000);
  await h.answer(plays(run(0, 1)));
  return h;
}

describe("a refresh that fixes a surname (Jed, Oct 5: refresh rosters shouldn't change the tonight stats)", () => {
  it("keeps what the player has earned tonight, on their new id", async () => {
    const h = await withOnePlay();
    h.advance(4_000);
    h.controller.ok();
    expect(lineText(h.controller.bridge.lines().get("H22-FENNIMORE")?.tonight ?? [])).toBe("1 car · 8 yds");

    h.controller.setRoster(ROSTER.map((player) => (player.playerId === "H22-FENNIMORE" ? { ...player, playerId: "H22-FENIMORE", last: "Fenimore" } : player)));

    const lines = h.controller.bridge.lines();
    expect(lineText(lines.get("H22-FENIMORE")?.tonight ?? [])).toBe("1 car · 8 yds");
    expect(lines.has("H22-FENNIMORE")).toBe(false);
    expect(lineText(lines.get("A17-QUILLON")?.tonight ?? [])).toBe("1 tkl");
  });

  it("leaves tonight exactly as it was when the refresh changes nobody's name or number", async () => {
    const h = await withOnePlay();
    h.advance(4_000);
    h.controller.ok();
    const before = JSON.stringify([...h.controller.bridge.lines()]);
    h.controller.setRoster(ROSTER.map((player) => ({ ...player })));
    expect(JSON.stringify([...h.controller.bridge.lines()])).toBe(before);
  });
});

describe("when it asks", () => {
  it("needs the rosters, which a game built before live stats does not have", async () => {
    const h = await started({ roster: [] });
    h.say("first and ten");
    expect(h.requests).toHaveLength(0);
    expect(h.controller.getView().loop).toEqual({ kind: "no_roster" });
  });

  it("sends the window, both rosters without season numbers, and the plays already read", async () => {
    const h = await withOnePlay();
    expect(h.requests[0].utterances.map((said) => said.seq)).toEqual([0]);
    expect(h.requests[1].utterances.map((said) => said.seq)).toEqual([0, 1, 2]);
    expect(h.requests[1].rosters).toEqual(
      ROSTER.map((player) => ({
        playerId: player.playerId,
        side: player.side,
        jersey: player.jersey,
        first: player.first,
        last: player.last,
        position: player.position,
      })),
    );
    expect(h.requests[1].rosters.every((player) => !("season" in player))).toBe(true);
    expect(h.requests[1].recentPlays).toEqual([]);

    h.say("third and two", 11_000);
    expect(h.requests).toHaveLength(3);
    // Four back from the watermark, so a play split across windows is read whole.
    expect(h.requests[2].utterances.map((said) => said.seq)).toEqual([0, 1, 2, 3]);
    expect(h.requests[2].recentPlays).toEqual([{ playId: "0-1", summary: "FENNIMORE 8 yd run (0-1)" }]);
  });

  it("asks at a down and distance call, but never within ten seconds of the last call", async () => {
    const h = await started();
    h.say("castellane hands off to fennimore");
    await h.answer(plays());
    h.say("second and four", 5_000);
    expect(h.requests).toHaveLength(1);
    // The boundary is remembered: the timer asks once ten seconds have passed.
    h.advance(5_000);
    h.controller.tick();
    expect(h.requests).toHaveLength(2);
  });

  it("asks every minute when there is no down and distance call, if football was said", async () => {
    const h = await started();
    h.say("castellane hands off to fennimore");
    await h.answer(plays());
    h.say("fennimore spins away", 15_000);
    expect(h.requests).toHaveLength(1);
    h.advance(31_000);
    h.controller.tick();
    // Thirty seconds was the old cadence (Jed, Oct 4: a minute, to halve the calls).
    expect(h.requests).toHaveLength(1);
    h.advance(15_000);
    h.controller.tick();
    expect(h.requests).toHaveLength(2);
    await h.answer(plays());
    // Nothing said since: nothing to ask about.
    h.advance(60_000);
    h.controller.tick();
    expect(h.requests).toHaveLength(2);
  });

  it("does not ask about talk that is not football: adverts, halftime, a crowd", async () => {
    const h = await started();
    h.say("castellane hands off to fennimore");
    await h.answer(plays());
    h.say("this half is brought to you by the valley credit union", 61_000);
    h.say("open a checking account today", 5_000);
    h.controller.tick();
    expect(h.requests).toHaveLength(1);
    // A name off either roster is football, and asks at once now that the minute is up.
    h.say("quillon on the field", 2_000);
    expect(h.requests).toHaveLength(2);
    // What was said in between is still in the window.
    expect(h.requests[1].utterances.map((utterance) => utterance.text)).toContain("open a checking account today");
  });

  it("has one call in flight at a time", async () => {
    const h = await started();
    h.say("castellane hands off to fennimore");
    expect(h.controller.getView().loop).toEqual({ kind: "reading" });
    h.say("third and two", 40_000);
    h.controller.tick();
    expect(h.requests).toHaveLength(1);
    await h.answer(plays());
    h.controller.tick();
    expect(h.requests).toHaveLength(2);
  });

  it("does not number a blank final", async () => {
    const h = await started();
    h.say("   ");
    expect(h.requests).toHaveLength(0);
    h.say("fennimore up the middle");
    expect(h.requests[0].utterances).toEqual([expect.objectContaining({ seq: 0, text: "fennimore up the middle" })]);
  });
});

describe("what it does with a reply", () => {
  it("puts every new play in line, waiting for the announcer, and logs the reply and the play", async () => {
    const h = await withOnePlay();
    const view = h.controller.getView();
    expect(waiting(view.session).map((play) => play.playId)).toEqual(["0-1"]);
    expect(counted(view.session)).toEqual([]);
    expect(h.logged.map((record) => record.kind)).toEqual(["stats_reply", "stats_reply", "stats_play"]);
    expect(h.logged[1]).toMatchObject({ ok: true, seqFrom: 0, seqTo: 2, tokensIn: 1000, tokensOut: 50, tokensCached: 900 });
    expect(h.logged[2]).toMatchObject({ playId: "0-1", play: { summary: "FENNIMORE 8 yd run (0-1)" }, dropped: [] });
    // Nothing counts, and no card changes, until he says OK.
    expect(h.controller.bridge.lines().size).toBe(0);
    expect(h.tracked.filter((event) => event.name === "stats.play_applied")).toEqual([]);
    expect(h.controller.bridge.counts()).toMatchObject({ playsApplied: 0, tokensIn: 2000, tokensOut: 100, tokensCached: 1800 });
  });

  it("reads a play once, however many windows describe it", async () => {
    const h = await withOnePlay();
    h.say("third and two", 11_000);
    await h.answer(plays(run(0, 1, { summary: "the same run, said again" }), run(2, 3)));
    expect(h.controller.getView().session.plays.map((play) => play.playId)).toEqual(["0-1", "2-3"]);
  });

  it("checks every play itself: one ending outside the window is thrown away", async () => {
    const h = await started();
    h.say("fennimore up the middle");
    await h.answer(plays(run(0, 7)));
    expect(h.controller.getView().session.plays).toEqual([]);
  });
});

describe("the announcer's answers", () => {
  it("OK counts the play, puts it on the cards, and logs and tracks it without a name", async () => {
    const h = await withOnePlay();
    h.advance(4_000);
    h.controller.ok();

    expect(counted(h.controller.getView().session).map((play) => play.playId)).toEqual(["0-1"]);
    const lines = h.controller.bridge.lines();
    expect([...lines.keys()].sort()).toEqual(["A17-QUILLON", "H22-FENNIMORE"]);
    expect(lineText(lines.get("H22-FENNIMORE")?.tonight ?? [])).toBe("1 car · 8 yds");
    expect(h.changes.at(-1)?.chips).toEqual(
      new Map([
        ["H22-FENNIMORE", "+1 CAR +8"],
        ["A17-QUILLON", "+1 TKL"],
      ]),
    );
    expect(h.logged.at(-1)).toMatchObject({ kind: "stats_decision", playId: "0-1", decision: "ok" });
    expect(h.controller.bridge.counts().playsApplied).toBe(1);

    const applied = h.tracked.find((event) => event.name === "stats.play_applied")!;
    expect(applied.props).toMatchObject({
      play_type: "run",
      events: 3,
      confidence_bucket: "0_8_plus",
      corrected: false,
      seconds_pending: 4,
      yards_stated: 1,
      yards_unknown: 0,
    });
    // Every prop is a code or a count, so the privacy filter keeps all of them.
    const drops: string[] = [];
    sanitizeProps("stats.play_applied", applied.props, (dropped) => drops.push(dropped.key));
    expect(drops).toEqual([]);
    expect(JSON.stringify(h.tracked).toLowerCase()).not.toMatch(/fennimore|quillon/);
  });

  it("Discard throws the play away and tracks it", async () => {
    const h = await withOnePlay();
    h.controller.discard();
    expect(h.controller.getView().session.plays[0].status).toBe("discarded");
    expect(h.controller.bridge.lines().size).toBe(0);
    expect(h.tracked.at(-1)).toMatchObject({ name: "stats.play_discarded", props: { play_type: "run", events: 3 } });
    expect(h.logged.at(-1)).toMatchObject({ kind: "stats_decision", decision: "discard" });
  });

  it("U takes back the last OK: it goes back in line, the cards lose it, and it is tracked", async () => {
    const h = await withOnePlay();
    h.controller.ok();
    h.advance(7_000);
    h.controller.undo();
    expect(waiting(h.controller.getView().session).map((play) => play.playId)).toEqual(["0-1"]);
    expect(h.controller.bridge.lines().size).toBe(0);
    // The cards hear about it, with no chip: a take-back is not news on a card.
    expect(h.changes.at(-1)?.chips.size).toBe(0);
    expect(h.tracked.at(-1)).toMatchObject({ name: "stats.play_undone", props: { play_type: "run", seconds_since_applied: 7 } });
    expect(h.controller.bridge.counts()).toMatchObject({ playsApplied: 1, playsUndone: 1 });
    // Nothing more to take back.
    const before = h.tracked.length;
    h.controller.undo();
    expect(h.tracked).toHaveLength(before);
  });

  it("the live screen's Enter, Backspace and U reach the front of the line", async () => {
    const h = await withOnePlay();
    expect(h.controller.bridge.keysLive()).toBe(true);
    h.controller.bridge.key("ok");
    expect(counted(h.controller.getView().session)).toHaveLength(1);
    h.controller.bridge.key("undo");
    expect(waiting(h.controller.getView().session)).toHaveLength(1);
    h.controller.bridge.key("discard");
    expect(h.controller.getView().session.plays[0].status).toBe("discarded");
  });

  it("a correction is logged with the play's changes whole, and a counted play's cards follow it", async () => {
    const h = await withOnePlay();
    h.controller.correct("0-1", { type: "amount", index: 1, amount: 5 });
    expect(h.logged.at(-1)).toMatchObject({ kind: "stats_decision", decision: "edit", changes: expect.any(Array) });
    expect((h.logged.at(-1) as { changes: Array<{ amount: number | null }> }).changes[1].amount).toBe(5);
    const changesBefore = h.changes.length;
    h.controller.ok();
    expect(h.tracked.at(-1)?.props.corrected).toBe(true);

    h.controller.correct("0-1", { type: "player", index: 2, playerId: "H22-FENNIMORE" });
    expect(h.changes.length).toBeGreaterThan(changesBefore + 1);
    expect(h.controller.bridge.lines().has("A17-QUILLON")).toBe(false);
  });
});

describe("when it goes wrong, and the switch", () => {
  it("pauses on a failure, says why, and tracks the code alone", async () => {
    const h = await started();
    h.say("fennimore up the middle");
    await h.answer({ ok: false, code: "claude_timeout" });
    expect(h.controller.getView().loop).toEqual({ kind: "paused", code: "claude_timeout" });
    expect(h.tracked.at(-1)).toEqual({ name: "stats.call_failed", props: { code: "claude_timeout" } });
    expect(h.logged.at(-1)).toMatchObject({ kind: "stats_reply", ok: false, code: "claude_timeout" });
    // A success clears it.
    h.say("third and two", 11_000);
    await h.answer(plays());
    expect(h.controller.getView().loop).toEqual({ kind: "listening" });
  });

  it(`stops after ${MAX_FAILURES} failures in a row until the switch goes off and on`, async () => {
    const h = await started();
    for (let i = 0; i < MAX_FAILURES; i++) {
      h.say(`third and ${i + 2}`, 11_000);
      await h.answer({ ok: false, code: "network" });
    }
    expect(h.controller.getView().loop).toEqual({ kind: "stopped", code: "network", retrying: false });
    h.say("fourth and one", 40_000);
    expect(h.requests).toHaveLength(MAX_FAILURES);

    h.controller.setOn(false);
    h.controller.setOn(true);
    h.say("first and ten", 11_000);
    expect(h.requests).toHaveLength(MAX_FAILURES + 1);
  });

  it("Stats off stops the calls, keeps the line and what counted, and is logged and tracked", async () => {
    const h = await withOnePlay();
    h.advance(5 * 60_000);
    h.controller.setOn(false);
    expect(h.controller.getView()).toMatchObject({ on: false, loop: { kind: "off" } });
    expect(h.logged.at(-1)).toMatchObject({ kind: "stats_switch", on: false });
    expect(h.tracked.at(-1)).toEqual({ name: "stats.toggled", props: { state: "off", minute: 5 } });
    expect(h.controller.bridge.counts().offMidGame).toBe(true);

    h.say("third and two", 40_000);
    expect(h.requests).toHaveLength(2);
    // What is in line can still be answered.
    h.controller.ok();
    expect(counted(h.controller.getView().session)).toHaveLength(1);
  });

  it("a stopped loop ignores a reply that arrives after it", async () => {
    const h = await started();
    h.say("fennimore up the middle");
    h.controller.dispose();
    await h.answer(plays(run(0, 0)));
    expect(h.controller.getView().session.plays).toEqual([]);
    expect(h.logged).toEqual([]);
  });
});

describe("after a reload", () => {
  const LOG = [
    { kind: "game", gameId: "game-1", at: START },
    { kind: "utterance", gameId: "game-1", at: START + 1000, connectionId: 1, text: "fennimore up the middle", offsetMs: 0 },
    { kind: "utterance", gameId: "game-1", at: START + 2000, connectionId: 1, text: "brought down by quillon", offsetMs: 1000 },
    { kind: "stats_reply", gameId: "game-1", at: START + 3000, ok: true, plays: [], tokensIn: 1000, tokensOut: 50, tokensCached: 900 },
    { kind: "stats_play", gameId: "game-1", at: START + 3000, playId: "0-1", play: run(0, 1), changes: [], dropped: [] },
    { kind: "stats_decision", gameId: "game-1", at: START + 4000, playId: "0-1", decision: "ok" },
    { kind: "stats_switch", gameId: "game-1", at: START + 5000, on: false },
  ];

  it("picks up the line, the decisions, the switch and the counts where the log left them", async () => {
    const h = await started({ log: LOG });
    const view = h.controller.getView();
    expect(view.on).toBe(false);
    expect(counted(view.session).map((play) => play.playId)).toEqual(["0-1"]);
    expect(h.controller.bridge.counts()).toMatchObject({ playsApplied: 1, offMidGame: true, tokensIn: 1000 });
  });

  it("numbers what is said next after what the log already holds, and reads on from the last play", async () => {
    const h = await started({ log: LOG });
    h.controller.setOn(true);
    h.say("third and two", 11_000);
    expect(h.requests[0].utterances.map((said) => said.seq)).toEqual([0, 1, 2]);
    await h.answer(plays(run(0, 1), run(2, 2)));
    // 0-1 was read before the reload; only the new one joins the line.
    expect(h.controller.getView().session.plays.map((play) => play.playId)).toEqual(["0-1", "2-2"]);
  });

  it("keeps what was said while the log was being read, in order, after what the log holds", async () => {
    const h = harness();
    let release: (records: readonly { kind: string }[]) => void = () => undefined;
    h.setReadLog(() => new Promise((resolve) => (release = resolve)));
    const starting = h.controller.start();
    expect(h.controller.getView().loop).toEqual({ kind: "loading" });
    h.say("said during the reload");
    expect(h.requests).toHaveLength(0);
    release(LOG.filter((record) => record.kind !== "stats_switch"));
    await starting;
    h.say("first and ten", 11_000);
    expect(h.requests[0].utterances.map((said) => [said.seq, said.text])).toEqual([
      [0, "fennimore up the middle"],
      [1, "brought down by quillon"],
      [2, "said during the reload"],
      [3, "first and ten"],
    ]);
  });
});

describe("on the live screen (Jed, Oct 6: a beta for the public launch)", () => {
  const HOOK = readFileSync(new URL("../components/livestats/useLiveStats.ts", import.meta.url), "utf8");

  it("asks for an OK on every play and stops after five failures until the switch goes off and on (spec 8.6, 8.8)", () => {
    expect(HOOK).toMatch(/^const AUTO_OK = false;$/m);
    expect(HOOK).toMatch(/^const RETRY_AFTER_STOP_MS: number \| null = null;$/m);
  });
});

describe("unattended test games (autoOk and retryAfterStopMs, both off on the live screen)", () => {
  it("counts every play the moment it is read, through the same OK as Enter", async () => {
    const h = await started({ autoOk: true });
    h.say("fennimore up the middle for eight");
    await h.answer(plays());
    h.say("brought down by quillon");
    h.say("second and four from the thirty one", 11_000);
    await h.answer(plays(run(0, 1)));

    const view = h.controller.getView();
    expect(view.autoOk).toBe(true);
    expect(waiting(view.session)).toEqual([]);
    expect(counted(view.session).map((play) => play.playId)).toEqual(["0-1"]);
    // Read, then OK'd, in that order, so the log replays to the same place.
    expect(h.logged.slice(-2)).toMatchObject([
      { kind: "stats_play", playId: "0-1" },
      { kind: "stats_decision", playId: "0-1", decision: "ok" },
    ]);
    expect(h.controller.bridge.counts().playsApplied).toBe(1);
    expect(lineText(h.controller.bridge.lines().get("H22-FENNIMORE")?.tonight ?? [])).toBe("1 car · 8 yds");
    expect(h.changes.at(-1)?.chips.get("H22-FENNIMORE")).toBe("+1 CAR +8");
    expect(h.tracked.find((event) => event.name === "stats.play_applied")?.props).toMatchObject({ seconds_pending: 0 });
  });

  it("U takes back the newest of three plays counted from one reply, then the one before (M6)", async () => {
    const h = await started({ autoOk: true });
    h.say("fennimore up the middle for eight, quillon on the stop");
    h.say("fennimore again, quillon again");
    h.say("and fennimore a third time, quillon there too");
    await h.answer(plays());
    h.say("third and two", 11_000);
    await h.answer(plays(run(0, 0), run(1, 1), run(2, 2)));
    expect(counted(h.controller.getView().session).map((play) => play.playId)).toEqual(["2-2", "1-1", "0-0"]);
    h.controller.undo();
    expect(waiting(h.controller.getView().session).map((play) => play.playId)).toEqual(["2-2"]);
    h.controller.undo();
    expect(waiting(h.controller.getView().session).map((play) => play.playId)).toEqual(["1-1", "2-2"]);
    expect(counted(h.controller.getView().session).map((play) => play.playId)).toEqual(["0-0"]);
  });

  it("a play taken back with U waits for an OK, and is not counted again on its own", async () => {
    const h = await started({ autoOk: true });
    h.say("fennimore up the middle for eight");
    await h.answer(plays(run(0, 0)));
    h.controller.undo();
    expect(waiting(h.controller.getView().session).map((play) => play.playId)).toEqual(["0-0"]);
    h.say("third and two", 11_000);
    await h.answer(plays(run(1, 1)));
    expect(waiting(h.controller.getView().session).map((play) => play.playId)).toEqual(["0-0"]);
    expect(counted(h.controller.getView().session).map((play) => play.playId)).toEqual(["1-1"]);
  });

  it("after a reload, counts a play whose OK never reached the log, and leaves one taken back waiting", async () => {
    const log = [
      { kind: "game", gameId: "game-1", at: START },
      { kind: "stats_play", gameId: "game-1", at: START + 1000, playId: "0-0", play: run(0, 0), changes: [], dropped: [] },
      { kind: "stats_decision", gameId: "game-1", at: START + 1000, playId: "0-0", decision: "ok" },
      { kind: "stats_decision", gameId: "game-1", at: START + 2000, playId: "0-0", decision: "undo" },
      { kind: "stats_play", gameId: "game-1", at: START + 3000, playId: "1-1", play: run(1, 1), changes: [], dropped: [] },
    ];
    const h = await started({ log, autoOk: true });
    const session = h.controller.getView().session;
    expect(waiting(session).map((play) => play.playId)).toEqual(["0-0"]);
    expect(counted(session).map((play) => play.playId)).toEqual(["1-1"]);
    expect(h.logged.at(-1)).toMatchObject({ kind: "stats_decision", playId: "1-1", decision: "ok" });
  });

  it(`after ${MAX_FAILURES} failures in a row, tries again on its own once the wait has passed`, async () => {
    const h = await started({ retryAfterStopMs: 60_000 });
    for (let i = 0; i < MAX_FAILURES; i++) {
      h.say(`third and ${i + 2}`, 11_000);
      await h.answer({ ok: false, code: "network" });
    }
    expect(h.controller.getView().loop).toEqual({ kind: "stopped", code: "network", retrying: true });
    h.say("fourth and one", 40_000);
    expect(h.requests).toHaveLength(MAX_FAILURES);
    h.say("first and ten", 21_000);
    expect(h.requests).toHaveLength(MAX_FAILURES + 1);
    await h.answer(plays());
    expect(h.controller.getView().loop).toEqual({ kind: "listening" });
  });
});

describe("a backlog longer than one window (M9)", () => {
  /** A loop whose first call is still out while `count` more lines are said, then answered with nothing. */
  async function behind(count: number) {
    const h = await started();
    h.say("fennimore up the middle");
    for (let i = 1; i <= count; i++) h.say(`fennimore again ${i}`, 100);
    await h.answer(plays());
    // The first call read line 0 alone; everything after it is the backlog.
    return h;
  }
  const seqs = (request: ExtractStatsRequest) => request.utterances.map((said) => said.seq);

  it("leaves a normal window as it was: one call, everything past the overlap before the last play", async () => {
    const h = await behind(20);
    h.say("first and ten", 11_000);
    expect(h.requests).toHaveLength(2);
    expect(seqs(h.requests[1])).toEqual(Array.from({ length: 22 }, (_, seq) => seq));
  });

  it("reads the backlog in windows of MAX_WINDOW, oldest first, one call at a time, each overlapping the last", async () => {
    const h = await behind(69);
    h.say("first and ten", 11_000); // line 70
    expect(h.requests).toHaveLength(2);
    expect(seqs(h.requests[1])).toEqual(Array.from({ length: MAX_WINDOW }, (_, i) => i));
    // The next window waits for this one's answer, and is read against what it added.
    await h.answer(plays(run(10, 12)));
    expect(h.requests).toHaveLength(3);
    const step = MAX_WINDOW - WINDOW_OVERLAP;
    expect(seqs(h.requests[2])).toEqual(Array.from({ length: MAX_WINDOW }, (_, i) => step + i));
    expect(h.requests[2].recentPlays.map((play) => play.playId)).toEqual(["10-12"]);
    await h.answer(plays(run(40, 41)));
    expect(h.requests).toHaveLength(4);
    expect(seqs(h.requests[3])[0]).toBe(2 * step);
    expect(seqs(h.requests[3]).at(-1)).toBe(70);
    await h.answer(plays(run(69, 70)));
    expect(h.requests).toHaveLength(4);
    expect(h.controller.getView().session.plays.map((play) => play.playId)).toEqual(["10-12", "40-41", "69-70"]);
    expect(h.controller.getView().loop).toEqual({ kind: "listening" });
    expect(h.logged.some((record) => record.kind === "stats_reply" && record.code === SKIPPED_LINES)).toBe(false);
    // Caught up: the next call is one ordinary window again.
    h.say("second and three", 11_000);
    expect(seqs(h.requests[4])).toEqual([66, 67, 68, 69, 70, 71]);
  });

  it(`reads at most ${MAX_CATCH_UP_WINDOWS} windows, and logs how many of the oldest lines it skipped`, async () => {
    const h = await behind(149);
    h.say("first and ten", 11_000); // line 150
    const room = linesInWindows(MAX_CATCH_UP_WINDOWS);
    // Lines 1 to 150 were never read; the newest `room` lines, from the overlap, are.
    const firstKept = 151 - room;
    const skipped = firstKept - 1;
    expect(h.logged.at(-1)).toEqual({
      kind: "stats_reply",
      gameId: "game-1",
      at: h.now,
      ok: false,
      code: SKIPPED_LINES,
      skipped,
      seqFrom: 1,
      seqTo: skipped,
    });
    for (let i = 0; i < MAX_CATCH_UP_WINDOWS; i++) await h.answer(plays());
    expect(h.requests).toHaveLength(1 + MAX_CATCH_UP_WINDOWS);
    expect(seqs(h.requests[1])[0]).toBe(firstKept);
    expect(seqs(h.requests[MAX_CATCH_UP_WINDOWS]).at(-1)).toBe(150);
    // Skipped lines are not a failure, and are said once.
    expect(h.controller.getView().loop).toEqual({ kind: "listening" });
    h.say("second and three", 11_000);
    expect(h.logged.filter((record) => record.kind === "stats_reply" && record.code === SKIPPED_LINES)).toHaveLength(1);
  });

  it("stops a catch-up at a failure, keeps what was applied, and reads the rest next call", async () => {
    const h = await behind(69);
    h.say("first and ten", 11_000);
    await h.answer(plays(run(10, 12)));
    await h.answer({ ok: false, code: "network" });
    expect(h.requests).toHaveLength(3);
    expect(h.controller.getView().loop).toEqual({ kind: "paused", code: "network" });
    expect(h.controller.getView().session.plays.map((play) => play.playId)).toEqual(["10-12"]);
    h.say("second and three", 11_000); // line 71
    // From the overlap before the first line not read, oldest first again.
    expect(seqs(h.requests[3])[0]).toBe(MAX_WINDOW - WINDOW_OVERLAP);
  });

  it("reads the whole backlog at End game, in windows, before the game closes", async () => {
    const h = await behind(69);
    const finished = h.controller.finish(10_000);
    await settle();
    expect(h.requests).toHaveLength(2);
    await h.answer(plays(run(10, 12)));
    await h.answer(plays());
    await h.answer(plays(run(68, 69)));
    await finished;
    expect(h.requests).toHaveLength(4);
    expect(seqs(h.requests[3]).at(-1)).toBe(69);
    expect(h.controller.getView().session.plays.map((play) => play.playId)).toEqual(["10-12", "68-69"]);
    expect(h.logged.some((record) => record.kind === "stats_reply" && record.code === LAST_READ_UNFINISHED)).toBe(false);
  });
});
