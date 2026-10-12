import { describe, expect, it } from "vitest";
import { remapIds } from "@/lib/cards/playerKey";
import { buildSnapshot, type LoadedGame } from "@/lib/game/buildGame";
import { isSnapshot, parseSnapshot } from "@/lib/game/snapshot";
import { checkPlay, currentQbs } from "@/lib/livestats/check";
import { StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { replayRecorded } from "@/lib/livestats/recorded";
import { readReplayLog } from "@/lib/livestats/replayLog";
import { EMPTY_SESSION, readPlays, restoreFromLog } from "@/lib/livestats/session";
import { NO_PENALTY, NO_USAGE, type Action, type ExtractStatsRequest, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import { foldStats, type StatsRecord } from "@/lib/log/statsLog";
import { outOrder, toggleOut } from "@/components/livestats/OutTonight";

// =============================================================================
// Out tonight (Part 3): a player marked out is never credited (R35), the
// list belongs to the game and follows a refresh, a reload keeps it, and the
// replay knows who was out when. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB", season: { pass_att: 90 } },
  { playerId: "H14-ORMSBY", side: "home", jersey: "14", first: "Gil", last: "Ormsby", position: "QB", season: { pass_att: 3 } },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Dax", last: "Prewitt", position: "WR" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
  { playerId: "A12-VANTREE", side: "away", jersey: "12", first: "Cole", last: "Vantree", position: "QB" },
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

const QBS = { home: "H7-CASTELLANE", away: "A12-VANTREE" };

describe("R35: a credit to a player marked out is dropped", () => {
  it("drops the carry and keeps the tackle, with the rule", () => {
    const checked = checkPlay(play(1, 2, [ev("H22-FENNIMORE", "rush", 8), ev("A17-QUILLON", "tackle")]), ROSTER, { qbs: QBS, out: new Set(["H22-FENNIMORE"]) });
    expect(checked.play.events.map((e) => e.playerId)).toEqual(["A17-QUILLON"]);
    expect(checked.notes).toContainEqual(expect.objectContaining({ rule: "R35", kind: "dropped", event: expect.objectContaining({ playerId: "H22-FENNIMORE" }) }));
    expect(checked.unnamed).toEqual([]);
  });

  it("gives a pass thrown by an out quarterback to the one on the field, and says why", () => {
    const out = new Set(["H7-CASTELLANE"]);
    const qbs = currentQbs(ROSTER, [], out);
    expect(qbs.home).toBe("H14-ORMSBY");
    const checked = checkPlay(play(1, 2, [ev("H7-CASTELLANE", "pass_complete", 9), ev("H81-PREWITT", "reception", 9)], { playType: "pass" }), ROSTER, { qbs, out });
    expect(checked.play.events).toContainEqual(expect.objectContaining({ playerId: "H14-ORMSBY", action: "pass_complete", estimated: true }));
    expect(checked.notes).toContainEqual(expect.objectContaining({ rule: "R14", reason: expect.stringMatching(/marked out tonight/) }));
  });

  it("lets the credit through again once he is no longer out", () => {
    const run = play(1, 2, [ev("H22-FENNIMORE", "rush", 8)]);
    const dropped = readPlays(EMPTY_SESSION, [run], ROSTER, 0, { out: new Set(["H22-FENNIMORE"]) });
    expect(dropped.added[0].changes).toEqual([]);
    expect(dropped.added[0].dropped.map((d) => d.rule)).toContain("R35");
    const allowed = readPlays(EMPTY_SESSION, [run], ROSTER, 0, { out: new Set() });
    expect(allowed.added[0].changes.map((c) => `${c.playerId} ${c.key}`)).toEqual(["H22-FENNIMORE rush_att", "H22-FENNIMORE rush_yds"]);
  });
});

describe("the list belongs to the game", () => {
  const loaded = {
    home: { id: "h", school: "Northfield", mascot: "Bears", sport: "football", playerCount: 4, statsAsOf: null, primary_color: null },
    away: { id: "a", school: "Southpoint", mascot: "Hawks", sport: "football", playerCount: 2, statsAsOf: null, primary_color: null },
    sport: "football",
    watchlist: { entries: [{ name: "Fennimore", aliases: [], players: [] }], keyterms: [] },
    keyterm: { kind: "ok", keyterms: [] },
    teamSounds: [],
    lookAlikeDrops: [],
    benchExactOnly: [],
    firstNameCollisions: [],
    statsRoster: ROSTER,
  } as unknown as LoadedGame;
  const choices = { wearing: { home: "", away: "" }, keytermBoost: false, gameId: "g1", recorded: true, statsEnabled: true, statsAuto: true };

  it("is on the snapshot, only ids on tonight's roster, and survives a round trip", () => {
    const snapshot = buildSnapshot(loaded, { ...choices, out: ["H22-FENNIMORE", "NOBODY"] });
    expect(snapshot.out).toEqual(["H22-FENNIMORE"]);
    expect(parseSnapshot(JSON.stringify(snapshot))?.out).toEqual(["H22-FENNIMORE"]);
    expect(buildSnapshot(loaded, choices).out).toBeUndefined();
    expect(isSnapshot({ ...snapshot, out: "H22-FENNIMORE" })).toBe(false);
    expect(isSnapshot({ ...snapshot, out: undefined })).toBe(true);
  });

  it("follows a refresh that fixes a name or a number, and drops an id nobody has", () => {
    const fixed: StatsRosterPlayer[] = [
      { ...ROSTER[2], playerId: "H22-FENIMORE", last: "Fenimore" },
      { ...ROSTER[3], playerId: "H18-PREWITT", jersey: "18" },
      ROSTER[4],
    ];
    expect(remapIds(["H22-FENNIMORE", "H81-PREWITT", "A17-QUILLON", "H7-CASTELLANE"], fixed, [ROSTER])).toEqual(["H22-FENIMORE", "H18-PREWITT", "A17-QUILLON"]);
  });

  it("ticks and unticks, in jersey order", () => {
    expect(toggleOut([], "H22-FENNIMORE", true)).toEqual(["H22-FENNIMORE"]);
    expect(toggleOut(["H22-FENNIMORE", "A17-QUILLON"], "H22-FENNIMORE", false)).toEqual(["A17-QUILLON"]);
    expect([...ROSTER].sort(outOrder).map((p) => p.playerId)).toEqual(["H7-CASTELLANE", "A12-VANTREE", "H14-ORMSBY", "A17-QUILLON", "H22-FENNIMORE", "H81-PREWITT"]);
  });
});

describe("the loop and the log", () => {
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
        await new Promise((resolve) => setTimeout(resolve, 0));
      },
    };
  }

  it("logs who is out when it changes, tells the reader, and drops the credit", async () => {
    const h = harness();
    h.controller.setOut(["H22-FENNIMORE"]);
    await h.controller.start();
    // The snapshot said so before the log was read: the log catches up once.
    expect(h.logged.filter((r) => r.kind === "stats_out")).toEqual([expect.objectContaining({ kind: "stats_out", playerIds: ["H22-FENNIMORE"] })]);
    h.controller.setOut(["H22-FENNIMORE"]);
    expect(h.logged.filter((r) => r.kind === "stats_out")).toHaveLength(1);
    h.controller.setOut(["A17-QUILLON", "H22-FENNIMORE"]);
    expect(h.logged.filter((r) => r.kind === "stats_out")).toHaveLength(2);

    h.say("fennimore up the middle for eight brought down by quillon", 11_000);
    h.say("second and two", 1_000);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0].gameState?.out).toEqual(["A17-QUILLON", "H22-FENNIMORE"]);
    await h.answer({ ok: true, plays: [play(0, 0, [ev("H22-FENNIMORE", "rush", 8), ev("A17-QUILLON", "tackle")])], usage: NO_USAGE });
    const added = h.logged.find((r) => r.kind === "stats_play");
    expect(added && added.kind === "stats_play" ? added.changes : null).toEqual([]);
    expect(added && added.kind === "stats_play" ? added.dropped.map((d) => d.rule) : null).toEqual(["R35", "R35"]);
  });

  it("comes back from the log, and the replay applies it by time", () => {
    const records = [
      { kind: "stats_out", gameId: "g1", at: 10, playerIds: ["H22-FENNIMORE"] },
      { kind: "stats_out", gameId: "g1", at: 20, playerIds: [] },
      { kind: "stats_out", gameId: "g1", at: 30, playerIds: ["A17-QUILLON"] },
    ];
    expect([...restoreFromLog(records).out]).toEqual(["A17-QUILLON"]);
    expect(foldStats(records)).toEqual([]);

    const reply = (at: number, seq: number) => ({
      kind: "stats_reply",
      gameId: "g1",
      at,
      ok: true,
      seqFrom: seq,
      seqTo: seq,
      plays: [play(seq, seq, [ev("H22-FENNIMORE", "rush", 5)])],
    });
    const log = [
      { kind: "utterance", gameId: "g1", at: 1, text: "fennimore for five", offsetMs: 0 },
      { kind: "utterance", gameId: "g1", at: 2, text: "fennimore for five again", offsetMs: 1 },
      { kind: "stats_out", gameId: "g1", at: 5, playerIds: ["H22-FENNIMORE"] },
      reply(6, 0),
      { kind: "stats_out", gameId: "g1", at: 7, playerIds: [] },
      reply(8, 1),
    ];
    const replayed = replayRecorded(log, ROSTER);
    expect(replayed.plays[0].dropped.map((d) => d.rule)).toContain("R35");
    expect(replayed.plays[1].changes.map((c) => c.key)).toEqual(["rush_att", "rush_yds"]);
    expect(replayed.after.get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 5 });

    const game = readReplayLog({
      format: "spotter-v3-log",
      version: 1,
      records: [
        {
          kind: "game",
          gameId: "g1",
          at: 0,
          snapshot: { home: { id: "h", name: "N", wearing: null }, away: { id: "a", name: "S", wearing: null }, sport: "football", watchlist: [], keyterms: [], teamCues: [], statsEnabled: true, statsRoster: ROSTER, out: ["H81-PREWITT"] },
        },
        ...log,
      ],
    });
    expect(game.outChanges).toEqual([
      { at: 0, playerIds: ["H81-PREWITT"] },
      { at: 5, playerIds: ["H22-FENNIMORE"] },
      { at: 7, playerIds: [] },
    ]);
  });
});
