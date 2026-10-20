// Server only: read by lib/livestats/openrouter.ts (the route's call) and the
// replay harness. Never imported by the browser, which has no say in which
// model reads the plays. (The one thing the browser learns is which pipeline
// runs, through NEXT_PUBLIC_LIVE_STATS_PIPELINE, which next.config.ts sets
// from liveStatsPipeline() at build time.)
import { LIVE_STATS_MODEL, type ReasoningEffort } from "@/lib/ai/openrouter";
import { OPENROUTER_RATES, type TokenRates } from "./cost";
import { GPT_6_LUNA, HAIKU_55, priceFor, SONNET_55 } from "./prices";

// =============================================================================
// Which model reads the plays, and how hard it thinks (Oct 10: Jed wants to
// know whether Haiku at low or medium effort, or Gemini, finds the most plays
// before he decides). Two server environment variables, LIVE_STATS_MODEL and
// LIVE_STATS_EFFORT, defaulting to Gemini 3.8 Flash at minimal (since Oct 11:
// the replays had Gemini right on 88% of plays, Haiku on 53 to 61%). Only the
// settings below are accepted; anything else falls back to the default and
// says so once.
//
// Oct 20 (v7): a third variable, LIVE_STATS_PIPELINE, picks the engine: "v6"
// (the window reader, unchanged) or "v7" (the staged pipeline: parser,
// segmenter, candidates, a per-play extractor, the yards solver and the
// cross-model check; docs/LIVE_STATS_V7.md). v6 until the acceptance run
// (Part 10) says otherwise. v7 has its own settings below (v7Settings).
//
// Every setting goes over the same wire with the same privacy routing
// (lib/ai/openrouter.ts: zero retention, no data collection), whatever the
// model.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

export const GEMINI_FLASH_MODEL = LIVE_STATS_MODEL;

export const HAIKU_MODEL = HAIKU_55;

/** GPT-6 Luna, the second reader of v7's cross-model check (Part 8). */
export const LUNA_MODEL = GPT_6_LUNA;

/**
 * The models live stats may use, the efforts each may run at, and their
 * prices per million tokens through OpenRouter, for a reply that carries no
 * cost of its own (./prices.ts). "minimal" is Gemini's least effort (it will
 * not run with thinking off), "low" is Claude's least with thinking on, and
 * "none" (v7, Part 5: Haiku with thinking off) is sent as reasoning disabled.
 */
export const LIVE_STATS_MODELS: ReadonlyArray<{ model: string; label: string; efforts: readonly ReasoningEffort[]; rates: TokenRates }> = [
  { model: GEMINI_FLASH_MODEL, label: "Gemini 3.8 Flash", efforts: ["minimal"], rates: OPENROUTER_RATES },
  { model: HAIKU_MODEL, label: "Haiku 5.5", efforts: ["low", "medium", "none"], rates: priceFor(HAIKU_55)! },
  { model: LUNA_MODEL, label: "GPT-6 Luna", efforts: ["low", "none"], rates: priceFor(GPT_6_LUNA)! },
];

/** What --compare runs: the three v6 settings it has always run. */
export const COMPARE_SETTINGS: readonly LiveStatsSetting[] = [
  { model: GEMINI_FLASH_MODEL, effort: "minimal" },
  { model: HAIKU_MODEL, effort: "low" },
  { model: HAIKU_MODEL, effort: "medium" },
];

/** Today's reader, and what an unset or unknown setting falls back to. */
export const DEFAULT_LIVE_STATS_SETTING: LiveStatsSetting = { model: GEMINI_FLASH_MODEL, effort: "minimal" };

/**
 * The halftime checkup's model (Oct 11, Part 8): Claude Sonnet 5.5, the one
 * careful read of the whole first half. "low" is the least effort Claude
 * accepts with thinking on, and a full read needs no more. Checked on
 * openrouter.ai on Oct 11: $2 in, $10 out, $0.10 a cached read, $2.50 a cache
 * write, per million tokens (./prices.ts). Not a live stats setting: never
 * the per-window reader.
 */
export const HALFTIME_MODEL = SONNET_55;
export const HALFTIME_SETTING: LiveStatsSetting = { model: HALFTIME_MODEL, effort: "low" };
export const HALFTIME_RATES: TokenRates = priceFor(SONNET_55)!;

/** The two engines. v6 is the default until Part 10's acceptance run passes. */
export const LIVE_STATS_PIPELINES = ["v6", "v7"] as const;
export type LiveStatsPipeline = (typeof LIVE_STATS_PIPELINES)[number];
export const DEFAULT_PIPELINE: LiveStatsPipeline = "v6";

/** v7's readers when nothing is set: Haiku 5.5 at low (reader A), GPT-6 Luna at low (reader B), Haiku at medium for the tie-break. */
export const DEFAULT_V7_MODEL_A: LiveStatsSetting = { model: HAIKU_MODEL, effort: "low" };
export const DEFAULT_V7_MODEL_B: LiveStatsSetting = { model: LUNA_MODEL, effort: "low" };
export const DEFAULT_V7_TIE_BREAK: LiveStatsSetting = { model: HAIKU_MODEL, effort: "medium" };

/** Most model spend one game may make under v7 (Part 8's cost guard; the replay's --max-cost overrides it). */
export const DEFAULT_V7_MAX_COST_USD = 1;

/** How the two readers are used (Part 8's ablation): A and B with a tie-break, A twice, A and B with no tie-break, or A alone. */
export const RECONCILE_MODES = ["ab", "aa", "ab-no-tiebreak", "a"] as const;
export type ReconcileMode = (typeof RECONCILE_MODES)[number];
export const DEFAULT_RECONCILE_MODE: ReconcileMode = "ab";

// =============================================================================

export interface LiveStatsSetting {
  model: string;
  effort: ReasoningEffort;
}

/** Every setting --compare runs, in order (the v6 three). */
export function allSettings(): LiveStatsSetting[] {
  return COMPARE_SETTINGS.map((setting) => ({ ...setting }));
}

/** Every allowed setting, the v7-only ones included. */
export function everySetting(): LiveStatsSetting[] {
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

function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

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
  warnOnce(
    `${model ?? ""}|${effort ?? ""}`,
    `[Spotter] LIVE_STATS_MODEL "${model ?? ""}" with LIVE_STATS_EFFORT "${effort ?? ""}" is not an allowed live stats setting; ` +
      `using ${DEFAULT_LIVE_STATS_SETTING.model} at ${DEFAULT_LIVE_STATS_SETTING.effort}.`,
  );
  return DEFAULT_LIVE_STATS_SETTING;
}

/** The fallback prices for a model; the default's for one not on the list. */
export function ratesFor(model: string): TokenRates {
  if (model === HALFTIME_MODEL) return HALFTIME_RATES;
  return LIVE_STATS_MODELS.find((each) => each.model === model)?.rates ?? priceFor(model) ?? OPENROUTER_RATES;
}

/** "Gemini 3.8 Flash minimal". */
export function settingLabel(setting: LiveStatsSetting): string {
  const label = setting.model === HALFTIME_MODEL ? "Sonnet 5.5" : (LIVE_STATS_MODELS.find((each) => each.model === setting.model)?.label ?? setting.model);
  return `${label} ${setting.effort}`;
}

// -----------------------------------------------------------------------------
// The pipeline (v7, Part 0).
// -----------------------------------------------------------------------------

export function isPipeline(value: unknown): value is LiveStatsPipeline {
  return typeof value === "string" && (LIVE_STATS_PIPELINES as readonly string[]).includes(value);
}

/** LIVE_STATS_PIPELINE: "v6" (the default) or "v7". Anything else is v6, said once. */
export function liveStatsPipeline(env: Record<string, string | undefined> = process.env): LiveStatsPipeline {
  const wanted = env.LIVE_STATS_PIPELINE?.trim();
  if (!wanted) return DEFAULT_PIPELINE;
  if (isPipeline(wanted)) return wanted;
  warnOnce(`pipeline|${wanted}`, `[Spotter] LIVE_STATS_PIPELINE "${wanted}" is not v6 or v7; using ${DEFAULT_PIPELINE}.`);
  return DEFAULT_PIPELINE;
}

/** Everything v7 reads with (docs/LIVE_STATS_V7.md, settings). */
export interface V7Settings {
  /** Reader A, the one every segment goes to. */
  modelA: LiveStatsSetting;
  /** Reader B (Part 8), or null for A alone. */
  modelB: LiveStatsSetting | null;
  /** The tie-break when A and B disagree. */
  tieBreak: LiveStatsSetting;
  reconcile: ReconcileMode;
  /** Part 7: credit the offense's dominant back on an unnamed rush. Off unless its precision on the dev games is 90% or better. */
  allowInferredRb: boolean;
  /** The most one game may spend on model calls; optional calls stop first, then reader B (Part 8). */
  maxCostUsd: number;
}

export const DEFAULT_V7_SETTINGS: V7Settings = {
  modelA: DEFAULT_V7_MODEL_A,
  modelB: DEFAULT_V7_MODEL_B,
  tieBreak: DEFAULT_V7_TIE_BREAK,
  reconcile: DEFAULT_RECONCILE_MODE,
  allowInferredRb: false,
  maxCostUsd: DEFAULT_V7_MAX_COST_USD,
};

export function isReconcileMode(value: unknown): value is ReconcileMode {
  return typeof value === "string" && (RECONCILE_MODES as readonly string[]).includes(value);
}

/**
 * v7's settings from the server's environment, each optional:
 * LIVE_STATS_MODEL and LIVE_STATS_EFFORT (reader A; v7's own default is
 * Haiku 5.5 at low, not v6's Gemini), LIVE_STATS_MODEL_B and
 * LIVE_STATS_EFFORT_B ("off" for A alone), LIVE_STATS_TIE_BREAK_EFFORT,
 * LIVE_STATS_RECONCILE, LIVE_STATS_INFER_RB ("1" or "true") and
 * LIVE_STATS_MAX_COST_USD. Anything unknown falls back, said once.
 */
export function v7Settings(env: Record<string, string | undefined> = process.env): V7Settings {
  const settings: V7Settings = { ...DEFAULT_V7_SETTINGS };
  const modelA = env.LIVE_STATS_MODEL?.trim() || undefined;
  const effortA = env.LIVE_STATS_EFFORT?.trim() || undefined;
  if (modelA || effortA) {
    const parsed = parseSetting(modelA ?? DEFAULT_V7_MODEL_A.model, effortA);
    if (parsed) settings.modelA = parsed;
    else warnOnce(`v7a|${modelA ?? ""}|${effortA ?? ""}`, `[Spotter] LIVE_STATS_MODEL "${modelA ?? ""}" at "${effortA ?? ""}" is not allowed for v7's reader A; using ${settingLabel(DEFAULT_V7_MODEL_A)}.`);
  }
  const modelB = env.LIVE_STATS_MODEL_B?.trim() || undefined;
  const effortB = env.LIVE_STATS_EFFORT_B?.trim() || undefined;
  if (modelB?.toLowerCase() === "off") settings.modelB = null;
  else if (modelB || effortB) {
    const parsed = parseSetting(modelB ?? DEFAULT_V7_MODEL_B.model, effortB);
    if (parsed) settings.modelB = parsed;
    else warnOnce(`v7b|${modelB ?? ""}|${effortB ?? ""}`, `[Spotter] LIVE_STATS_MODEL_B "${modelB ?? ""}" at "${effortB ?? ""}" is not allowed for v7's reader B; using ${settingLabel(DEFAULT_V7_MODEL_B)}.`);
  }
  const tieEffort = env.LIVE_STATS_TIE_BREAK_EFFORT?.trim() || undefined;
  if (tieEffort) {
    const parsed = parseSetting(DEFAULT_V7_TIE_BREAK.model, tieEffort);
    if (parsed) settings.tieBreak = parsed;
    else warnOnce(`v7tie|${tieEffort}`, `[Spotter] LIVE_STATS_TIE_BREAK_EFFORT "${tieEffort}" is not allowed; using ${settingLabel(DEFAULT_V7_TIE_BREAK)}.`);
  }
  const mode = env.LIVE_STATS_RECONCILE?.trim() || undefined;
  if (mode) {
    if (isReconcileMode(mode)) settings.reconcile = mode;
    else warnOnce(`v7mode|${mode}`, `[Spotter] LIVE_STATS_RECONCILE "${mode}" is not one of ${RECONCILE_MODES.join(", ")}; using ${DEFAULT_RECONCILE_MODE}.`);
  }
  const infer = env.LIVE_STATS_INFER_RB?.trim().toLowerCase();
  if (infer === "1" || infer === "true" || infer === "on") settings.allowInferredRb = true;
  const cap = env.LIVE_STATS_MAX_COST_USD?.trim();
  if (cap) {
    const value = Number(cap);
    if (Number.isFinite(value) && value > 0) settings.maxCostUsd = value;
    else warnOnce(`v7cap|${cap}`, `[Spotter] LIVE_STATS_MAX_COST_USD "${cap}" is not a positive number; using ${DEFAULT_V7_MAX_COST_USD}.`);
  }
  if (settings.reconcile === "a") settings.modelB = null;
  return settings;
}
