import { describe, expect, it } from "vitest";
import { lineText } from "@/lib/cards/lines";
import { tallyChanges, tallyWithBooth } from "@/lib/cards/tonight";
import { BOOTH_REREADS_PER_GAME, StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { BOOTH_REREAD_PROMPT, volatileContent } from "@/lib/livestats/extract";
import { renderGameState } from "@/lib/livestats/gameStateBlock";
import { STATS_SCHEMA, STATS_SYSTEM_PROMPT } from "@/lib/livestats/prompt";
import { readBoothLine, readGameState, readRequest } from "@/lib/livestats/request";
import { replayRecorded } from "@/lib/livestats/recorded";
import { boothLinesOf, correctPlay, EMPTY_SESSION, linesOf, okPlay, readBoothLines, readPlays, restoreFromLog, talliesOf, undoLast, type StatsSession } from "@/lib/livestats/session";
import { boothText, checkBoothLines, MAX_YARDS_PER_PLAY, totalAt } from "@/lib/livestats/statLines";
import { NO_PENALTY, NO_USAGE, type Action, type BoothStatLine, type ExtractStatsRequest, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import { validateStatLines } from "@/lib/livestats/validate";
import { foldBooth, toStatsCsv, type StatsRecord } from "@/lib/log/statsLog";
import { buildStatsReport } from "@/lib/log/statsReport";
import { boothWords } from "@/components/livestats/StatsStrip";

// =============================================================================
// The booth's stat lines set the totals (fix 6, Part 1: lib/livestats/statLines.ts,
// tallyWithBooth in lib/cards/tonight.ts, R41; the re-read a count mismatch
// queues, R42). Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Dax", last: "Prewitt", position: "WR" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

function ev(playerId: string, action: Action, yards: number | null = null, source: StatsEvent["yardsSource"] = yards === null ? null : "stated"): StatsEvent {
  return { playerId, action, yards, yardsSource: source, made: null };
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
    playType: "pass",
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

const completion = (seqStart: number, seqEnd: number, yards: number) =>
  play(seqStart, seqEnd, [ev("H7-CASTELLANE", "pass_complete", yards), ev("H81-PREWITT", "reception", yards)]);
const line = (seq: number, key: BoothStatLine["key"], value: number, extra: Partial<BoothStatLine> = {}): BoothStatLine => ({ seq, playerId: "H7-CASTELLANE", scope: "tonight", key, value, ...extra });
/** "14 of 17 for 181" about the quarterback, on line `seq`. */
const passingLine = (seq: number, cmp = 14, att = 17, yds = 181) => [line(seq, "pass_cmp", cmp), line(seq, "pass_att", att), line(seq, "pass_yds", yds)];

/** Plays read and counted one reply at a time. */
function counted(plays: StatsPlay[], session: StatsSession = EMPTY_SESSION, at = 1000): StatsSession {
  let current = session;
  for (const each of plays) {
    const read = readPlays(current, [each], ROSTER, at);
    current = read.session;
    for (const added of read.added) current = okPlay(current, at + 1, added.playId).session;
  }
  return current;
}

const stat = (session: StatsSession, playerId: string, key: BoothStatLine["key"]) => talliesOf(session).get(playerId)?.stats[key] ?? 0;

describe("the totals follow the booth's line (R41)", () => {
  it("sets the total to the line, and a later play adds on top", () => {
    let session = counted([completion(1, 2, 9), completion(4, 5, 12)]);
    expect(stat(session, "H7-CASTELLANE", "pass_yds")).toBe(21);
    const booth = readBoothLines(session, passingLine(7), ROSTER);
    session = booth.session;
    expect(booth.accepted).toHaveLength(3);
    expect(booth.accepted.find((each) => each.key === "pass_yds")).toMatchObject({ had: 21, value: 181 });
    expect(stat(session, "H7-CASTELLANE", "pass_cmp")).toBe(14);
    expect(stat(session, "H7-CASTELLANE", "pass_att")).toBe(17);
    expect(stat(session, "H7-CASTELLANE", "pass_yds")).toBe(181);
    // A stat the booth did not state is still the plays' sum.
    expect(stat(session, "H81-PREWITT", "rec_yds")).toBe(21);
    session = counted([completion(9, 10, 6)], session);
    expect(stat(session, "H7-CASTELLANE", "pass_yds")).toBe(187);
    expect(stat(session, "H7-CASTELLANE", "pass_cmp")).toBe(15);
    expect(stat(session, "H81-PREWITT", "rec_yds")).toBe(27);
  });

  it("is unmoved by a correction to a play before the line, and moved by one after it", () => {
    let session = counted([completion(1, 2, 9), completion(4, 5, 12)]);
    session = readBoothLines(session, passingLine(7), ROSTER).session;
    session = counted([completion(9, 10, 6)], session);
    const [before, , after] = session.plays;
    // The booth's 181 already includes the 9-yard throw, whatever it really was.
    const earlier = correctPlay(session, before.playId, { type: "amount", index: before.changes.findIndex((change) => change.key === "pass_yds"), amount: 19 }).session;
    expect(stat(earlier, "H7-CASTELLANE", "pass_yds")).toBe(187);
    const later = correctPlay(session, after.playId, { type: "amount", index: after.changes.findIndex((change) => change.key === "pass_yds"), amount: 16 }).session;
    expect(stat(later, "H7-CASTELLANE", "pass_yds")).toBe(197);
  });

  it("shows the set total with no ~ on the card, and keeps the ~ of what came after", () => {
    let session = counted([completion(1, 2, 9)]);
    session = readBoothLines(session, passingLine(4), ROSTER).session;
    const lines = linesOf(session, ROSTER).get("H7-CASTELLANE")!;
    expect(lineText(lines.tonight)).toBe("14-17 · 181 yds");
    expect(lines.tonight.every((item) => !item.estimated)).toBe(true);
    // A worked-out gain after the line marks the yards, as it always has.
    session = counted([play(6, 7, [ev("H7-CASTELLANE", "pass_complete", 11, "spots"), ev("H81-PREWITT", "reception", 11, "spots")])], session);
    expect(lineText(linesOf(session, ROSTER).get("H7-CASTELLANE")!.tonight)).toBe("15-18 · ~192 yds");
  });

  it("undo is exact: taking back a play after the line takes its yards off, and one before changes nothing", () => {
    let session = counted([completion(1, 2, 9)]);
    session = readBoothLines(session, passingLine(4), ROSTER).session;
    session = counted([completion(6, 7, 6)], session, 2000);
    expect(stat(session, "H7-CASTELLANE", "pass_yds")).toBe(187);
    session = undoLast(session, 3000).session;
    expect(stat(session, "H7-CASTELLANE", "pass_yds")).toBe(181);
    session = undoLast(session, 4000).session;
    expect(stat(session, "H7-CASTELLANE", "pass_yds")).toBe(181);
  });

  it("is one function, which tallyChanges is a case of", () => {
    const changes = [{ playerId: "P", key: "rush_yds" as const, amount: 5, estimated: false }];
    expect(tallyChanges(changes)).toEqual(tallyWithBooth([{ seqStart: 0, changes }], []));
    expect(tallyWithBooth([{ seqStart: 3, changes }], [{ seq: 5, playerId: "P", key: "rush_yds", value: 40 }]).get("P")?.stats.rush_yds).toBe(40);
    expect(tallyWithBooth([{ seqStart: 6, changes }], [{ seq: 5, playerId: "P", key: "rush_yds", value: 40 }]).get("P")?.stats.rush_yds).toBe(45);
    // The later line wins.
    const totals = tallyWithBooth([], [{ seq: 5, playerId: "P", key: "rush_yds", value: 40 }, { seq: 9, playerId: "P", key: "rush_yds", value: 52 }]);
    expect(totals.get("P")?.stats.rush_yds).toBe(52);
    expect(totalAt([{ seqStart: 1, status: "applied", changes, quarter: 1 }], [], "P", "rush_yds", 2)).toBe(5);
    expect(totalAt([{ seqStart: 3, status: "applied", changes, quarter: 1 }], [], "P", "rush_yds", 2)).toBe(0);
  });
});

describe("what the check refuses", () => {
  const plays = (session: StatsSession) => session.plays.map((p) => ({ seqStart: p.play.seqStart, status: p.status, changes: p.changes, quarter: p.play.quarter }));

  it("a line about the season, a career or another game", () => {
    const session = counted([completion(1, 2, 9)]);
    const check = checkBoothLines([line(4, "pass_yds", 1_200, { scope: "season" }), line(4, "pass_td", 11, { scope: "career" })], { plays: plays(session), accepted: [], roster: ROSTER });
    expect(check.accepted).toEqual([]);
    expect(check.refused.map((each) => each.reason)).toEqual([expect.stringMatching(/not tonight's total/), expect.stringMatching(/not tonight's total/)]);
    // This half counts in the first half, not in the second.
    expect(checkBoothLines([line(4, "pass_yds", 90, { scope: "this_half" })], { plays: plays(session), accepted: [], roster: ROSTER }).accepted).toHaveLength(1);
    const second = counted([play(6, 7, [ev("H22-FENNIMORE", "rush", 3)], { quarter: 3, playType: "run" })], session);
    expect(checkBoothLines([line(8, "pass_yds", 90, { scope: "this_half" })], { plays: plays(second), accepted: [], roster: ROSTER }).refused[0].reason).toMatch(/first-half total/);
  });

  it("a count that would go down, more completions than attempts, more touchdowns than catches, or yards no count could be worth", () => {
    const session = counted([completion(1, 2, 9)]);
    const accepted = checkBoothLines(passingLine(4), { plays: plays(session), accepted: [], roster: ROSTER }).accepted;
    const down = checkBoothLines([line(8, "pass_cmp", 12)], { plays: plays(session), accepted, roster: ROSTER });
    expect(down.accepted).toEqual([]);
    expect(down.refused[0].reason).toMatch(/below the CMP the booth read before/);
    expect(checkBoothLines([line(8, "pass_cmp", 20), line(8, "pass_att", 18)], { plays: plays(session), accepted: [], roster: ROSTER }).refused[0].reason).toMatch(/more completions than attempts/);
    expect(checkBoothLines([line(8, "rec", 3, { playerId: "H81-PREWITT" }), line(8, "rec_td", 4, { playerId: "H81-PREWITT" })], { plays: plays(session), accepted: [], roster: ROSTER }).refused[0].reason).toMatch(/more REC TD than REC/);
    expect(checkBoothLines([line(8, "rec", 2, { playerId: "H81-PREWITT" }), line(8, "rec_yds", 2 * MAX_YARDS_PER_PLAY + 1, { playerId: "H81-PREWITT" })], { plays: plays(session), accepted: [], roster: ROSTER }).refused[0].reason).toMatch(/not possible/);
    // A later, bigger count is fine, and so is a player the booth has not read before.
    expect(checkBoothLines([line(8, "pass_cmp", 15), line(8, "rec", 5, { playerId: "H81-PREWITT" })], { plays: plays(session), accepted, roster: ROSTER }).accepted).toHaveLength(2);
  });

  it("a player the words do not name, and one on neither roster", () => {
    const session = counted([completion(1, 2, 9)]);
    const utterances = [
      { seq: 4, text: "he is 14 of 17 for 1 81 on the night" },
      { seq: 5, text: "a fine night so far for castellane" },
      { seq: 20, text: "and that is 5 catches for prewitt" },
    ];
    expect(checkBoothLines(passingLine(4), { plays: plays(session), accepted: [], roster: ROSTER, utterances }).accepted).toHaveLength(3);
    // Named six lines later is too far.
    expect(checkBoothLines(passingLine(14), { plays: plays(session), accepted: [], roster: ROSTER, utterances: [{ seq: 14, text: "he is 14 of 17 for 1 81" }, ...utterances.slice(2)] }).refused[0].reason).toMatch(/not named/);
    expect(checkBoothLines([line(4, "rec", 5, { playerId: "A99-NOBODY" })], { plays: plays(session), accepted: [], roster: ROSTER }).refused[0].reason).toBe("not on either roster");
  });

  it("a count the plays disagree with is a mismatch, for the re-read", () => {
    const session = counted([completion(1, 2, 9), completion(4, 5, 12)]);
    const check = checkBoothLines(passingLine(7, 3, 4, 30), { plays: plays(session), accepted: [], roster: ROSTER });
    expect(check.mismatched.map((each) => `${each.key} ${each.had}->${each.value}`)).toEqual(["pass_cmp 2->3", "pass_att 2->4"]);
    expect(checkBoothLines(passingLine(7, 2, 2, 30), { plays: plays(session), accepted: [], roster: ROSTER }).mismatched).toEqual([]);
  });

  it("validates the reader's items before any of that: a seq in the window, a stat key, a scope, a whole number", () => {
    const window = { utterances: [{ seq: 3, text: "x", offsetMs: 0 }, { seq: 4, text: "y", offsetMs: 0 }] };
    const lines = validateStatLines(
      [
        { seq: 4, playerId: " H7-CASTELLANE ", scope: "tonight", key: "pass_yds", value: 181.2 },
        { seq: 9, playerId: "H7-CASTELLANE", scope: "tonight", key: "pass_yds", value: 1 },
        { seq: 4, playerId: "H7-CASTELLANE", scope: "tonight", key: "points", value: 1 },
        { seq: 4, playerId: "H7-CASTELLANE", scope: "lately", key: "pass_td", value: 1 },
        { seq: 4, playerId: "H7-CASTELLANE", scope: "tonight", key: "pass_td", value: 1000 },
        { seq: 4, playerId: "H7-CASTELLANE", scope: "tonight", key: "gp", value: 1 },
        { seq: 4, playerId: "", scope: "tonight", key: "pass_td", value: 1 },
        { seq: 4, playerId: "H7-CASTELLANE", scope: "tonight", key: "pass_yds", value: 999 },
      ],
      window,
    );
    expect(lines).toEqual([{ seq: 4, playerId: "H7-CASTELLANE", scope: "tonight", key: "pass_yds", value: 181 }]);
    expect(validateStatLines("nope", window)).toEqual([]);
  });
});

describe("the reader is asked for them", () => {
  it("as a required array with no nullable field, under the sixteen", () => {
    expect(STATS_SCHEMA.required).toContain("statLines");
    const item = STATS_SCHEMA.properties.statLines.items;
    expect(Object.keys(item.properties).sort()).toEqual(["key", "playerId", "scope", "seq", "value"]);
    expect([...item.required].sort()).toEqual(["key", "playerId", "scope", "seq", "value"]);
    expect(JSON.stringify(item)).not.toContain("null");
  });

  it("in general terms: a total is never a play's yards, scope matters, and a split number is read whole", () => {
    expect(STATS_SYSTEM_PROMPT).toContain("A stat line is a total, never the yards on one play.");
    expect(STATS_SYSTEM_PROMPT).toContain('"for 1 81" is 181');
    expect(STATS_SYSTEM_PROMPT).toContain('"this_half" when the booth says the half');
    expect(STATS_SYSTEM_PROMPT).toContain("leave the item out");
  });
});

describe("the log, the reload and the report", () => {
  const GAME = "g1";
  const record = (kind: string, at: number, rest: Record<string, unknown>) => ({ kind, gameId: GAME, at, ...rest }) as unknown as StatsRecord;

  function logged(): StatsRecord[] {
    const first = completion(1, 2, 9);
    const read = readPlays(EMPTY_SESSION, [first], ROSTER, 10);
    const entry = read.added[0];
    return [
      record("game", 0, { snapshot: { home: { id: "h", name: "Home" }, away: { id: "a", name: "Away" }, sport: "football", watchlist: [], keyterms: [], teamCues: [], statsEnabled: true, statsRoster: ROSTER } }),
      record("utterance", 1, { text: "first and ten", offsetMs: 0, connectionId: 1 }),
      record("utterance", 2, { text: "castellane to prewitt for 9", offsetMs: 100, connectionId: 1 }),
      record("utterance", 3, { text: "brought down", offsetMs: 200, connectionId: 1 }),
      record("utterance", 4, { text: "second and one", offsetMs: 300, connectionId: 1 }),
      record("utterance", 5, { text: "castellane is 14 of 17 for 1 81 tonight", offsetMs: 400, connectionId: 1 }),
      record("stats_reply", 10, { ok: true, plays: [first], seqFrom: 0, seqTo: 2, tokensIn: 10, tokensOut: 5, tokensCached: 0 }),
      record("stats_play", 10, { playId: entry.playId, play: entry.play, changes: entry.changes, dropped: entry.dropped }),
      record("stats_decision", 11, { playId: entry.playId, decision: "ok" }),
      record("stats_reply", 20, { ok: true, plays: [], seqFrom: 3, seqTo: 4, tokensIn: 10, tokensOut: 5, tokensCached: 0, statLines: passingLine(4) }),
      ...passingLine(4).map((each) => record("stats_booth", 20, { accepted: true, line: each, had: each.key === "pass_yds" ? 9 : 1 })),
      record("stats_booth", 20, { accepted: false, line: line(4, "pass_yds", 2_000, { scope: "season" }), reason: "not tonight's total (season)" }),
    ];
  }

  it("folds the accepted lines back, so a reload has the same totals", () => {
    const records = logged();
    expect(foldBooth(records).map((each) => `${each.key} ${each.value} had ${each.had}`)).toEqual(["pass_cmp 14 had 1", "pass_att 17 had 1", "pass_yds 181 had 9"]);
    const restored = restoreFromLog(records);
    expect(boothLinesOf(restored.session)).toHaveLength(3);
    expect(stat(restored.session, "H7-CASTELLANE", "pass_yds")).toBe(181);
    expect(restored.booth?.map((each) => each.key)).toEqual(["pass_cmp", "pass_att", "pass_yds"]);
    expect(boothText(restored.booth!, ROSTER)).toBe("Booth: CASTELLANE 14/17 181 yds (had 1)");
  });

  it("gives the report's Totals sheet and the stats .csv the same total as the cards", () => {
    const records = logged();
    const report = buildStatsReport(records)!;
    const totals = report.sheets.find((sheet) => sheet.name === "Totals")!;
    const row = totals.rows.find((cells) => cells[2] === "Ivo Castellane")!;
    const column = totals.header.indexOf("Pass yds");
    expect(row[column]).toBe(181);
    expect(totals.intro[1]).toMatch(/3 stat lines the booth read on air set totals/);
    const csv = toStatsCsv(records)!;
    expect(csv).toContain("booth-4,booth,no,Ivo Castellane,home,7,Pass yds,181,,Booth: sets the total to 181 from line 5 (the plays had 9),,R41");
  });

  it("applies a recorded reply's stat lines again in the recorded replay", () => {
    const result = replayRecorded(logged(), ROSTER);
    expect(result.after.get("H7-CASTELLANE")?.stats.pass_yds).toBe(181);
    expect(result.before.get("H7-CASTELLANE")?.stats.pass_yds).toBe(181);
  });
});

describe("the loop", () => {
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

  /** One completion read and counted, then the booth's line about the passer, read in the next reply. */
  async function withALine(h: ReturnType<typeof harness>, statLines: BoothStatLine[]) {
    await h.controller.start();
    h.say("castellane to prewitt for 9");
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    h.say("brought down by quillon");
    h.say("castellane is 14 of 17 for 1 81 tonight");
    h.say("second and one", 11_000);
    await h.answer({ ok: true, plays: [completion(0, 1, 9)], statLines, usage: NO_USAGE });
  }

  it("applies the line, logs it, says it on the strip, and queues one re-read for the count mismatch (R42)", async () => {
    const h = harness();
    await withALine(h, passingLine(2));
    expect(stat(h.controller.getView().session, "H7-CASTELLANE", "pass_yds")).toBe(181);
    expect(h.logged.filter((r) => r.kind === "stats_booth")).toHaveLength(3);
    expect(h.logged.filter((r) => r.kind === "stats_reply").pop()).toMatchObject({ statLines: passingLine(2) });
    expect(boothWords(h.controller.getView())).toBe("Booth: CASTELLANE 14/17 181 yds (had 1)");
    expect(h.controller.bridge.counts().boothLines).toBe(3);
    // Completions and attempts both disagree, but one line is one re-read, for that player's plays up to the line.
    expect(h.requests).toHaveLength(3);
    const request = h.requests[2];
    expect(request.look).toBe("booth");
    expect(request.boothLine).toEqual({ seq: 2, playerId: "H7-CASTELLANE", key: "pass_cmp", value: 14, spotter: 1 });
    expect(request.utterances.map((u) => u.seq)).toEqual([0, 1, 2]);
    expect(request.recentPlays.map((p) => p.playId)).toEqual(["0-1"]);
    expect(request.gameState?.booth).toHaveLength(3);
    const content = volatileContent(request);
    expect(content).toContain(BOOTH_REREAD_PROMPT);
    expect(content).toContain("BOOTH STAT LINE");
    expect(content).toContain("13 are missing from the plays");
    expect(renderGameState(request.gameState!)).toContain("H7-CASTELLANE: 14 CMP, 17 ATT, 181 PASS YDS (line 2)");
    expect(h.controller.bridge.counts().boothRereads).toBe(1);
    // Its corrections carry R42, and the totals still follow the booth.
    // A throw the first read missed, on the booth's own line: a new play, noted R42.
    await h.answer({ ok: true, plays: [play(2, 2, [ev("H7-CASTELLANE", "pass_complete", 7)])], usage: NO_USAGE });
    const added = h.controller.getView().session.plays.find((p) => p.playId === "2-2")!;
    expect(added.dropped).toContainEqual(expect.objectContaining({ rule: "R42" }));
    expect(added.status).toBe("applied");
    expect(stat(h.controller.getView().session, "H7-CASTELLANE", "pass_yds")).toBe(181);
    expect(h.logged.filter((r) => r.kind === "stats_reply").pop()).toMatchObject({ look: "booth" });
  });

  it("queues nothing when the counts agree, re-reads one at a time, and stops at the cap", async () => {
    const agree = harness();
    await withALine(agree, passingLine(2, 1, 1, 12));
    expect(agree.requests).toHaveLength(2);
    expect(stat(agree.controller.getView().session, "H7-CASTELLANE", "pass_yds")).toBe(12);

    const h = harness();
    await h.controller.start();
    h.say("castellane to prewitt for 9");
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    // One line per receiver, far more than the cap, each on its own seq; every one disagrees.
    for (let i = 0; i < BOOTH_REREADS_PER_GAME + 3; i++) h.say(`prewitt has ${i + 2} catches`);
    h.say("second and one", 11_000);
    const lines = Array.from({ length: BOOTH_REREADS_PER_GAME + 3 }, (_, i) => line(i + 1, "rec", i + 2, { playerId: "H81-PREWITT" }));
    await h.answer({ ok: true, plays: [completion(0, 0, 9)], statLines: lines, usage: NO_USAGE });
    // One in flight; the rest wait their turn.
    expect(h.requests.filter((r) => r.look === "booth")).toHaveLength(1);
    expect(h.pending()).toBe(1);
    for (let i = 0; i < BOOTH_REREADS_PER_GAME + 3; i++) {
      if (h.pending() === 0) break;
      await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    }
    expect(h.requests.filter((r) => r.look === "booth")).toHaveLength(BOOTH_REREADS_PER_GAME);
    expect(h.controller.bridge.counts().boothRereads).toBe(BOOTH_REREADS_PER_GAME);
  });

  it("comes back from a reload with the same totals and does not re-read the same line", async () => {
    const h = harness();
    await withALine(h, passingLine(2));
    await h.answer({ ok: true, plays: [], usage: NO_USAGE });
    const again = harness(h.logged);
    await again.controller.start();
    expect(talliesOf(again.controller.getView().session)).toEqual(talliesOf(h.controller.getView().session));
    expect(boothWords(again.controller.getView())).toBe("Booth: CASTELLANE 14/17 181 yds (had 1)");
    expect(again.controller.bridge.counts()).toMatchObject({ boothLines: 3, boothRereads: 1 });
    expect(again.requests).toHaveLength(0);
  });

  it("the route reads the booth line and the game state's lines field by field", () => {
    expect(readBoothLine({ seq: 2, playerId: "H7-CASTELLANE", key: "pass_cmp", value: 14, spotter: 1 })).toEqual({ seq: 2, playerId: "H7-CASTELLANE", key: "pass_cmp", value: 14, spotter: 1 });
    expect(readBoothLine({ seq: 2, playerId: "H7-CASTELLANE", key: "points", value: 14, spotter: 1 })).toBeNull();
    expect(readGameState({ booth: [{ seq: 2, playerId: "H7-CASTELLANE", key: "pass_cmp", value: 14 }, { seq: 2, playerId: "x", key: "nope", value: 1 }] })).toEqual({ booth: [{ seq: 2, playerId: "H7-CASTELLANE", key: "pass_cmp", value: 14 }] });
    const parsed = readRequest({
      utterances: [{ seq: 1, text: "x", offsetMs: 0 }],
      rosters: ROSTER,
      recentPlays: [],
      look: "booth",
      boothLine: { seq: 1, playerId: "H7-CASTELLANE", key: "pass_cmp", value: 14, spotter: 1 },
    });
    expect(parsed).toMatchObject({ look: "booth", boothLine: { key: "pass_cmp" } });
  });
});
