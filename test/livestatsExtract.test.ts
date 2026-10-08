import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { applyPlay } from "@/lib/livestats/apply";
import { costOf, formatCost, gameTokens, sumUsage, usageFrom } from "@/lib/livestats/cost";
import { extractStatsPlays, MAX_EVIDENCE_WORDS, STATS_MODEL, validatePlays, volatileContent } from "@/lib/livestats/extract";
import { readRequest } from "@/lib/livestats/request";
import { statsRoster } from "@/lib/livestats/roster";
import type { ExtractStatsRequest } from "@/lib/livestats/types";
import { ExtractionError } from "@/lib/rosters/extractWithClaude";

// =============================================================================
// The Claude call and everything that decides whether its answer is trusted.
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

/** A play the way Claude would send it, every field present. */
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

/** A client whose messages.create answers with the given reply. */
function fakeClient(answer: () => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const create = vi.fn(async (params: Record<string, unknown>) => {
    calls.push(params);
    const response = answer();
    if (response instanceof Error) throw response;
    return response;
  });
  return { client: { messages: { create } } as unknown as Anthropic, calls };
}

function message(text: string, stopReason = "end_turn") {
  return {
    stop_reason: stopReason,
    usage: { input_tokens: 400, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 2500 },
    content: [{ type: "text", text }],
  };
}

const SIGNAL = new AbortController().signal;

describe("extractStatsPlays", () => {
  it("asks Sonnet 5 with thinking off, the rosters cached, and the schema as the answer's shape", async () => {
    const { client, calls } = fakeClient(() => message(JSON.stringify({ plays: [reply()] })));
    const result = await extractStatsPlays(client, REQUEST, SIGNAL);
    expect(result.plays).toHaveLength(1);

    const params = calls[0] as {
      model: string;
      thinking: unknown;
      system: Array<{ text: string; cache_control?: unknown }>;
      messages: Array<{ content: string }>;
      output_config: { format: { type: string } };
    };
    expect(params.model).toBe(STATS_MODEL);
    expect(STATS_MODEL).toBe("claude-sonnet-5");
    expect(params.thinking).toEqual({ type: "disabled" });
    expect(params.system).toHaveLength(2);
    expect(params.system[0].cache_control).toBeUndefined();
    expect(params.system[1].cache_control).toEqual({ type: "ephemeral" });
    expect(params.system[1].text).toContain("\nH22-LANGAN Sam RB");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.messages[0].content).toBe(volatileContent(REQUEST));
  });

  it("returns the call's token usage with its cost", async () => {
    const { client } = fakeClient(() => message(JSON.stringify({ plays: [] })));
    const { usage } = await extractStatsPlays(client, REQUEST, SIGNAL);
    expect(usage).toMatchObject({ inputTokens: 400, outputTokens: 300, cacheReadTokens: 2500 });
    expect(usage.costUsd).toBeCloseTo((400 * 2 + 300 * 10 + 2500 * 0.2) / 1e6, 9);
  });

  it("makes no call for an empty window", async () => {
    const { client, calls } = fakeClient(() => message("{}"));
    const result = await extractStatsPlays(client, { ...REQUEST, utterances: [] }, SIGNAL);
    expect(result.plays).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("throws claude_refused on a refusal", async () => {
    const { client } = fakeClient(() => message("", "refusal"));
    await expect(extractStatsPlays(client, REQUEST, SIGNAL)).rejects.toMatchObject({ code: "claude_refused" });
  });

  it("returns no plays, not an error, for a truncated answer or one that is not JSON", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const bad of [message('{"plays": [', "max_tokens"), message("not json"), { stop_reason: "end_turn", usage: {}, content: [] }]) {
        const { client } = fakeClient(() => bad);
        expect((await extractStatsPlays(client, REQUEST, SIGNAL)).plays).toEqual([]);
      }
      // Nothing from the reply reaches the log: it quotes the transcript.
      for (const call of quiet.mock.calls) expect(String(call[0])).not.toMatch(/langan|keslow|not json/i);
    } finally {
      quiet.mockRestore();
    }
  });

  it("turns an SDK failure into one of Spotter's codes", async () => {
    const { client } = fakeClient(() => new Error("socket hang up"));
    await expect(extractStatsPlays(client, REQUEST, SIGNAL)).rejects.toBeInstanceOf(ExtractionError);
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
    const usage = usageFrom({ input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 });
    expect(usage.costUsd).toBe(2 + 10 + 2.5 + 0.2);
    expect(costOf({ ...usage, costUsd: 0 })).toBe(usage.costUsd);
  });

  it("counts missing or bad numbers as zero, and adds up a game", () => {
    const one = usageFrom({ input_tokens: -5, output_tokens: null, cache_read_input_tokens: 100 });
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
