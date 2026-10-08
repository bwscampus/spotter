import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CardLogError,
  checkCards,
  creditNamesHeard,
  firstDifference,
  logRecords,
  replayCards,
  type CardFrame,
} from "@/lib/replay/cardEquality";

// G5 (docs/V3_DEFINITION.md section 4): one saved log through the card path
// with live stats off and on, and the cards shown must be identical. The log is
// test/fixtures/g5-synthetic-log.json, a made-up game between made-up schools
// with made-up players, logged the way the live screen logs one: interims and
// finals, a takedown, and a Refresh rosters partway through.

const FIXTURE = JSON.parse(readFileSync(path.join(__dirname, "fixtures/g5-synthetic-log.json"), "utf8")) as unknown;

describe("G5: the cards shown are the same with stats off and on", () => {
  it("puts up exactly the same cards, frame for frame", async () => {
    const check = await checkCards(FIXTURE);
    expect(check.difference).toBeNull();
    expect(check.equal).toBe(true);
    expect(check.on.frames).toEqual(check.off.frames);
  });

  it("is not a comparison of nothing: cards went up, one came down, and the rosters were refreshed", async () => {
    const { off } = await checkCards(FIXTURE);
    const causes = off.frames.map((frame) => frame.cause);
    expect(causes.filter((cause) => cause === "result").length).toBeGreaterThan(8);
    expect(causes).toContain("takedown");
    expect(causes.filter((cause) => cause === "rosters")).toHaveLength(2);
    expect(off.unplacedTakedowns).toBe(0);
    expect(off.stats).toBeNull();
  });

  it("really ran live stats beside the cards: calls, plays OK'd and taken back, and lines on cards already up", async () => {
    const { on } = await checkCards(FIXTURE);
    const stats = on.stats!;
    expect(stats.calls).toBeGreaterThan(2);
    expect(stats.playsRead).toBeGreaterThan(2);
    // Every new play is OK'd; a read that updates a play already counted is not a new OK.
    expect(stats.oks).toBeGreaterThan(2);
    expect(stats.oks).toBeLessThanOrEqual(stats.playsRead);
    expect(stats.undos).toBeGreaterThan(0);
    expect(stats.restats).toBeGreaterThan(0);
    expect(stats.linesRewritten).toBeGreaterThan(0);
    expect(stats.cardsWithTonight).toBeGreaterThan(0);
  });

  it("would catch a difference, and says where it is", () => {
    const frames: CardFrame[] = [
      { record: 3, at: 10, cause: "result", cards: ["H22-FENNIMORE"] },
      { record: 5, at: 14, cause: "result", cards: ["A17-QUILLON", "H22-FENNIMORE"] },
    ];
    expect(firstDifference(frames, frames)).toBeNull();
    const reordered = [frames[0], { ...frames[1], cards: ["H22-FENNIMORE", "A17-QUILLON"] }];
    expect(firstDifference(frames, reordered)).toEqual({ index: 1, off: frames[1], on: reordered[1] });
    expect(firstDifference(frames, frames.slice(0, 1))).toEqual({ index: 1, off: frames[1], on: null });
    expect(firstDifference(frames, [frames[0], { ...frames[1], at: 15 }])?.index).toBe(1);
  });

  it("replays the same log the same way every time", async () => {
    const records = logRecords(FIXTURE);
    const first = await replayCards(records, { stats: true });
    const second = await replayCards(records, { stats: true });
    expect(second).toEqual(first);
  });
});

describe("reading a log", () => {
  it("refuses anything that is not a V3 log with a game and results in it", () => {
    expect(() => logRecords(null)).toThrow(CardLogError);
    expect(() => logRecords({ format: "spotter-v2-log", version: 1, records: [] })).toThrow("not a Spotter V3 log");
    expect(() => logRecords({ format: "spotter-v3-log", version: 2, records: [] })).toThrow("version 2");
    expect(() => logRecords({ format: "spotter-v3-log", version: 1, records: [{ kind: "result" }] })).toThrow("no game");
    expect(() => logRecords({ format: "spotter-v3-log", version: 1, records: [{ kind: "game" }] })).toThrow("no results");
  });
});

describe("the stand-in for Claude", () => {
  const roster = [
    { playerId: "H22-FENNIMORE", side: "home" as const, jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
    { playerId: "A17-QUILLON", side: "away" as const, jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
  ];

  it("credits a carry to the first surname in the latest line naming anyone, and a tackle to the other side there", async () => {
    const reply = await creditNamesHeard({
      utterances: [
        { seq: 4, text: "second and four", offsetMs: 0 },
        { seq: 5, text: "fennimore up the middle brought down by quillon", offsetMs: 1000 },
        { seq: 6, text: "what a crowd tonight", offsetMs: 2000 },
      ],
      rosters: roster,
      recentPlays: [],
    });
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    expect(reply.plays).toMatchObject([
      {
        seqStart: 5,
        seqEnd: 5,
        playType: "run",
        events: [
          { playerId: "H22-FENNIMORE", action: "rush", yards: 4, yardsSource: "stated" },
          { playerId: "A17-QUILLON", action: "tackle", yards: null },
        ],
      },
    ]);
  });

  it("reads nothing when no surname was said", async () => {
    const reply = await creditNamesHeard({ utterances: [{ seq: 0, text: "second and four", offsetMs: 0 }], rosters: roster, recentPlays: [] });
    expect(reply).toMatchObject({ ok: true, plays: [] });
  });
});
