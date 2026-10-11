import { allSettings, DEFAULT_LIVE_STATS_SETTING, parseSetting, type LiveStatsSetting } from "./settings";

// =============================================================================
// The replay harness's flags (scripts/replay-livestats.ts), pure so a test can
// read them.
//
//   <log.json> [--dry | --recorded | --compare] [--model <id>] [--effort <level>] [--yes]
// =============================================================================

export type ReplayMode = "live" | "dry" | "recorded" | "compare";

export interface ReplayArgs {
  path: string;
  mode: ReplayMode;
  /** The one setting a live replay reads with. */
  setting: LiveStatsSetting;
  /** What --compare runs, in order: every allowed setting. */
  settings: LiveStatsSetting[];
  /** Skip --compare's "y" question. */
  yes: boolean;
}

export class ReplayArgsError extends Error {}

export const REPLAY_USAGE =
  "Usage: npm run replay:stats -- <spotter-log.json> [--dry | --recorded | --compare] [--model <id>] [--effort <level>]\n" +
  `Settings: ${allSettings()
    .map((setting) => `${setting.model} at ${setting.effort}`)
    .join(", ")}.`;

export function parseReplayArgs(argv: readonly string[]): ReplayArgs {
  let path: string | null = null;
  let model: string | undefined;
  let effort: string | undefined;
  const modes: ReplayMode[] = [];
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new ReplayArgsError(`${arg} needs a value.\n${REPLAY_USAGE}`);
      i += 1;
      return next;
    };
    if (arg === "--dry") modes.push("dry");
    else if (arg === "--recorded") modes.push("recorded");
    else if (arg === "--compare") modes.push("compare");
    else if (arg === "--yes") yes = true;
    else if (arg === "--model") model = value();
    else if (arg.startsWith("--model=")) model = arg.slice("--model=".length);
    else if (arg === "--effort") effort = value();
    else if (arg.startsWith("--effort=")) effort = arg.slice("--effort=".length);
    else if (arg.startsWith("--")) throw new ReplayArgsError(`Unknown flag ${arg}.\n${REPLAY_USAGE}`);
    else if (path === null) path = arg;
    else throw new ReplayArgsError(`One log at a time.\n${REPLAY_USAGE}`);
  }

  if (path === null) throw new ReplayArgsError(REPLAY_USAGE);
  if (modes.length > 1) throw new ReplayArgsError(`Pick one of --dry, --recorded and --compare.\n${REPLAY_USAGE}`);
  const mode = modes[0] ?? "live";
  if (mode === "compare" && (model !== undefined || effort !== undefined)) {
    throw new ReplayArgsError(`--compare runs every allowed setting; leave out --model and --effort.\n${REPLAY_USAGE}`);
  }
  const setting = model === undefined && effort === undefined ? DEFAULT_LIVE_STATS_SETTING : parseSetting(model, effort);
  if (setting === null) throw new ReplayArgsError(`${model ?? DEFAULT_LIVE_STATS_SETTING.model} at ${effort ?? "its default effort"} is not an allowed setting.\n${REPLAY_USAGE}`);
  return { path, mode, setting, settings: allSettings(), yes };
}
