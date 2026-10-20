import type { StatsCounts } from "@/lib/game/statsBridge";
import { addCallUsage, NO_CALL_USAGE, type CallUsage } from "./prices";
import type { LiveStatsPipeline, LiveStatsSetting, ReconcileMode } from "./settings";

// =============================================================================
// The run manifest (v7, Part 0): what one replay was, written beside the
// --plays-json file so a scoring tool can read the cost, the latency and the
// flags without parsing the terminal. One JSON file, pure to build; the
// script writes it.
//
// PRIVACY: nothing from the transcript or the rosters is in it. The log is
// named by its file name alone, and every call is counts and seconds.
// =============================================================================

export const MANIFEST_FORMAT = "spotter-replay-manifest";

/** One model call as the manifest records it: which read it was, which model, what it cost, how long it took. */
export interface CallRecord extends CallUsage {
  /** 1-based, in the order the calls were made. */
  index: number;
  /** "first", "second", "drive", ... for v6; "segment", "reread", "tiebreak" and so on for v7. */
  look: string;
  /** The reader's part in a v7 call: a, b, tie or halftime. */
  role: "a" | "b" | "tie" | "halftime" | "reader";
  seconds: number;
  /** The segment the call read (v7), when it read one. */
  segmentId?: string;
  ok: boolean;
}

export interface LatencySummary {
  count: number;
  p50: number;
  p95: number;
  max: number;
}

export interface RunManifest {
  format: typeof MANIFEST_FORMAT;
  runId: string | null;
  gitSha: string;
  writtenAt: string;
  /** "Away at Home". */
  game: string;
  /** The log's file name, never its path or content. */
  log: string;
  pipeline: LiveStatsPipeline;
  flags: {
    model: string;
    effort: string;
    modelB: string | null;
    effortB: string | null;
    tieBreak: string | null;
    reconcile: ReconcileMode | null;
    inferRb: boolean;
    maxCostUsd: number | null;
    halftime: boolean;
  };
  calls: CallRecord[];
  totals: Omit<CallUsage, "model"> & { calls: number; failed: number };
  /** Seconds from a play's segment's last line to the moment its stats were applied. */
  latency: LatencySummary;
  plays: { returned: number; read: number; applied: number; discarded: number };
  counts: StatsCounts;
}

/** Nearest-rank percentile, 0 for none. */
export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1));
  return sorted[rank];
}

export function summarizeLatency(seconds: readonly number[]): LatencySummary {
  return {
    count: seconds.length,
    p50: round(percentile(seconds, 0.5)),
    p95: round(percentile(seconds, 0.95)),
    max: round(seconds.reduce((best, value) => Math.max(best, value), 0)),
  };
}

export interface ManifestInputs {
  runId: string | null;
  gitSha: string;
  now: Date;
  game: { away: string; home: string };
  logName: string;
  pipeline: LiveStatsPipeline;
  setting: LiveStatsSetting;
  modelB: LiveStatsSetting | null;
  tieBreak: LiveStatsSetting | null;
  reconcile: ReconcileMode | null;
  inferRb: boolean;
  maxCostUsd: number | null;
  halftime: boolean;
  calls: readonly CallRecord[];
  latencies: readonly number[];
  plays: RunManifest["plays"];
  counts: StatsCounts;
}

export function buildManifest(inputs: ManifestInputs): RunManifest {
  let totals = { ...NO_CALL_USAGE };
  for (const call of inputs.calls) totals = addCallUsage(totals, call);
  return {
    format: MANIFEST_FORMAT,
    runId: inputs.runId,
    gitSha: inputs.gitSha,
    writtenAt: inputs.now.toISOString(),
    game: `${inputs.game.away || "Away"} at ${inputs.game.home || "Home"}`,
    log: inputs.logName,
    pipeline: inputs.pipeline,
    flags: {
      model: inputs.setting.model,
      effort: inputs.setting.effort,
      modelB: inputs.modelB?.model ?? null,
      effortB: inputs.modelB?.effort ?? null,
      tieBreak: inputs.tieBreak ? `${inputs.tieBreak.model} ${inputs.tieBreak.effort}` : null,
      reconcile: inputs.reconcile,
      inferRb: inputs.inferRb,
      maxCostUsd: inputs.maxCostUsd,
      halftime: inputs.halftime,
    },
    calls: [...inputs.calls],
    totals: { ...totals, calls: inputs.calls.length, failed: inputs.calls.filter((call) => !call.ok).length },
    latency: summarizeLatency(inputs.latencies),
    plays: inputs.plays,
    counts: inputs.counts,
  };
}

/** The manifest's path for a plays file: "plays.json" gets "plays.manifest.json" beside it. */
export function manifestPathFor(playsPath: string): string {
  return playsPath.replace(/\.json$/i, "") + ".manifest.json";
}

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
