import { describe, expect, it } from "vitest";
import {
  advanceWatermark,
  isPlayBoundary,
  linesInWindows,
  MAX_WINDOW,
  newPlays,
  NO_WATERMARK,
  readingPlan,
  windowFor,
  WINDOW_OVERLAP,
} from "@/lib/plays/window";
import { NO_FLAGS, type ProposedPlay } from "@/lib/plays/types";
import type { Utterance } from "@/lib/plays/storage";

function said(seq: number, text = `utterance ${seq}`): Utterance {
  return { seq, text, at: "2026-09-22T19:00:00.000Z", offsetMs: seq * 4_000, connectionId: 1 };
}

function play(seqStart: number, seqEnd: number, summary = "LANGAN 8 yd run"): ProposedPlay {
  return {
    seqStart,
    seqEnd,
    quarter: null,
    clockText: null,
    down: null,
    distance: null,
    offense: "home",
    playType: "run",
    players: [],
    yards: null,
    flags: { ...NO_FLAGS },
    confidence: 0.8,
    summary,
  };
}

describe("spotting a play boundary", () => {
  // numerals=true rewrites the ordinals, so half of these are what Deepgram
  // actually sends and the other half are what a person would write.
  const boundaries = [
    "first and ten",
    "1st and 10",
    "second and two",
    "2nd and 2",
    "third and long",
    "3rd and long",
    "fourth and goal",
    "4th and inches",
    "and that will be a first down",
    "1st down",
    "third down coming up",
  ];
  for (const text of boundaries) {
    it(`reads "${text}" as a boundary`, () => expect(isPlayBoundary(text)).toBe(true));
  }

  const notBoundaries = [
    "langan takes it around the left end",
    "and he is brought down after eight",
    "the wind is really picking up out here",
    "that is his second catch of the night",
    "14 12 with under a minute to go",
  ];
  for (const text of notBoundaries) {
    it(`leaves "${text}" alone`, () => expect(isPlayBoundary(text)).toBe(false));
  }
});

describe("choosing the window", () => {
  it("sends everything when nothing has been read yet", () => {
    const all = [said(0), said(1), said(2)];
    expect(windowFor(all, NO_WATERMARK).map((row) => row.seq)).toEqual([0, 1, 2]);
  });

  // The overlap is what stops a play described across a boundary being cut in
  // half, and it is why the same utterance is sent more than once.
  it("reaches back before the watermark so a play is not cut in half", () => {
    const all = Array.from({ length: 20 }, (_, seq) => said(seq));
    const seqs = windowFor(all, 10).map((row) => row.seq);
    expect(seqs[0]).toBe(10 - WINDOW_OVERLAP);
    expect(seqs.at(-1)).toBe(19);
  });

  it("catches up to the present rather than working through a backlog", () => {
    const all = Array.from({ length: MAX_WINDOW + 60 }, (_, seq) => said(seq));
    const seqs = windowFor(all, NO_WATERMARK).map((row) => row.seq);
    expect(seqs).toHaveLength(MAX_WINDOW);
    expect(seqs.at(-1)).toBe(MAX_WINDOW + 59);
  });

  it("sends nothing when nothing has been said", () => {
    expect(windowFor([], NO_WATERMARK)).toEqual([]);
  });

  it("carries the seq and the offset through, and nothing else", () => {
    expect(windowFor([said(3, "third and long")], NO_WATERMARK)).toEqual([
      { seq: 3, text: "third and long", offsetMs: 12_000 },
    ]);
  });
});

describe("deduplication", () => {
  it("keeps a play the first time and drops it the second", () => {
    const first = [play(1, 3), play(4, 6)];
    let watermark = NO_WATERMARK;

    const kept = newPlays(first, watermark);
    expect(kept).toHaveLength(2);
    watermark = advanceWatermark(watermark, kept);
    expect(watermark).toBe(6);

    // The next window overlaps and describes the second play again.
    const second = [play(4, 6, "LANGAN run, eight yards"), play(7, 9)];
    const kept2 = newPlays(second, watermark);
    expect(kept2.map((one) => one.seqEnd)).toEqual([9]);
  });

  // Summaries of the same play from two windows never match. seqEnd does.
  it("does not care that the same play is described differently", () => {
    const watermark = advanceWatermark(NO_WATERMARK, [play(4, 6, "LANGAN 8 yd run")]);
    expect(newPlays([play(3, 6, "Langan around left end for eight, tackled")], watermark)).toEqual([]);
  });

  it("never lets the watermark slip backwards", () => {
    expect(advanceWatermark(20, [play(1, 3)])).toBe(20);
    expect(advanceWatermark(20, [])).toBe(20);
  });

  it("takes the furthest play in a reply, not the last one listed", () => {
    expect(advanceWatermark(NO_WATERMARK, [play(7, 9), play(1, 3)])).toBe(9);
  });
});

describe("a play spanning a window boundary", () => {
  // The case the overlap exists for: the run is called in one window and the
  // tackle lands in the next. It must be read once, and completely.
  it("is captured once, on the window that saw it finish", () => {
    const all = [
      said(0, "first and ten"),
      said(1, "langan takes the handoff"),
      said(2, "around the left end"),
      said(3, "and he is brought down after eight"),
      said(4, "second and two"),
    ];

    // The first call sees the run start but not its outcome, so it returns nothing.
    let watermark = NO_WATERMARK;
    expect(windowFor(all.slice(0, 3), watermark).map((row) => row.seq)).toEqual([0, 1, 2]);
    const nothingYet = newPlays([], watermark);
    watermark = advanceWatermark(watermark, nothingYet);
    expect(watermark).toBe(NO_WATERMARK);

    // The second call still sees the start, because the watermark never moved.
    const second = windowFor(all, watermark);
    expect(second.map((row) => row.seq)).toEqual([0, 1, 2, 3, 4]);
    const found = newPlays([play(1, 3)], watermark);
    expect(found).toHaveLength(1);
    watermark = advanceWatermark(watermark, found);

    // A third call overlapping it again finds nothing new.
    expect(newPlays([play(1, 3)], watermark)).toEqual([]);
  });
});

describe("reading a backlog (M9)", () => {
  const lines = (count: number) => Array.from({ length: count }, (_, seq) => said(seq));
  const ends = (windows: { seq: number }[][]) => windows.map((window) => [window[0]?.seq, window.at(-1)?.seq]);

  it("is exactly windowFor while the lines never sent fit in one window", () => {
    const all = lines(25);
    expect(readingPlan(all, 10, 10, 4)).toEqual({ windows: [windowFor(all, 10)], skipped: 0, skippedThrough: null });
    // A stuck watermark with little new since the last read: still the newest MAX_WINDOW, as before.
    const many = lines(60);
    expect(readingPlan(many, 5, 50, 4)).toEqual({ windows: [windowFor(many, 5)], skipped: 0, skippedThrough: null });
  });

  it("cuts a longer backlog into windows of MAX_WINDOW, oldest first, each reaching WINDOW_OVERLAP into the one before", () => {
    const plan = readingPlan(lines(71), NO_WATERMARK, 0, 4);
    const step = MAX_WINDOW - WINDOW_OVERLAP;
    expect(plan.skipped).toBe(0);
    expect(ends(plan.windows)).toEqual([
      [0, MAX_WINDOW - 1],
      [step, step + MAX_WINDOW - 1],
      [2 * step, 70],
    ]);
    // Every line is in a window.
    expect(new Set(plan.windows.flat().map((row) => row.seq)).size).toBe(71);
  });

  it("starts WINDOW_OVERLAP before the first line never sent, not back at a stuck watermark", () => {
    const plan = readingPlan(lines(100), 5, 40, 4);
    expect(ends(plan.windows)[0][0]).toBe(41 - WINDOW_OVERLAP);
    expect(ends(plan.windows).at(-1)?.[1]).toBe(99);
  });

  it("past the most windows it may read, leaves the oldest lines unread and says how many", () => {
    const plan = readingPlan(lines(200), NO_WATERMARK, NO_WATERMARK, 2);
    expect(plan.windows).toHaveLength(2);
    expect(ends(plan.windows)[1][1]).toBe(199);
    expect(plan.skipped).toBe(200 - linesInWindows(2));
    expect(plan.skippedThrough).toBe(plan.windows[0][0].seq - 1);
  });
});
