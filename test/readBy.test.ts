import { afterEach, describe, expect, it, vi } from "vitest";
import { extractFromRoute } from "@/components/livestats/useLiveStats";
import { StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { readReadBy } from "@/lib/livestats/request";
import { HAIKU_MODEL, liveStatsSetting, LUNA_MODEL, readByOf, readerLine } from "@/lib/livestats/settings";
import { NO_USAGE, type ExtractStatsRequest, type StatsRosterPlayer } from "@/lib/livestats/types";
import type { StatsRecord } from "@/lib/log/statsLog";

// Which model read each live stats reply (Oct 26). Cowboys at Eagles was read
// live on testrun2 by a model the log could not name: its prompts were
// Claude-sized, though testrun2's default had just become GPT-6 Luna. Now the
// route says which model read every reply, and the browser log keeps it.
// Made-up names only.

const LUNA_LOW = { model: LUNA_MODEL, effort: "low" as const };
const HAIKU_LOW = { model: HAIKU_MODEL, effort: "low" as const };
const HAIKU_MEDIUM = { model: HAIKU_MODEL, effort: "medium" as const };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the server says read a reply", () => {
  it("names the one reader's model and effort", () => {
    expect(readByOf(LUNA_LOW)).toEqual({ model: LUNA_MODEL, effort: "low" });
  });

  it("names reader B, and the arbiter only when disagreements go to it", () => {
    expect(readByOf(LUNA_LOW, { b: HAIKU_LOW, arbiter: HAIKU_MEDIUM, rules: { disagree: "arbiter" } })).toEqual({
      model: LUNA_MODEL,
      effort: "low",
      readerB: { model: HAIKU_MODEL, effort: "low" },
      arbiter: { model: HAIKU_MODEL, effort: "medium" },
    });
    expect(readByOf(LUNA_LOW, { b: HAIKU_LOW, arbiter: HAIKU_MEDIUM, rules: { disagree: "a" } })).toEqual({
      model: LUNA_MODEL,
      effort: "low",
      readerB: { model: HAIKU_MODEL, effort: "low" },
    });
  });

  it("says Luna on testrun2 with nothing set, and whatever LIVE_STATS_MODEL says when it is set", () => {
    const testrun2 = { RAILWAY_ENVIRONMENT_NAME: "testrun2" };
    expect(readByOf(liveStatsSetting(testrun2))).toEqual({ model: LUNA_MODEL, effort: "low" });
    // The variable wins over the environment's default, which is what the log now shows.
    expect(readByOf(liveStatsSetting({ ...testrun2, LIVE_STATS_MODEL: HAIKU_MODEL, LIVE_STATS_EFFORT: "low" }))).toEqual({ model: HAIKU_MODEL, effort: "low" });
  });
});

describe("the server log at startup", () => {
  it("names the reader and whether a variable chose it, never a key", () => {
    expect(readerLine({ RAILWAY_ENVIRONMENT_NAME: "testrun2", OPENROUTER_API_KEY: "sk-or-not-real" })).toBe(
      `[Spotter] Live stats (testrun2) reads with ${LUNA_MODEL} at low: nothing is set, so this environment's default.`,
    );
    const set = readerLine({ RAILWAY_ENVIRONMENT_NAME: "testrun2", LIVE_STATS_MODEL: HAIKU_MODEL, LIVE_STATS_READER_B: `${LUNA_MODEL}:low` });
    expect(set).toBe(`[Spotter] Live stats (testrun2) reads with ${HAIKU_MODEL} at low, reader B ${LUNA_MODEL} at low: LIVE_STATS_MODEL or LIVE_STATS_EFFORT is set.`);
    expect(readerLine({})).toContain("(no Railway environment)");
    expect(readerLine({ OPENROUTER_API_KEY: "sk-or-not-real" })).not.toContain("sk-or");
  });
});

describe("what the browser takes from the reply", () => {
  it("keeps a model id and an effort, with reader B and the arbiter", () => {
    const given = { model: LUNA_MODEL, effort: "low", readerB: { model: HAIKU_MODEL, effort: "low" }, arbiter: { model: HAIKU_MODEL, effort: "medium" } };
    expect(readReadBy(given)).toEqual(given);
    expect(readReadBy({ model: LUNA_MODEL, effort: "low", extra: "dropped" })).toEqual({ model: LUNA_MODEL, effort: "low" });
  });

  it("drops the whole thing when any part is not a model id or an effort, so no free text reaches the log", () => {
    expect(readReadBy(undefined)).toBeNull();
    expect(readReadBy("openai/gpt-6-luna")).toBeNull();
    expect(readReadBy({ model: "a model with spaces", effort: "low" })).toBeNull();
    expect(readReadBy({ model: LUNA_MODEL, effort: "very low" })).toBeNull();
    expect(readReadBy({ model: LUNA_MODEL })).toBeNull();
    expect(readReadBy({ model: LUNA_MODEL, effort: "low", readerB: { model: HAIKU_MODEL } })).toBeNull();
    expect(readReadBy({ model: "x".repeat(81), effort: "low" })).toBeNull();
  });

  it("is handed on by the route call, and left out when the server sends none", async () => {
    const request: ExtractStatsRequest = { utterances: [{ seq: 0, text: "first and ten", offsetMs: 0 }], rosters: [], recentPlays: [] };
    const respond = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", respond({ plays: [], usage: {}, readBy: { model: LUNA_MODEL, effort: "low" } }));
    expect(await extractFromRoute(request)).toMatchObject({ ok: true, readBy: { model: LUNA_MODEL, effort: "low" } });
    vi.stubGlobal("fetch", respond({ plays: [], usage: {}, readBy: { model: "<b>", effort: "low" } }));
    expect(await extractFromRoute(request)).not.toHaveProperty("readBy");
    vi.stubGlobal("fetch", respond({ plays: [], usage: {} }));
    expect(await extractFromRoute(request)).not.toHaveProperty("readBy");
  });
});

describe("the browser log", () => {
  const ROSTER: StatsRosterPlayer[] = [{ playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" }];
  const START = 1_800_000_000_000;

  async function firstRead(reply: ExtractReply) {
    let now = START;
    const answers: Array<(reply: ExtractReply) => void> = [];
    const logged: StatsRecord[] = [];
    const controller = new StatsController({
      gameId: "g1",
      startedAt: START,
      roster: ROSTER,
      autoOk: true,
      deps: {
        extract: () => new Promise((resolve) => answers.push(resolve)),
        log: (record) => logged.push(record),
        readLog: async () => [],
        track: () => undefined,
        now: () => now,
      },
    });
    await controller.start();
    now += 1_000;
    // The first thing said is asked about straight away.
    controller.heard("fennimore up the middle for eight", now);
    answers.shift()!(reply);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return logged.filter((record) => record.kind === "stats_reply");
  }

  it("writes which model read it into the read's stats_reply record", async () => {
    const replies = await firstRead({ ok: true, plays: [], usage: NO_USAGE, readBy: { model: LUNA_MODEL, effort: "low" } });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ ok: true, readBy: { model: LUNA_MODEL, effort: "low" } });
  });

  it("writes no readBy when an older server sent none", async () => {
    const replies = await firstRead({ ok: true, plays: [], usage: NO_USAGE });
    expect(replies[0]).not.toHaveProperty("readBy");
  });
});
