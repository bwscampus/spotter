import { allSettings, DEFAULT_LIVE_STATS_SETTING, parseSetting, type LiveStatsSetting } from "./settings";

// =============================================================================
// The scorer's flags (scripts/score-livestats.ts), pure so a test can read them.
//
//   <folder> [--recorded] [--json] [--model <id>] [--effort <level>]
// =============================================================================

export interface ScoreArgs {
  folder: string;
  /** Replay each log's recorded replies through today's code, with no network. */
  recorded: boolean;
  /** Print the numbers as JSON to stdout and nothing else. */
  json: boolean;
  /** The setting a live run reads with. */
  setting: LiveStatsSetting;
  /** Run the halftime check (Part 8) in a live run. On unless --no-halftime, so a run can be scored with and without it. */
  halftime: boolean;
}

export class ScoreArgsError extends Error {}

export const SCORE_USAGE =
  "Usage: npm run score:stats -- <folder> [--recorded] [--json] [--no-halftime] [--model <id>] [--effort <level>]\n" +
  "The folder holds *.json logs (Download in Past games), each beside a *.truth.json with the box score, outside this repo.\n" +
  `Settings: ${allSettings()
    .map((setting) => `${setting.model} at ${setting.effort}`)
    .join(", ")}.`;

export function parseScoreArgs(argv: readonly string[]): ScoreArgs {
  let folder: string | null = null;
  let model: string | undefined;
  let effort: string | undefined;
  let recorded = false;
  let json = false;
  let halftime = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) throw new ScoreArgsError(`${arg} needs a value.\n${SCORE_USAGE}`);
      i += 1;
      return next;
    };
    if (arg === "--recorded") recorded = true;
    else if (arg === "--json") json = true;
    else if (arg === "--no-halftime") halftime = false;
    else if (arg === "--halftime") halftime = true;
    else if (arg === "--model") model = value();
    else if (arg.startsWith("--model=")) model = arg.slice("--model=".length);
    else if (arg === "--effort") effort = value();
    else if (arg.startsWith("--effort=")) effort = arg.slice("--effort=".length);
    else if (arg.startsWith("--")) throw new ScoreArgsError(`Unknown flag ${arg}.\n${SCORE_USAGE}`);
    else if (folder === null) folder = arg;
    else throw new ScoreArgsError(`One folder at a time.\n${SCORE_USAGE}`);
  }

  if (folder === null) throw new ScoreArgsError(SCORE_USAGE);
  if (recorded && (model !== undefined || effort !== undefined)) {
    throw new ScoreArgsError(`--recorded makes no calls; leave out --model and --effort.\n${SCORE_USAGE}`);
  }
  const setting = model === undefined && effort === undefined ? DEFAULT_LIVE_STATS_SETTING : parseSetting(model, effort);
  if (setting === null) throw new ScoreArgsError(`${model ?? DEFAULT_LIVE_STATS_SETTING.model} at ${effort ?? "its default effort"} is not an allowed setting.\n${SCORE_USAGE}`);
  return { folder, recorded, json, setting, halftime };
}
