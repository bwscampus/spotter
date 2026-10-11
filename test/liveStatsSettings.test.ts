import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_STATS_MODEL } from "@/lib/ai/openrouter";
import { OPENROUTER_RATES, usageFromOpenRouter } from "@/lib/livestats/cost";
import { openRouterBody } from "@/lib/livestats/openrouter";
import { parseReplayArgs, ReplayArgsError } from "@/lib/livestats/replayArgs";
import {
  allSettings,
  DEFAULT_LIVE_STATS_SETTING,
  GEMINI_FLASH_MODEL,
  liveStatsSetting,
  parseSetting,
  ratesFor,
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
  it("defaults to Haiku 5.5 at low", () => {
    expect(DEFAULT_LIVE_STATS_SETTING).toEqual({ model: "anthropic/claude-haiku-5.5", effort: "low" });
    expect(DEFAULT_LIVE_STATS_SETTING.model).toBe(LIVE_STATS_MODEL);
    expect(liveStatsSetting({})).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(liveStatsSetting({ LIVE_STATS_MODEL: "", LIVE_STATS_EFFORT: " " })).toEqual(DEFAULT_LIVE_STATS_SETTING);
  });

  it("takes an allowed model and effort from the environment", () => {
    expect(liveStatsSetting({ LIVE_STATS_EFFORT: "medium" })).toEqual({ model: LIVE_STATS_MODEL, effort: "medium" });
    expect(liveStatsSetting({ LIVE_STATS_MODEL: GEMINI_FLASH_MODEL })).toEqual({ model: GEMINI_FLASH_MODEL, effort: "minimal" });
    expect(liveStatsSetting({ LIVE_STATS_MODEL: "gemini-3.8-flash", LIVE_STATS_EFFORT: "minimal" })).toEqual({ model: GEMINI_FLASH_MODEL, effort: "minimal" });
  });

  it("falls back to the default on anything off the list, and says so once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(liveStatsSetting({ LIVE_STATS_MODEL: "openai/gpt-9" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(liveStatsSetting({ LIVE_STATS_MODEL: "openai/gpt-9" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(liveStatsSetting({ LIVE_STATS_EFFORT: "high" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(liveStatsSetting({ LIVE_STATS_MODEL: GEMINI_FLASH_MODEL, LIVE_STATS_EFFORT: "low" })).toEqual(DEFAULT_LIVE_STATS_SETTING);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("allows exactly Haiku at low or medium and Gemini at minimal", () => {
    expect(allSettings()).toEqual([
      { model: LIVE_STATS_MODEL, effort: "low" },
      { model: LIVE_STATS_MODEL, effort: "medium" },
      { model: GEMINI_FLASH_MODEL, effort: "minimal" },
    ]);
    expect(parseSetting(LIVE_STATS_MODEL, "minimal")).toBeNull();
    expect(parseSetting("anthropic/claude-sonnet-5", "low")).toBeNull();
  });

  it("prices a reply with no cost at the model's own rates", () => {
    expect(ratesFor(LIVE_STATS_MODEL)).toBe(OPENROUTER_RATES);
    expect(ratesFor(GEMINI_FLASH_MODEL)).toEqual({ input: 0.75, output: 3.75, cacheWrite: 0, cacheRead: 0.075 });
    const million = { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 };
    expect(usageFromOpenRouter(million).costUsd).toBeCloseTo(0.6, 5);
    expect(usageFromOpenRouter(million, ratesFor(GEMINI_FLASH_MODEL)).costUsd).toBeCloseTo(4.5, 5);
  });

  it("sends the setting's model and effort, with the same privacy routing for every model", () => {
    for (const setting of allSettings()) {
      const body = openRouterBody(REQUEST, setting);
      expect(body.model).toBe(setting.model);
      expect(body.reasoning).toEqual({ effort: setting.effort });
      expect(body.provider).toEqual({ zdr: true, data_collection: "deny", require_parameters: true });
    }
    expect(openRouterBody(REQUEST).model).toBe(LIVE_STATS_MODEL);
    expect(openRouterBody(REQUEST).reasoning).toEqual({ effort: "low" });
  });
});

describe("the replay harness's flags", () => {
  it("reads a live replay at the default, or at a named setting", () => {
    expect(parseReplayArgs(["game.json"])).toMatchObject({ path: "game.json", mode: "live", setting: DEFAULT_LIVE_STATS_SETTING, yes: false });
    expect(parseReplayArgs(["game.json", "--model", "anthropic/claude-haiku-5.5", "--effort", "medium"]).setting).toEqual({ model: LIVE_STATS_MODEL, effort: "medium" });
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
