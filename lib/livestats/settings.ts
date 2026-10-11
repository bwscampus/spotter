// Server only: read by lib/livestats/openrouter.ts (the route's call) and the
// replay harness. Never imported by the browser, which has no say in which
// model reads the plays.
import { LIVE_STATS_MODEL, type ReasoningEffort } from "@/lib/ai/openrouter";
import { OPENROUTER_RATES, type TokenRates } from "./cost";

// =============================================================================
// Which model reads the plays, and how hard it thinks (Oct 10: Jed wants to
// know whether Haiku at low or medium effort, or Gemini, finds the most plays
// before he decides). Two server environment variables, LIVE_STATS_MODEL and
// LIVE_STATS_EFFORT, defaulting to Haiku 5.5 at low. Only the settings below
// are accepted; anything else falls back to the default and says so once.
//
// Every setting goes over the same wire with the same privacy routing
// (lib/ai/openrouter.ts: zero retention, no data collection), whatever the
// model.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

export const GEMINI_FLASH_MODEL = "google/gemini-3.8-flash";

/**
 * The models live stats may use, the efforts each may run at, and their
 * prices per million tokens through OpenRouter, for a reply that carries no
 * cost of its own. Haiku 5.5's are OPENROUTER_RATES (Oct 10); Gemini 3.8
 * Flash's are what lib/livestats/cost.ts held from Oct 5 to Oct 10. "minimal"
 * is Gemini's least effort (it will not run with thinking off), "low" is
 * Claude's.
 */
export const LIVE_STATS_MODELS: ReadonlyArray<{ model: string; label: string; efforts: readonly ReasoningEffort[]; rates: TokenRates }> = [
  { model: LIVE_STATS_MODEL, label: "Haiku 5.5", efforts: ["low", "medium"], rates: OPENROUTER_RATES },
  { model: GEMINI_FLASH_MODEL, label: "Gemini 3.8 Flash", efforts: ["minimal"], rates: { input: 0.75, output: 3.75, cacheWrite: 0, cacheRead: 0.075 } },
];

/** Today's reader, and what an unset or unknown setting falls back to. */
export const DEFAULT_LIVE_STATS_SETTING: LiveStatsSetting = { model: LIVE_STATS_MODEL, effort: "low" };

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

/** "Haiku 5.5 low". */
export function settingLabel(setting: LiveStatsSetting): string {
  const label = LIVE_STATS_MODELS.find((each) => each.model === setting.model)?.label ?? setting.model;
  return `${label} ${setting.effort}`;
}
