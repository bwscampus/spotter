import { describe, expect, it } from "vitest";
import { arbitrateOpenRouter, extractTwoReaders } from "@/lib/livestats/openrouter";
import { ARBITER_SYSTEM_PROMPT } from "@/lib/livestats/prompt";
import { recordedReplies } from "@/lib/livestats/recorded";
import { arbiterSetting, DEFAULT_LIVE_STATS_SETTING, parseSetting, readerBSetting } from "@/lib/livestats/settings";
import { readPlays, EMPTY_SESSION } from "@/lib/livestats/session";
import { ARBITER_FREE_CALLS, arbiterAsk, decideTwoReaders, mergeReaders, pickOf, type ArbiterAnswer, type ArbiterAsk, type TwoReaderDetail } from "@/lib/livestats/twoReaders";
import { NO_PENALTY, NO_USAGE, type Action, type ExtractStatsRequest, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import type { RecordedCall } from "@/lib/livestats/playsJson";
import { chatReply, fakeFetch } from "./fakeOpenRouter";

// =============================================================================
// Two readers and an arbiter (Oct 26, the second v6 push, Part B). Made-up
// names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-ALDERWICK", side: "home", jersey: "7", first: "Tam", last: "Alderwick", position: "QB" },
  { playerId: "H22-WEXCOMBE", side: "home", jersey: "22", first: "Bram", last: "Wexcombe", position: "RB" },
  { playerId: "H30-VENRO", side: "home", jersey: "30", first: "Ike", last: "Venro", position: "RB" },
  { playerId: "H81-HARLOW", side: "home", jersey: "81", first: "Joss", last: "Harlow", position: "WR" },
  { playerId: "A5-MARDEN", side: "away", jersey: "5", first: "Cy", last: "Marden", position: "LB" },
  { playerId: "A9-PAK", side: "away", jersey: "9", first: "Lou", last: "Pak", position: "DB" },
];
const REQUEST: ExtractStatsRequest = {
  utterances: [
    { seq: 10, text: "first and ten", offsetMs: 0 },
    { seq: 11, text: "wexcombe takes the handoff", offsetMs: 1_000 },
    { seq: 12, text: "and he is brought down by marden for 4", offsetMs: 2_000 },
  ],
  rosters: ROSTER,
  recentPlays: [],
};

function ev(playerId: string, action: Action, yards: number | null = null, stated = yards !== null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : stated ? "stated" : "phrase", made: null };
}
function play(events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return { seqStart: 11, seqEnd: 12, quarter: 1, clock: null, down: 1, distance: 10, offense: "home", playType: "run", nullified: false, touchdown: false, firstDown: false, confidence: 0.8, summary: "run", evidence: "", events, updates: "", startSpot: null, endSpot: null, shortBy: null, penalty: NO_PENALTY, ...extra };
}
const RUN = play([ev("H22-WEXCOMBE", "rush", 4, false)]);
const RUN_WITH_TACKLE = play([ev("H22-WEXCOMBE", "rush", 4), ev("A5-MARDEN", "tackle")]);
const PASS_TO_HARLOW = play([ev("H7-ALDERWICK", "pass_complete", 6), ev("H81-HARLOW", "reception", 6), ev("A5-MARDEN", "tackle")], { playType: "pass" });
const PASS_TO_VENRO = play([ev("H7-ALDERWICK", "pass_complete", 6), ev("H30-VENRO", "reception", 6), ev("A5-MARDEN", "tackle")], { playType: "pass" });
const reading = (...plays: StatsPlay[]) => ({ plays, statLines: [] });

/** An arbiter that answers `pick` and records what it was asked. */
function arbiter(pick: ArbiterAnswer["pick"]) {
  const asked: ArbiterAsk[] = [];
  return { asked, arbitrate: async (ask: ArbiterAsk): Promise<ArbiterAnswer> => (asked.push(ask), { pick, usage: { ...NO_USAGE, costUsd: 0.001 } }) };
}

describe("merging two readings", () => {
  it("takes a play both read alike, with every tackler either credited and the yards one of them said", async () => {
    const judge = arbiter("a");
    const merged = await mergeReaders(REQUEST, reading(RUN), reading(RUN_WITH_TACKLE), judge.arbitrate);
    expect(judge.asked).toHaveLength(0);
    expect(merged.plays).toHaveLength(1);
    expect(merged.plays[0].readers).toBe("agreed");
    expect(merged.plays[0].events).toEqual([ev("H22-WEXCOMBE", "rush", 4, true), ev("A5-MARDEN", "tackle")]);
    expect(merged.arbiterUse).toEqual({ plays: 1, arbitrated: 0 });
  });

  it("takes a play only one reader read, unless it is unsure, when the arbiter decides", async () => {
    const judge = arbiter("neither");
    expect((await mergeReaders(REQUEST, reading(RUN), reading(), judge.arbitrate)).plays.map((each) => each.readers)).toEqual(["only_a"]);
    expect((await mergeReaders(REQUEST, reading(), reading(RUN), judge.arbitrate)).plays.map((each) => each.readers)).toEqual(["only_b"]);
    // A reader that typed the play "other" with nobody credited has not read it.
    expect((await mergeReaders(REQUEST, reading(play([], { playType: "other" })), reading(RUN), judge.arbitrate)).plays.map((each) => each.readers)).toEqual(["only_b"]);
    expect(judge.asked).toHaveLength(0);
    const unsure = await mergeReaders(REQUEST, reading({ ...RUN, confidence: 0.3 }), reading(), judge.arbitrate);
    expect(judge.asked).toHaveLength(1);
    expect(unsure.plays).toEqual([]);
  });

  it("asks the arbiter when they disagree, and does what it picks", async () => {
    const pick = async (answer: ArbiterAnswer["pick"]) => (await mergeReaders(REQUEST, reading(PASS_TO_HARLOW), reading(PASS_TO_VENRO), arbiter(answer).arbitrate)).plays;
    expect((await pick("a")).map((each) => [each.readers, each.events.find((event) => event.action === "reception")?.playerId])).toEqual([["arbiter_a", "H81-HARLOW"]]);
    expect((await pick("b")).map((each) => [each.readers, each.events.find((event) => event.action === "reception")?.playerId])).toEqual([["arbiter_b", "H30-VENRO"]]);
    // The parts both share: the pass and the tackle, and no catcher.
    const [parts] = await pick("parts");
    expect(parts.readers).toBe("arbiter_parts");
    expect(parts.events.map((event) => `${event.action} ${event.playerId}`)).toEqual(["pass_complete H7-ALDERWICK", "tackle A5-MARDEN"]);
    expect(await pick("neither")).toEqual([]);
    // A failed arbiter call leaves reader A standing.
    expect((await pick(null)).map((each) => each.readers)).toEqual(["arbiter_failed_a"]);
  });

  it("never credits a player neither reader credited", async () => {
    for (const answer of ["a", "b", "parts"] as const) {
      const plays = (await mergeReaders(REQUEST, reading(PASS_TO_HARLOW), reading(PASS_TO_VENRO), arbiter(answer).arbitrate)).plays;
      const credited = new Set([...PASS_TO_HARLOW.events, ...PASS_TO_VENRO.events].map((event) => event.playerId));
      for (const each of plays) for (const event of each.events) expect(credited.has(event.playerId)).toBe(true);
    }
  });

  it("sends at most 40% of a game's plays to the arbiter, after its first few, and takes reader A past that", async () => {
    const judge = arbiter("b");
    const busy = await mergeReaders({ ...REQUEST, arbiterUse: { plays: 10, arbitrated: 4 } }, reading(PASS_TO_HARLOW), reading(PASS_TO_VENRO), judge.arbitrate);
    expect(judge.asked).toHaveLength(0);
    expect(busy.plays.map((each) => each.readers)).toEqual(["budget_a"]);
    // The first plays of a game may always be decided.
    const early = await mergeReaders({ ...REQUEST, arbiterUse: { plays: 0, arbitrated: ARBITER_FREE_CALLS - 1 } }, reading(PASS_TO_HARLOW), reading(PASS_TO_VENRO), judge.arbitrate);
    expect(early.plays.map((each) => each.readers)).toEqual(["arbiter_b"]);
    expect(early.arbiterUse).toEqual({ plays: 1, arbitrated: 1 });
  });

  it("lets the other reader stand when one fails", async () => {
    const detail = (aOk: boolean, bOk: boolean): Pick<TwoReaderDetail, "a" | "b"> => ({
      a: aOk ? { ok: true, plays: [PASS_TO_HARLOW], statLines: [], retries: 0 } : { ok: false, code: "claude_timeout", retries: 3 },
      b: bOk ? { ok: true, plays: [PASS_TO_VENRO], statLines: [], retries: 0 } : { ok: false, code: "claude_unreachable", retries: 3 },
    });
    const judge = arbiter("b");
    expect((await decideTwoReaders(REQUEST, detail(true, false), judge.arbitrate)).plays.map((each) => each.readers)).toEqual(["only_a"]);
    expect((await decideTwoReaders(REQUEST, detail(false, true), judge.arbitrate)).plays.map((each) => each.readers)).toEqual(["only_b"]);
    expect(judge.asked).toHaveLength(0);
  });
});

describe("the arbiter", () => {
  it("is shown the two readings as Reading 1 and 2, in an order fixed by the play, with no model named", () => {
    const ask = arbiterAsk(REQUEST, PASS_TO_HARLOW, PASS_TO_VENRO);
    expect(arbiterAsk(REQUEST, PASS_TO_HARLOW, PASS_TO_VENRO)).toEqual(ask);
    expect(ask.content).toContain("Reading 1:");
    expect(ask.content).toContain("Reading 2:");
    expect(ask.content).toContain("11\twexcombe takes the handoff");
    expect(ask.content).not.toMatch(/haiku|luna|gemini|claude|gpt|reader a|reader b/i);
    expect(pickOf("1", ask.first)).toBe(ask.first);
    expect(pickOf("2", "a")).toBe("b");
    expect(pickOf("both_agree_parts", "b")).toBe("parts");
    expect(pickOf("neither", "a")).toBe("neither");
  });

  it("has a prompt under 250 words with three made-up worked examples", () => {
    expect(ARBITER_SYSTEM_PROMPT.split(/\s+/).filter(Boolean).length).toBeLessThan(250);
    expect(ARBITER_SYSTEM_PROMPT.match(/pick: "/g)).toHaveLength(3);
  });

  it("goes through OpenRouter on the zero-retention route with no temperature, and its pick comes back as a reader", async () => {
    const sent: Array<Record<string, unknown>> = [];
    const fetcher = fakeFetch<Record<string, unknown>>((body) => (sent.push(body), chatReply({ pick: "2" })));
    const ask = arbiterAsk(REQUEST, PASS_TO_HARLOW, PASS_TO_VENRO);
    const answer = await arbitrateOpenRouter("test-key", ask, ROSTER, arbiterSetting({}), { fetcher });
    expect(answer.pick).toBe(ask.first === "a" ? "b" : "a");
    expect(sent[0].provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true });
    expect(sent[0]).not.toHaveProperty("temperature");
    expect(sent[0].model).toBe("anthropic/claude-haiku-5.5");
  });
});

describe("two readers over the wire", () => {
  it("asks both readers, then the arbiter where they disagree, and keeps every reply for the record", async () => {
    const asked: string[] = [];
    const fetcher = fakeFetch<{ model: string; messages: Array<{ content: unknown }> }>((body) => {
      const system = JSON.stringify(body.messages[0].content);
      if (system.includes("Two readers read the same lines")) return (asked.push("arbiter"), chatReply({ pick: "1" }));
      asked.push(body.model);
      return chatReply({ plays: [body.model.includes("luna") ? PASS_TO_VENRO : PASS_TO_HARLOW], statLines: [] });
    });
    const luna = parseSetting("openai/gpt-6-luna", "low")!;
    const reply = await extractTwoReaders("test-key", { ...REQUEST, utterances: [...REQUEST.utterances, { seq: 13, text: "alderwick throws", offsetMs: 3_000 }] }, { a: DEFAULT_LIVE_STATS_SETTING, b: luna, arbiter: arbiterSetting({}) }, { fetcher });
    expect(asked.filter((each) => each !== "arbiter")).toHaveLength(2);
    expect(asked).toContain("arbiter");
    expect(reply.plays).toHaveLength(1);
    expect(reply.readers.a.plays).toHaveLength(1);
    expect(reply.readers.b.plays).toHaveLength(1);
    expect(reply.readers.arbiter).toHaveLength(1);
    expect(reply.arbiterUse).toEqual({ plays: 1, arbitrated: 1 });
  });
});

describe("reader B off", () => {
  it("is the default, and one reader's plays carry no two-reader note", () => {
    expect(readerBSetting({})).toBeNull();
    expect(readerBSetting({ LIVE_STATS_READER_B: "off" })).toBeNull();
    expect(readerBSetting({ LIVE_STATS_READER_B: "openai/gpt-6-luna:low" })).toEqual({ model: "openai/gpt-6-luna", effort: "low" });
    const single = readPlays(EMPTY_SESSION, [RUN], ROSTER, 1_000, { utterances: REQUEST.utterances, readThrough: 12 });
    expect(single.added[0].play.readers).toBeUndefined();
    expect(single.added[0].dropped.some((note) => note.rule === "R53")).toBe(false);
    const two = readPlays(EMPTY_SESSION, [{ ...RUN, readers: "agreed" }], ROSTER, 1_000, { utterances: REQUEST.utterances, readThrough: 12 });
    expect(two.added[0].dropped).toContainEqual(expect.objectContaining({ rule: "R53", kind: "noted", reason: "two readers: agreed" }));
  });
});

describe("a recorded two-reader run, decided again for free", () => {
  const call = (arbiterPicks: TwoReaderDetail["arbiter"]): RecordedCall => ({
    index: 1, done: 1, look: "first", seqFrom: 10, seqTo: 12, seqs: [10, 11, 12], askedAtMs: 0, tookMs: 100, returnAfterMs: 100, ok: true, plays: [], statLines: [], usage: NO_USAGE,
    readers: { a: { ok: true, plays: [PASS_TO_HARLOW], statLines: [], usage: NO_USAGE, retries: 0 }, b: { ok: true, plays: [PASS_TO_VENRO], statLines: [], usage: NO_USAGE, retries: 0 }, arbiter: arbiterPicks, models: { a: "a", b: "b", arbiter: "arb" } },
  });
  it("answers the arbiter from the record, counts a decision it never made, and with B off is reader A alone", async () => {
    const key = arbiterAsk(REQUEST, PASS_TO_HARLOW, PASS_TO_VENRO).key;
    const decided = recordedReplies([call([{ key, pick: "b" }])]);
    const reply = await decided.extract(REQUEST, DEFAULT_LIVE_STATS_SETTING);
    expect(reply.plays.map((each) => each.readers)).toEqual(["arbiter_b"]);
    expect(decided.misses().arbiter).toBe(0);
    const unrecorded = recordedReplies([call([])]);
    expect((await unrecorded.extract(REQUEST, DEFAULT_LIVE_STATS_SETTING)).plays.map((each) => each.readers)).toEqual(["arbiter_failed_a"]);
    expect(unrecorded.misses().arbiter).toBe(1);
    const alone = recordedReplies([call([{ key, pick: "b" }])], undefined, { readerB: false });
    const single = await alone.extract(REQUEST, DEFAULT_LIVE_STATS_SETTING);
    expect(single.plays).toEqual([PASS_TO_HARLOW]);
  });
});
