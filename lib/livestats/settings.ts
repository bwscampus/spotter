// Server only: read by lib/livestats/openrouter.ts (the route's call) and the
// replay harness. Never imported by the browser, which has no say in which
// model reads the plays.
import { LIVE_STATS_MODEL, type ReasoningEffort } from "@/lib/ai/openrouter";
import { OPENROUTER_RATES, type TokenRates } from "./cost";

// =============================================================================
// Which model reads the plays, and how hard it thinks (Oct 10: Jed wants to
// know whether Haiku at low or medium effort, or Gemini, finds the most plays
// before he decides). Two server environment variables, LIVE_STATS_MODEL and
// LIVE_STATS_EFFORT, defaulting to Gemini 3.8 Flash at minimal (since Oct 11:
// the replays had Gemini right on 88% of plays, Haiku on 53 to 61%). Only the
// settings below are accepted; anything else falls back to the default and
// says so once.
//
// Every setting goes over the same wire with the same privacy routing
// (lib/ai/openrouter.ts: zero retention, no data collection), whatever the
// model.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

export const GEMINI_FLASH_MODEL = LIVE_STATS_MODEL;

export const HAIKU_MODEL = "anthropic/claude-haiku-5.5";

/**
 * The models live stats may use, the efforts each may run at, and their
 * prices per million tokens through OpenRouter, for a reply that carries no
 * cost of its own. Gemini 3.8 Flash's are OPENROUTER_RATES; Haiku 5.5's are
 * from OpenRouter's model list (a prompt over 100,000 tokens costs five times
 * as much; a live stats call is a few thousand). "minimal" is Gemini's least
 * effort (it will not run with thinking off), "low" is Claude's.
 */
export const LIVE_STATS_MODELS: ReadonlyArray<{ model: string; label: string; efforts: readonly ReasoningEffort[]; rates: TokenRates }> = [
  { model: GEMINI_FLASH_MODEL, label: "Gemini 3.8 Flash", efforts: ["minimal"], rates: OPENROUTER_RATES },
  { model: HAIKU_MODEL, label: "Haiku 5.5", efforts: ["low", "medium"], rates: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 } },
];

/** Today's reader, and what an unset or unknown setting falls back to. */
export const DEFAULT_LIVE_STATS_SETTING: LiveStatsSetting = { model: GEMINI_FLASH_MODEL, effort: "minimal" };

// =============================================================================

export interface LiveStatsSetting {
  model: string;
  effort: ReasoningEffort;
}

/** Every allowed setting, in the order the replay's --compare runs them. */
export function allSettings(): LiveStatsSetting[] {
  return LIVE_STATS_MODELS.flatMap(({ model, efforts }) => efforts.map((effort) => ({ model, effort })));
}

/** The allowed setting these name, or null. A model may be named with or without its "provider/" prefix. */
export function parseSetting(model: string | undefined, effort: string | undefined): LiveStatsSetting | null {
  const wanted = (model ?? "").trim() || DEFAULT_LIVE_STATS_SETTING.model;
  const entry = LIVE_STATS_MODELS.find((each) => each.model === wanted || each.model.split("/")[1] === wanted);
  if (!entry) return null;
  const level = (effort ?? "").trim() || (entry.model === DEFAULT_LIVE_STATS_SETTING.model ? DEFAULT_LIVE_STATS_SETTING.effort : entry.efforts[0]);
  const allowed = entry.efforts.find((each) => each === level);
  return allowed ? { model: entry.model, effort: allowed } : null;
}

const warned = new Set<string>();

/**
 * The setting the server's environment asks for: LIVE_STATS_MODEL and
 * LIVE_STATS_EFFORT, each optional. One that is not allowed falls back to the
 * default, and the server log says so once per process.
 */
export function liveStatsSetting(env: Record<string, string | undefined> = process.env): LiveStatsSetting {
  const model = env.LIVE_STATS_MODEL?.trim() || undefined;
  const effort = env.LIVE_STATS_EFFORT?.trim() || undefined;
  if (!model && !effort) return DEFAULT_LIVE_STATS_SETTING;
  const setting = parseSetting(model, effort);
  if (setting) return setting;
  const key = `${model ?? ""}|${effort ?? ""}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(
      `[Spotter] LIVE_STATS_MODEL "${model ?? ""}" with LIVE_STATS_EFFORT "${effort ?? ""}" is not an allowed live stats setting; ` +
        `using ${DEFAULT_LIVE_STATS_SETTING.model} at ${DEFAULT_LIVE_STATS_SETTING.effort}.`,
    );
  }
  return DEFAULT_LIVE_STATS_SETTING;
}

/** The fallback prices for a model; the default's for one not on the list. */
export function ratesFor(model: string): TokenRates {
  return LIVE_STATS_MODELS.find((each) => each.model === model)?.rates ?? OPENROUTER_RATES;
}

/** "Gemini 3.8 Flash minimal". */
export function settingLabel(setting: LiveStatsSetting): string {
  const label = LIVE_STATS_MODELS.find((each) => each.model === setting.model)?.label ?? setting.model;
  return `${label} ${setting.effort}`;
}
