import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LossHint } from "@/components/livestats/StatsStrip";
import { tallyChanges } from "@/lib/cards/tonight";
import { correctPlay, EMPTY_SESSION, LOSS_SIGNED, okPlay, readPlays, restoreFromLog, saysLoss, talliesOf, undoLast, type StatsSession } from "@/lib/livestats/session";
import { typedAmount } from "@/lib/livestats/suggest";
import type { Action, StatsEvent, StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";
import { foldStats, type StatsRecord } from "@/lib/log/statsLog";

// =============================================================================
// Typed corrections (Oct 10): a correction locks only what was typed, so a
// later read can still add a tackler; passer and receiver yards follow each
// other; a number typed on a loss is a loss. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-ALDERWICK", side: "home", jersey: "7", first: "Tam", last: "Alderwick", position: "QB", season: { pass_att: 140 } },
  { playerId: "H22-WEXCOMBE", side: "home", jersey: "22", first: "Bram", last: "Wexcombe", position: "RB" },
  { playerId: "H23-TOLLIVER", side: "home", jersey: "23", first: "Rex", last: "Tolliver", position: "RB" },
  { playerId: "H81-HARLOW", side: "home", jersey: "81", first: "Joss", last: "Harlow", position: "WR" },
  { playerId: "A50-GRISWALD", side: "away", jersey: "50", first: "Abe", last: "Griswald", position: "LB" },
  { playerId: "A90-PENROSE", side: "away", jersey: "90", first: "Cal", last: "Penrose", position: "DL" },
];

function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}
function read(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
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
    summary: "run",
    evidence: "",
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    ...extra,
  };
}
const LINES = [
  { seq: 10, text: "wexcombe takes the handoff" },
  { seq: 11, text: "picks up four" },
  { seq: 12, text: "griswald and penrose bring him down" },
];
const context = { utterances: LINES, readThrough: 12 };
const RUN = read(10, 11, [ev("H22-WEXCOMBE", "rush", 4)]);
/** The rest of the call: the same lines and one more, naming a tackler. */
const RUN_AGAIN = read(10, 12, [ev("H22-WEXCOMBE", "rush", 4), ev("A50-GRISWALD", "tackle")]);
const index = (session: StatsSession, playerId: string, key: string) =>
  session.plays[0].changes.findIndex((change) => change.playerId === playerId && change.key === key);
const items = (session: StatsSession) => session.plays[0].changes.map((change) => `${change.playerId} ${change.key} ${change.amount}`);

describe("a correction locks only what was typed", () => {
  it("keeps typed yards when a later read adds a tackler", () => {
    let session = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000, context).session;
    session = correctPlay(session, "10-11", { type: "amount", index: index(session, "H22-WEXCOMBE", "rush_yds"), amount: 6 }).session;
    session = readPlays(session, [RUN_AGAIN], ROSTER, 2000, context).session;
    expect(items(session)).toEqual(["H22-WEXCOMBE rush_att 1", "H22-WEXCOMBE rush_yds 6", "A50-GRISWALD tkl 1"]);
  });

  it("keeps the runner typed in when a later read names the old one again", () => {
    let session = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000, context).session;
    session = correctPlay(session, "10-11", { type: "player", index: index(session, "H22-WEXCOMBE", "rush_att"), playerId: "H23-TOLLIVER" }).session;
    session = readPlays(session, [RUN_AGAIN], ROSTER, 2000, context).session;
    expect(items(session)).toEqual(["H23-TOLLIVER rush_att 1", "H23-TOLLIVER rush_yds 4", "A50-GRISWALD tkl 1"]);
  });

  it("keeps the runner typed in when a later read gives the carry to someone else", () => {
    let session = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000, context).session;
    session = correctPlay(session, "10-11", { type: "player", index: index(session, "H22-WEXCOMBE", "rush_att"), playerId: "H23-TOLLIVER" }).session;
    const other = read(10, 12, [ev("H81-HARLOW", "rush", 5), ev("A50-GRISWALD", "tackle")]);
    session = readPlays(session, [other], ROSTER, 2000, { utterances: [...LINES, { seq: 12, text: "harlow griswald" }], readThrough: 12 }).session;
    expect(items(session).filter((item) => item.includes("rush"))).toEqual(["H23-TOLLIVER rush_att 1", "H23-TOLLIVER rush_yds 5"]);
  });

  it("keeps a removed item removed after a later read", () => {
    const first = read(10, 12, [ev("H22-WEXCOMBE", "rush", 4), ev("A90-PENROSE", "tackle")]);
    let session = readPlays(EMPTY_SESSION, [first], ROSTER, 1000, context).session;
    session = correctPlay(session, "10-12", { type: "remove", index: index(session, "A90-PENROSE", "tkl") }).session;
    session = readPlays(session, [read(10, 12, [ev("H22-WEXCOMBE", "rush", 5), ev("A90-PENROSE", "tackle"), ev("A50-GRISWALD", "tackle")])], ROSTER, 2000, context).session;
    expect(items(session)).toEqual(["H22-WEXCOMBE rush_att 1", "H22-WEXCOMBE rush_yds 5", "A50-GRISWALD tkl 1"]);
  });

  it("is exact under undo", () => {
    let session = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000, context).session;
    session = okPlay(session, 1001).session;
    session = correctPlay(session, "10-11", { type: "amount", index: index(session, "H22-WEXCOMBE", "rush_yds"), amount: 9 }).session;
    expect(talliesOf(session).get("H22-WEXCOMBE")?.stats).toEqual({ rush_att: 1, rush_yds: 9 });
    session = undoLast(session, 2000).session;
    expect(talliesOf(session).size).toBe(0);
    session = okPlay(session, 2001).session;
    expect(talliesOf(session).get("H22-WEXCOMBE")?.stats).toEqual({ rush_att: 1, rush_yds: 9 });
  });
});

describe("passer and receiver yards follow each other", () => {
  const PASS = read(10, 11, [ev("H7-ALDERWICK", "pass_complete", 9), ev("H81-HARLOW", "reception", 9)], { playType: "pass" });
  const passLines = { utterances: [{ seq: 10, text: "alderwick looks" }, { seq: 11, text: "harlow makes the catch" }], readThrough: 11 };

  it("sets the receiver's yards when the passer's are typed", () => {
    let session = readPlays(EMPTY_SESSION, [PASS], ROSTER, 1000, passLines).session;
    session = correctPlay(session, "10-11", { type: "amount", index: index(session, "H7-ALDERWICK", "pass_yds"), amount: 12 }).session;
    expect(tallyChanges(session.plays[0].changes).get("H81-HARLOW")?.stats).toEqual({ rec: 1, rec_yds: 12 });
    expect(tallyChanges(session.plays[0].changes).get("H7-ALDERWICK")?.stats).toMatchObject({ pass_yds: 12 });
  });

  it("sets the passer's yards when the receiver's are typed", () => {
    let session = readPlays(EMPTY_SESSION, [PASS], ROSTER, 1000, passLines).session;
    session = correctPlay(session, "10-11", { type: "amount", index: index(session, "H81-HARLOW", "rec_yds"), amount: 15 }).session;
    expect(tallyChanges(session.plays[0].changes).get("H7-ALDERWICK")?.stats).toMatchObject({ pass_yds: 15 });
  });
});

describe("a number typed on a loss", () => {
  const sack = read(10, 11, [ev("H7-ALDERWICK", "sacked"), ev("A90-PENROSE", "sack")], { playType: "sack", summary: "ALDERWICK sacked by PENROSE" });

  it("is saved as a loss on a sack, kept a gain with +, and left alone on a play with no loss", () => {
    expect(saysLoss(sack)).toBe(true);
    expect(LOSS_SIGNED.has("rush_yds") && !LOSS_SIGNED.has("sack_yds")).toBe(true);
    expect(typedAmount("7", { loss: saysLoss(sack) })).toEqual({ ok: true, amount: -7 });
    expect(typedAmount("+7", { loss: saysLoss(sack) })).toEqual({ ok: true, amount: 7 });
    expect(typedAmount("-7", { loss: true })).toEqual({ ok: true, amount: -7 });
    const plain = read(10, 11, [ev("H22-WEXCOMBE", "rush")], { summary: "WEXCOMBE up the middle" });
    expect(saysLoss(plain, "wexcombe up the middle")).toBe(false);
    expect(typedAmount("7", { loss: saysLoss(plain, "wexcombe up the middle") })).toEqual({ ok: true, amount: 7 });
  });

  it("shows the minus under the box before it is saved", () => {
    expect(renderToStaticMarkup(createElement(LossHint, { typed: "7" }))).toContain("Saves as <span class=\"font-bold tabular-nums\">−7</span>, a loss");
    expect(renderToStaticMarkup(createElement(LossHint, { typed: "+7" }))).toContain("a number with no sign is saved as minus");
  });

  it("reads loss in the play's summary or its lines", () => {
    const run = read(10, 11, [ev("H22-WEXCOMBE", "rush")], { summary: "WEXCOMBE run" });
    expect(saysLoss(run, "wexcombe dropped for a loss")).toBe(true);
    expect(saysLoss({ ...run, summary: "WEXCOMBE run for a loss" })).toBe(true);
  });
});

describe("the log keeps what was typed", () => {
  it("folds a later read's changes onto an edited play, and keeps an old log's correction whole", () => {
    let session = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1000, context).session;
    const step = correctPlay(session, "10-11", { type: "amount", index: index(session, "H22-WEXCOMBE", "rush_yds"), amount: 6 });
    session = step.session;
    const later = readPlays(session, [RUN_AGAIN], ROSTER, 2000, context);
    const play = later.updated[0];
    const base = { gameId: "g", at: 1 };
    const records: StatsRecord[] = [
      { ...base, kind: "stats_play", playId: "10-11", play: RUN, changes: [], dropped: [] },
      { ...base, kind: "stats_decision", playId: "10-11", decision: "edit", changes: step.play!.changes, edits: step.play!.edits },
      { ...base, kind: "stats_update", playId: "10-11", play: play.play, changes: play.changes, dropped: play.dropped },
    ];
    expect(foldStats(records)[0].changes).toEqual(play.changes);
    expect(restoreFromLog(records).session.plays[0].edits).toEqual(step.play!.edits);

    const old = records.map((record) => (record.kind === "stats_decision" ? { ...record, edits: undefined } : record));
    expect(foldStats(old)[0].changes).toEqual(step.play!.changes);
  });
});
