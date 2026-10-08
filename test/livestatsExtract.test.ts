import { describe, expect, it } from "vitest";
import { applyPlay } from "@/lib/livestats/apply";
import { costOf, formatCost, gameTokens, OPENROUTER_RATES, sumUsage, usageFromOpenRouter } from "@/lib/livestats/cost";
import { MAX_EVIDENCE_WORDS, validatePlays, volatileContent } from "@/lib/livestats/extract";
import { readRequest } from "@/lib/livestats/request";
import { statsRoster } from "@/lib/livestats/roster";
import type { ExtractStatsRequest } from "@/lib/livestats/types";

// =============================================================================
// The live stats call and everything that decides whether its answer is trusted.
// No network: the client is a fake that answers with whatever the test says.
// =============================================================================

const ROSTER = statsRoster(
  [{ jersey: "22", first_name: "Sam", last_name: "Langan", position: "RB" }],
  [{ jersey: "44", first_name: "Abe", last_name: "Keslow", position: "LB" }],
);

const REQUEST: ExtractStatsRequest = {
  utterances: [
    { seq: 10, text: "first and ten", offsetMs: 60_000 },
    { seq: 11, text: "langan picks up 8 brought down by keslow", offsetMs: 64_000 },
    { seq: 12, text: "second and two", offsetMs: 70_000 },
  ],
  rosters: ROSTER,
  recentPlays: [{ playId: "3-4", summary: "LANGAN 4 yd run" }],
};

/** A play the way the model would send it, every field present. */
function reply(overrides: Record<string, unknown> = {}) {
  return {
    seqStart: 10,
    seqEnd: 11,
    quarter: 2,
    clock: "4 12",
    down: 1,
    distance: 10,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.85,
    summary: "LANGAN 8 yd run, brought down by KESLOW",
    evidence: "langan picks up 8 brought down by keslow",
    events: [
      { playerId: "H22-LANGAN", action: "rush", yards: 8, yardsSource: "stated", made: null },
      { playerId: "A44-KESLOW", action: "tackle", yards: null, yardsSource: null, made: null },
    ],
    ...overrides,
  };
}

describe("validatePlays", () => {
  it("passes a well-formed play through", () => {
    const [play] = validatePlays({ plays: [reply()] }, REQUEST);
    expect(play).toMatchObject({ seqStart: 10, seqEnd: 11, playType: "run", offense: "home", confidence: 0.85 });
    expect(play.events).toHaveLength(2);
  });

  it("returns nothing for junk, without throwing", () => {
    for (const junk of [null, "plays", 42, [], { plays: "no" }, { nope: [] }]) {
      expect(validatePlays(junk, REQUEST)).toEqual([]);
    }
  });

  it("drops a play whose seqEnd is missing or outside the window", () => {
    expect(validatePlays({ plays: [reply({ seqEnd: null })] }, REQUEST)).toEqual([]);
    expect(validatePlays({ plays: [reply({ seqEnd: 9 })] }, REQUEST)).toEqual([]);
    expect(validatePlays({ plays: [reply({ seqEnd: 13 })] }, REQUEST)).toEqual([]);
  });

  it("clamps seqStart into the window and never past seqEnd", () => {
    expect(validatePlays({ plays: [reply({ seqStart: 2 })] }, REQUEST)[0].seqStart).toBe(10);
    expect(validatePlays({ plays: [reply({ seqStart: 12 })] }, REQUEST)[0].seqStart).toBe(11);
  });

  it("drops a play with no summary", () => {
    expect(validatePlays({ plays: [reply({ summary: "   " })] }, REQUEST)).toEqual([]);
  });

  it("keeps quarter, down and distance only in range", () => {
    const [play] = validatePlays({ plays: [reply({ quarter: 9, down: 5, distance: -1, clock: 12 })] }, REQUEST);
    expect(play).toMatchObject({ quarter: null, down: null, distance: null, clock: null });
  });

  it("turns an unknown play type into other and a bad offense into null", () => {
    const [play] = validatePlays({ plays: [reply({ playType: "trick_play", offense: "visitors" })] }, REQUEST);
    expect(play.playType).toBe("other");
    expect(play.offense).toBeNull();
  });

  it("clamps confidence, and a non-number is 0", () => {
    expect(validatePlays({ plays: [reply({ confidence: 3 })] }, REQUEST)[0].confidence).toBe(1);
    expect(validatePlays({ plays: [reply({ confidence: "high" })] }, REQUEST)[0].confidence).toBe(0);
  });

  it("only true is true", () => {
    const [play] = validatePlays({ plays: [reply({ nullified: "yes", touchdown: 1, firstDown: true })] }, REQUEST);
    expect(play).toMatchObject({ nullified: false, touchdown: false, firstDown: true });
  });

  it("cuts the evidence to 20 words", () => {
    const long = Array.from({ length: 30 }, (_, index) => `w${index}`).join("  ");
    const [play] = validatePlays({ plays: [reply({ evidence: long })] }, REQUEST);
    expect(play.evidence.split(" ")).toHaveLength(MAX_EVIDENCE_WORDS);
    expect(play.evidence.startsWith("w0 w1 w2")).toBe(true);
  });

  it("drops an event with an unknown action, and keeps the others", () => {
    const [play] = validatePlays(
      { plays: [reply({ events: [{ playerId: "H22-LANGAN", action: "juke", yards: 3, yardsSource: "stated", made: null }, reply().events[1]] })] },
      REQUEST,
    );
    expect(play.events.map((event) => event.action)).toEqual(["tackle"]);
  });

  it("keeps yards and their source together, or neither", () => {
    const events = [
      { playerId: "H22-LANGAN", action: "rush", yards: 8, yardsSource: null, made: null },
      { playerId: "A44-KESLOW", action: "interception", yards: null, yardsSource: "phrase", made: null },
      { playerId: "A44-KESLOW", action: "fumble_recovery", yards: 400, yardsSource: "stated", made: null },
      { playerId: "H22-LANGAN", action: "kick_return", yards: 7.6, yardsSource: "spots", made: null },
    ];
    const [play] = validatePlays({ plays: [reply({ events })] }, REQUEST);
    expect(play.events.map((event) => [event.yards, event.yardsSource])).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [8, "spots"],
    ]);
  });

  it("keeps made only on field goals and extra points", () => {
    const events = [
      { playerId: "H22-LANGAN", action: "field_goal", yards: 30, yardsSource: "stated", made: true },
      { playerId: "H22-LANGAN", action: "rush", yards: 1, yardsSource: "stated", made: true },
    ];
    const [play] = validatePlays({ plays: [reply({ events })] }, REQUEST);
    expect(play.events.map((event) => event.made)).toEqual([true, null]);
  });

  it("counts a player's action once", () => {
    const tackle = reply().events[1];
    const [play] = validatePlays({ plays: [reply({ events: [tackle, tackle] })] }, REQUEST);
    expect(play.events).toHaveLength(1);
  });

  it("an unknown playerId loses its event to R9, and the rest of the play still counts", () => {
    // Validation keeps the id so the rule that drops it can be named in the log.
    const events = [...reply().events, { playerId: "A12-SOMEONE", action: "tackle", yards: null, yardsSource: null, made: null }];
    const [play] = validatePlays({ plays: [reply({ events })] }, REQUEST);
    const applied = applyPlay(play, ROSTER);
    expect(applied.dropped.map((drop) => [drop.rule, drop.event.playerId])).toEqual([["R9", "A12-SOMEONE"]]);
    expect(applied.deltas.map((delta) => delta.playerId)).toEqual(["H22-LANGAN", "A44-KESLOW"]);
  });
});

describe("volatileContent", () => {
  it("lists the applied plays, then the window with seq and the words", () => {
    const text = volatileContent(REQUEST);
    expect(text).toContain("PLAYS ALREADY APPLIED\nEach line is an id, then the play.");
    expect(text).toContain("return it with updates set to its id.\n- 3-4  LANGAN 4 yd run");
    expect(volatileContent({ ...REQUEST, recentPlays: [{ playId: "", summary: "LANGAN 4 yd run" }] })).toContain("\n- LANGAN 4 yd run");
    expect(text).toContain("11\tlangan picks up 8 brought down by keslow");
    expect(text).not.toMatch(/\d+s\t/);
    expect(volatileContent({ ...REQUEST, recentPlays: [] })).toContain("PLAYS ALREADY APPLIED\nNone yet.");
  });
});

describe("readRequest, what the route accepts", () => {
  const body = {
    utterances: REQUEST.utterances,
    rosters: ROSTER,
    recentPlays: ["a", { playId: "1-2", summary: "b" }, "c", "d", "e", { playId: "9-9", summary: "f" }, "  ", { playId: "x" }],
  };

  it("takes the window, both rosters and the last five applied plays", () => {
    const parsed = readRequest(body);
    expect(parsed).not.toBeNull();
    expect(parsed).not.toBe("too_long");
    if (!parsed || parsed === "too_long") return;
    expect(parsed.rosters).toEqual(ROSTER);
    expect(parsed.recentPlays).toEqual([
      { playId: "1-2", summary: "b" },
      { playId: "", summary: "c" },
      { playId: "", summary: "d" },
      { playId: "", summary: "e" },
      { playId: "9-9", summary: "f" },
    ]);
  });

  it("refuses anything that is not that shape", () => {
    expect(readRequest(null)).toBeNull();
    expect(readRequest({ utterances: [] })).toBeNull();
    expect(readRequest({ ...body, rosters: [{ playerId: "H1-X", side: "left", last: "X" }] })).toBeNull();
    expect(readRequest({ ...body, utterances: [{ seq: "1", text: "hi" }] })).toBeNull();
  });

  it("says too_long for a window past the cap", () => {
    const utterances = Array.from({ length: 31 }, (_, seq) => ({ seq, text: "x", offsetMs: 0 }));
    expect(readRequest({ ...body, utterances })).toBe("too_long");
  });
});

describe("cost", () => {
  it("charges each kind of token at its own rate", () => {
    const usage = usageFromOpenRouter({
      prompt_tokens: 3_000_000,
      completion_tokens: 1_000_000,
      prompt_tokens_details: { cached_tokens: 1_000_000, cache_write_tokens: 1_000_000 },
    });
    const rates = OPENROUTER_RATES;
    expect(usage.costUsd).toBeCloseTo(rates.input + rates.output + rates.cacheWrite + rates.cacheRead, 9);
    expect(costOf({ ...usage, costUsd: 0 })).toBe(usage.costUsd);
  });

  it("counts missing or bad numbers as zero, and adds up a game", () => {
    const one = usageFromOpenRouter({ prompt_tokens: 100, completion_tokens: -5, prompt_tokens_details: { cached_tokens: 100 } });
    expect(one).toMatchObject({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 100 });
    const total = sumUsage([one, one]);
    expect(total.cacheReadTokens).toBe(200);
    expect(gameTokens({ ...total, inputTokens: 10, cacheWriteTokens: 5, outputTokens: 7 })).toEqual({
      tokens_in: 215,
      tokens_out: 7,
      tokens_cached: 200,
    });
  });

  it("never shows a real cost as nothing", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.004)).toBe("under $0.01");
    expect(formatCost(2.456)).toBe("$2.46");
  });
});
