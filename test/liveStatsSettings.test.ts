import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_STATS_MODEL } from "@/lib/ai/openrouter";
import { OPENROUTER_RATES, usageFromOpenRouter } from "@/lib/livestats/cost";
import { openRouterBody } from "@/lib/livestats/openrouter";
import { parseReplayArgs, ReplayArgsError } from "@/lib/livestats/replayArgs";
import {
  allSettings,
  DEFAULT_LIVE_STATS_SETTING,
  GEMINI_FLASH_MODEL,
  HAIKU_MODEL,
  liveStatsSetting,
  LUNA_MODEL,
  parseSetting,
  ratesFor,
  TESTRUN_LIVE_STATS_SETTING,
} from "@/lib/livestats/settings";
import type { ExtractStatsRequest } from "@/lib/livestats/types";

// =============================================================================
// The live stats model and effort as server settings (lib/livestats/settings.ts),
// and the replay harness's flags (lib/livestats/replayArgs.ts).
// =============================================================================

const REQUEST: ExtractStatsRequest = {
  utterances: [{ seq: 0, text: "first and ten", offsetMs: 0 }],
  rosters: [{ playerId: "H22-LANGAN", side: "home", jersey: "22", first: "Sam", last: "Langan", position: "RB" }],
  recentPlays: [],
};

afterEach(() => vi.restoreAllMocks());

describe("the live stats setting", () => {
  it("defaults to Gemini 3.8 Flash at minimal", () => {
    expect(DEFAULT_LIVE_STATS_SETTING).toEqual({ model: "google/gemini-3.8-flash", effort: "minimal" });
    expect(DEFAULT_LIVE_STATS_SETTING.model).toBe(LIVE_STATS_MODEL);
    expect(GEMINI_FLASH_MODEL).toBe(LIVE_STATS_MODEL);
    expect(liveStatsSetting({})).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(liveStatsSetting({ LIVE_STATS_MODEL: "", LIVE_STATS_EFFORT: " " })).toEqual(DEFAULT_LIVE_STATS_SETTING);
  });

  it("takes an allowed model and effort from the environment", () => {
    expect(liveStatsSetting({ LIVE_STATS_MODEL: HAIKU_MODEL })).toEqual({ model: HAIKU_MODEL, effort: "low" });
    expect(liveStatsSetting({ LIVE_STATS_MODEL: "claude-haiku-5.5", LIVE_STATS_EFFORT: "medium" })).toEqual({ model: HAIKU_MODEL, effort: "medium" });
    expect(liveStatsSetting({ LIVE_STATS_EFFORT: "minimal" })).toEqual({ model: GEMINI_FLASH_MODEL, effort: "minimal" });
    expect(liveStatsSetting({ LIVE_STATS_MODEL: "gemini-3.8-flash", LIVE_STATS_EFFORT: "minimal" })).toEqual({ model: GEMINI_FLASH_MODEL, effort: "minimal" });
  });

  it("reads with GPT-6 Luna at low on testrun2 when nothing is set, and only there (Oct 26)", () => {
    expect(TESTRUN_LIVE_STATS_SETTING).toEqual({ model: LUNA_MODEL, effort: "low" });
    expect(liveStatsSetting({ RAILWAY_ENVIRONMENT_NAME: "testrun2" })).toEqual(TESTRUN_LIVE_STATS_SETTING);
    // Production and a run with no Railway environment keep Gemini: /privacy names Gemini.
    expect(liveStatsSetting({ RAILWAY_ENVIRONMENT_NAME: "production" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(liveStatsSetting({ RAILWAY_ENVIRONMENT_NAME: "" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    // A setting that is set still wins on testrun2, and one off the list falls back to testrun2's own default.
    expect(liveStatsSetting({ RAILWAY_ENVIRONMENT_NAME: "testrun2", LIVE_STATS_MODEL: HAIKU_MODEL })).toEqual({ model: HAIKU_MODEL, effort: "low" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(liveStatsSetting({ RAILWAY_ENVIRONMENT_NAME: "testrun2", LIVE_STATS_MODEL: "openai/gpt-8" })).toEqual(TESTRUN_LIVE_STATS_SETTING);
  });

  it("gives an effort set alone to the environment's own model, never production's Gemini on testrun2 (Oct 26)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Luna takes low and none; minimal is Gemini's only effort, so it is off the list here and falls back.
    expect(liveStatsSetting({ RAILWAY_ENVIRONMENT_NAME: "testrun2", LIVE_STATS_EFFORT: "none" })).toEqual({ model: LUNA_MODEL, effort: "none" });
    expect(liveStatsSetting({ RAILWAY_ENVIRONMENT_NAME: "testrun2", LIVE_STATS_EFFORT: "minimal" })).toEqual(TESTRUN_LIVE_STATS_SETTING);
    // Production is unchanged: an effort alone is Gemini's.
    expect(liveStatsSetting({ RAILWAY_ENVIRONMENT_NAME: "production", LIVE_STATS_EFFORT: "minimal" })).toEqual({ model: GEMINI_FLASH_MODEL, effort: "minimal" });
  });

  it("falls back to the default on anything off the list, and says so once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(liveStatsSetting({ LIVE_STATS_MODEL: "openai/gpt-9" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(liveStatsSetting({ LIVE_STATS_MODEL: "openai/gpt-9" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(liveStatsSetting({ LIVE_STATS_EFFORT: "high" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(liveStatsSetting({ LIVE_STATS_EFFORT: "low" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("allows exactly Gemini at minimal and Haiku at low or medium", () => {
    expect(allSettings()).toEqual([
      { model: GEMINI_FLASH_MODEL, effort: "minimal" },
      { model: HAIKU_MODEL, effort: "low" },
      { model: HAIKU_MODEL, effort: "medium" },
    ]);
    expect(parseSetting(HAIKU_MODEL, "minimal")).toBeNull();
    expect(parseSetting("anthropic/claude-sonnet-5", "low")).toBeNull();
  });

  it("prices a reply with no cost at the model's own rates", () => {
    expect(ratesFor(GEMINI_FLASH_MODEL)).toBe(OPENROUTER_RATES);
    expect(OPENROUTER_RATES).toEqual({ input: 0.75, output: 3.75, cacheWrite: 0, cacheRead: 0.075 });
    expect(ratesFor(HAIKU_MODEL)).toEqual({ input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 });
    const million = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };
    expect(usageFromOpenRouter(million).costUsd).toBeCloseTo(4.5, 5);
    expect(usageFromOpenRouter(million, ratesFor(HAIKU_MODEL)).costUsd).toBeCloseTo(0.6, 5);
  });

  it("sends the setting's model and effort, with the same privacy routing for every model", () => {
    for (const setting of allSettings()) {
      const body = openRouterBody(REQUEST, setting);
      expect(body.model).toBe(setting.model);
      expect(body.reasoning).toEqual({ effort: setting.effort });
      expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true });
    }
    expect(openRouterBody(REQUEST).model).toBe(LIVE_STATS_MODEL);
    expect(openRouterBody(REQUEST).reasoning).toEqual({ effort: "minimal" });
  });

  it("gives every model the one reader prompt", () => {
    const [first, ...rest] = allSettings().map((setting) => openRouterBody(REQUEST, setting).messages[0]);
    for (const system of rest) expect(system).toEqual(first);
  });
});

describe("the replay harness's flags", () => {
  it("reads a live replay at the default, or at a named setting", () => {
    expect(parseReplayArgs(["game.json"])).toMatchObject({ path: "game.json", mode: "live", setting: DEFAULT_LIVE_STATS_SETTING, yes: false });
    expect(parseReplayArgs(["game.json", "--model", "anthropic/claude-haiku-5.5", "--effort", "medium"]).setting).toEqual({ model: HAIKU_MODEL, effort: "medium" });
    expect(parseReplayArgs(["game.json", "--model", "anthropic/claude-haiku-5.5"]).setting).toEqual({ model: HAIKU_MODEL, effort: "low" });
    expect(parseReplayArgs(["game.json", "--model=gemini-3.8-flash"]).setting).toEqual({ model: GEMINI_FLASH_MODEL, effort: "minimal" });
  });

  it("reads the other modes", () => {
    expect(parseReplayArgs(["game.json", "--dry"]).mode).toBe("dry");
    expect(parseReplayArgs(["game.json", "--recorded"]).mode).toBe("recorded");
    const compare = parseReplayArgs(["--compare", "game.json", "--yes"]);
    expect(compare).toMatchObject({ mode: "compare", yes: true });
    expect(compare.settings).toEqual(allSettings());
  });

  it("refuses what it cannot run", () => {
    expect(() => parseReplayArgs([])).toThrow(ReplayArgsError);
    expect(() => parseReplayArgs(["game.json", "--model", "openai/gpt-9"])).toThrow(/not an allowed setting/);
    expect(() => parseReplayArgs(["game.json", "--effort", "high"])).toThrow(/not an allowed setting/);
    expect(() => parseReplayArgs(["game.json", "--effort"])).toThrow(/needs a value/);
    expect(() => parseReplayArgs(["game.json", "--dry", "--compare"])).toThrow(/Pick one/);
    expect(() => parseReplayArgs(["game.json", "--compare", "--effort", "medium"])).toThrow(/leave out/);
    expect(() => parseReplayArgs(["game.json", "--fast"])).toThrow(/Unknown flag/);
  });
});
