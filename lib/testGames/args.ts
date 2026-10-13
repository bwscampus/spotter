import os from "node:os";

// =============================================================================
// What `npm run make:game` was asked for (scripts/make-test-game.ts). Every
// value is optional: anything missing is asked for, one question at a time.
// =============================================================================

export interface MakeArgs {
  transcript: string | null;
  espn: string | null;
  homeRoster: string | null;
  awayRoster: string | null;
  home: string | null;
  away: string | null;
  out: string | null;
  force: boolean;
}

export class MakeArgsError extends Error {}

const USAGE =
  "npm run make:game\n" +
  "npm run make:game -- <transcript> --espn <ESPN game link or number> [--out <folder>] [--force]\n" +
  'npm run make:game -- <transcript> --home "Name" --home-roster <home.csv> --away "Name" --away-roster <away.csv> [--out <folder>] [--force]';

export function parseMakeArgs(argv: readonly string[]): MakeArgs {
  const args: MakeArgs = { transcript: null, espn: null, homeRoster: null, awayRoster: null, home: null, away: null, out: null, force: false };
  const valued: Record<string, keyof MakeArgs> = {
    "--transcript": "transcript",
    "--espn": "espn",
    "--home-roster": "homeRoster",
    "--away-roster": "awayRoster",
    "--home": "home",
    "--away": "away",
    "--out": "out",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") throw new MakeArgsError(USAGE);
    const key = valued[arg];
    if (key) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new MakeArgsError(`${arg} needs a value.\n\n${USAGE}`);
      (args as unknown as Record<string, string>)[key] = value;
      i++;
      continue;
    }
    if (arg.startsWith("--")) throw new MakeArgsError(`Unknown option ${arg}.\n\n${USAGE}`);
    if (args.transcript !== null) throw new MakeArgsError(`Only one transcript at a time.\n\n${USAGE}`);
    args.transcript = arg;
  }
  return args;
}

/**
 * A path as it arrives when a file is dragged into a terminal window: Mac
 * Terminal escapes spaces ("My\ Games/x.txt"), iTerm and Windows wrap it in
 * quotes, and either may leave a space at the end. "~" is the home folder.
 */
export function cleanDraggedPath(typed: string): string {
  let text = typed.trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) text = text.slice(1, -1);
  else text = text.replace(/\\(.)/g, "$1");
  if (text === "~" || text.startsWith("~/")) text = os.homedir() + text.slice(1);
  return text;
}
