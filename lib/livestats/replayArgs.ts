import {
  allSettings,
  DEFAULT_LIVE_STATS_SETTING,
  DEFAULT_RECONCILE_MODE,
  DEFAULT_V7_MODEL_A,
  DEFAULT_V7_MODEL_B,
  everySetting,
  isPipeline,
  isReconcileMode,
  parseSetting,
  RECONCILE_MODES,
  type LiveStatsPipeline,
  type LiveStatsSetting,
  type ReconcileMode,
} from "./settings";

// =============================================================================
// The replay harness's flags (scripts/replay-livestats.ts), pure so a test can
// read them.
//
//   <log.json> [--dry | --recorded | --compare] [--model <id>] [--effort <level>] [--yes]
//              [--plays-json <path>] [--pipeline v6|v7] [--model-b <id>|off] [--effort-b <level>]
//              [--reconcile ab|aa|ab-no-tiebreak|a] [--infer-rb] [--run-id <id>] [--max-cost <usd>]
//
// v7 (Oct 20, Part 0): --pipeline picks the engine; --model-b and --effort-b
// name the second reader of the cross-model check (Part 8), "off" for reader
// A alone; --reconcile picks the ablation variant; --infer-rb turns Part 7's
// running-back prior on; --run-id names the run in the manifest written beside
// --plays-json; --max-cost stops the optional calls (second looks, re-reads,
// reader B, the tie-break) once a game has spent that much.
//
// v6 (Oct 22): --recorded --replies <a v6 run's plays file> re-runs that run's
// recorded replies through today's code with no network; without --replies,
// --recorded is the old re-run of the log's own stats_reply records.
// =============================================================================

export type ReplayMode = "live" | "dry" | "recorded" | "compare";

export interface ReplayArgs {
  path: string;
  mode: ReplayMode;
  /** The one setting a live replay reads with (v7: reader A). */
  setting: LiveStatsSetting;
  /** Whether --model or --effort chose it (a --replies re-run otherwise reads with the recorded run's setting). */
  settingGiven: boolean;
  /** What --compare runs, in order: every allowed setting. */
  settings: LiveStatsSetting[];
  /** Skip --compare's "y" question. */
  yes: boolean;
  /** Where to write every play as it finally stands (lib/livestats/playsJson.ts), live mode only. Null, the default, writes nothing. */
  playsJson: string | null;
  pipeline: LiveStatsPipeline;
  /** v7's reader B: a setting, null for A alone ("off"), undefined for the default. */
  modelB: LiveStatsSetting | null | undefined;
  reconcile: ReconcileMode;
  inferRb: boolean;
  /** The run's name in the manifest. Null for none. */
  runId: string | null;
  /** Dollars a game may spend before the optional calls stop. Null for no cap. */
  maxCostUsd: number | null;
  /** v7 --recorded (fix 1, Part 6): the plays file of the run whose recorded answers are re-run. Null otherwise. */
  answers: string | null;
  /** v6 --recorded (Oct 22): the plays file of the run whose recorded replies are re-run. Null otherwise. */
  replies: string | null;
}

export class ReplayArgsError extends Error {}

export const REPLAY_USAGE =
  "Usage: npm run replay:stats -- <spotter-log.json> [--dry | --recorded | --compare] [--model <id>] [--effort <level>] [--plays-json <path outside this repo>]\n" +
  "       [--pipeline v6|v7] [--model-b <id>|off] [--effort-b <level>] [--reconcile ab|aa|ab-no-tiebreak|a] [--infer-rb] [--run-id <id>] [--max-cost <usd>]\n" +
  "       [--pipeline v7 --recorded --answers <a v7 run's plays file>] [--recorded --replies <a v6 run's plays file>]\n" +
  `Settings (v6): ${allSettings()
    .map((setting) => `${setting.model} at ${setting.effort}`)
    .join(", ")}.\n` +
  `Settings (v7 readers): ${everySetting()
    .map((setting) => `${setting.model} at ${setting.effort}`)
    .join(", ")}.`;

export function parseReplayArgs(argv: readonly string[]): ReplayArgs {
  let path: string | null = null;
  let model: string | undefined;
  let effort: string | undefined;
  let modelB: string | undefined;
  let effortB: string | undefined;
  let pipeline: string | undefined;
  let reconcile: string | undefined;
  let runId: string | null = null;
  let maxCost: string | undefined;
  let inferRb = false;
  const modes: ReplayMode[] = [];
  let yes = false;
  let playsJson: string | null = null;
  let answers: string | null = null;
  let replies: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new ReplayArgsError(`${arg} needs a value.\n${REPLAY_USAGE}`);
      i += 1;
      return next;
    };
    const flag = (name: string): string | null => {
      if (arg === name) return value();
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
      return null;
    };
    let taken: string | null;
    if (arg === "--dry") modes.push("dry");
    else if (arg === "--recorded") modes.push("recorded");
    else if (arg === "--compare") modes.push("compare");
    else if (arg === "--yes") yes = true;
    else if (arg === "--infer-rb") inferRb = true;
    else if ((taken = flag("--model")) !== null) model = taken;
    else if ((taken = flag("--effort")) !== null) effort = taken;
    else if ((taken = flag("--model-b")) !== null) modelB = taken;
    else if ((taken = flag("--effort-b")) !== null) effortB = taken;
    else if ((taken = flag("--pipeline")) !== null) pipeline = taken;
    else if ((taken = flag("--reconcile")) !== null) reconcile = taken;
    else if ((taken = flag("--run-id")) !== null) runId = taken;
    else if ((taken = flag("--max-cost")) !== null) maxCost = taken;
    else if ((taken = flag("--plays-json")) !== null) playsJson = taken;
    else if ((taken = flag("--answers")) !== null) answers = taken;
    else if ((taken = flag("--replies")) !== null) replies = taken;
    else if (arg.startsWith("--")) throw new ReplayArgsError(`Unknown flag ${arg}.\n${REPLAY_USAGE}`);
    else if (path === null) path = arg;
    else throw new ReplayArgsError(`One log at a time.\n${REPLAY_USAGE}`);
  }

  if (path === null) throw new ReplayArgsError(REPLAY_USAGE);
  if (modes.length > 1) throw new ReplayArgsError(`Pick one of --dry, --recorded and --compare.\n${REPLAY_USAGE}`);
  const mode = modes[0] ?? "live";
  if (playsJson !== null && playsJson.trim() === "") throw new ReplayArgsError(`--plays-json needs a path.\n${REPLAY_USAGE}`);
  // A dry v7 run writes one too (fix 1, Part 0): no plays, but every segment and every request as it would have been sent.
  if (answers !== null && answers.trim() === "") throw new ReplayArgsError(`--answers needs a path.\n${REPLAY_USAGE}`);
  if (replies !== null && replies.trim() === "") throw new ReplayArgsError(`--replies needs a path.\n${REPLAY_USAGE}`);
  // A v7 recorded run (fix 1, Part 6) re-runs a run's recorded answers (--answers <its plays file>), and a v6 one a run's
  // recorded replies (--replies, Oct 22); either can write its own plays file.
  const recordedV7 = mode === "recorded" && pipeline === "v7";
  const recordedV6 = mode === "recorded" && pipeline !== "v7" && replies !== null;
  if (playsJson !== null && mode !== "live" && !(mode === "dry" && pipeline === "v7") && !recordedV7 && !recordedV6) {
    throw new ReplayArgsError(`--plays-json writes the plays of one live replay, or a dry one under --pipeline v7; it cannot go with --${mode}${mode === "dry" ? " under v6" : ""}.\n${REPLAY_USAGE}`);
  }
  if (mode === "compare" && (model !== undefined || effort !== undefined)) {
    throw new ReplayArgsError(`--compare runs every allowed setting; leave out --model and --effort.\n${REPLAY_USAGE}`);
  }

  if (pipeline !== undefined && !isPipeline(pipeline)) throw new ReplayArgsError(`--pipeline takes v6 or v7, not "${pipeline}".\n${REPLAY_USAGE}`);
  const engine: LiveStatsPipeline = pipeline ?? "v6";
  if (engine !== "v7" && (modelB !== undefined || effortB !== undefined || reconcile !== undefined || inferRb)) {
    throw new ReplayArgsError(`--model-b, --effort-b, --reconcile and --infer-rb are v7's flags; add --pipeline v7.\n${REPLAY_USAGE}`);
  }
  if (engine === "v7" && mode === "recorded" && answers === null) throw new ReplayArgsError(`--recorded under --pipeline v7 re-runs a run's recorded answers: add --answers <that run's plays file>.\n${REPLAY_USAGE}`);
  if (answers !== null && !(engine === "v7" && mode === "recorded")) throw new ReplayArgsError(`--answers goes with --pipeline v7 --recorded.\n${REPLAY_USAGE}`);
  if (replies !== null && !(engine === "v6" && mode === "recorded")) throw new ReplayArgsError(`--replies goes with --recorded, under v6.\n${REPLAY_USAGE}`);
  if (engine === "v7" && mode === "compare") throw new ReplayArgsError(`--compare runs v6's settings; run v7 once per setting with --model and --model-b.\n${REPLAY_USAGE}`);

  const fallback = engine === "v7" ? DEFAULT_V7_MODEL_A : DEFAULT_LIVE_STATS_SETTING;
  const setting = model === undefined && effort === undefined ? fallback : parseSetting(model ?? fallback.model, effort);
  if (setting === null) throw new ReplayArgsError(`${model ?? fallback.model} at ${effort ?? "its default effort"} is not an allowed setting.\n${REPLAY_USAGE}`);

  let readerB: LiveStatsSetting | null | undefined;
  if (modelB?.toLowerCase() === "off") {
    if (effortB !== undefined) throw new ReplayArgsError(`--effort-b has no reader to apply to with --model-b off.\n${REPLAY_USAGE}`);
    readerB = null;
  } else if (modelB !== undefined || effortB !== undefined) {
    readerB = parseSetting(modelB ?? DEFAULT_V7_MODEL_B.model, effortB);
    if (readerB === null) throw new ReplayArgsError(`${modelB ?? DEFAULT_V7_MODEL_B.model} at ${effortB ?? "its default effort"} is not an allowed setting for reader B.\n${REPLAY_USAGE}`);
  }

  let mode7: ReconcileMode = DEFAULT_RECONCILE_MODE;
  if (reconcile !== undefined) {
    if (!isReconcileMode(reconcile)) throw new ReplayArgsError(`--reconcile takes ${RECONCILE_MODES.join(", ")}, not "${reconcile}".\n${REPLAY_USAGE}`);
    mode7 = reconcile;
  }
  if (mode7 === "a") readerB = null;

  if (runId !== null && (runId.trim() === "" || /[/\\]/.test(runId))) throw new ReplayArgsError(`--run-id is a name, not a path.\n${REPLAY_USAGE}`);

  let maxCostUsd: number | null = null;
  if (maxCost !== undefined) {
    const parsed = Number(maxCost.replace(/^\$/, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) throw new ReplayArgsError(`--max-cost takes dollars, like 0.50, not "${maxCost}".\n${REPLAY_USAGE}`);
    maxCostUsd = parsed;
  }

  return { path, mode, setting, settingGiven: model !== undefined || effort !== undefined, settings: allSettings(), yes, playsJson, pipeline: engine, modelB: readerB, reconcile: mode7, inferRb, runId: runId?.trim() ?? null, maxCostUsd, answers: answers?.trim() ?? null, replies: replies?.trim() ?? null };
}
