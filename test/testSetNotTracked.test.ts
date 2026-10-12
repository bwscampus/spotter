import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// =============================================================================
// The live stats test set (downloaded game logs, their exports and the
// *.truth.json box scores beside them) names high school players and must
// never reach GitHub. .gitignore keeps it out; this fails if git is tracking
// any file that looks like one anyway. CI runs it with every pull request.
// =============================================================================

const ROOT = new URL("..", import.meta.url);

/** The patterns .gitignore carries for the test set, as regexes over repo-relative paths. */
export const TEST_SET_PATTERNS: ReadonlyArray<{ ignore: string; matches: RegExp }> = [
  { ignore: "*.truth.json", matches: /(^|\/)[^/]*\.truth\.json$/ },
  { ignore: "SpotterTestSet/", matches: /(^|\/)SpotterTestSet\// },
  { ignore: "spotter-log-*.json", matches: /(^|\/)spotter-log-[^/]*\.json$/ },
  { ignore: "statcast-log-*.json", matches: /(^|\/)statcast-log-[^/]*\.json$/ },
  { ignore: "statcast-*.csv", matches: /(^|\/)statcast-[^/]*\.csv$/ },
  { ignore: "statcast-*.xlsx", matches: /(^|\/)statcast-[^/]*\.xlsx$/ },
  // The scorer's own output, which prints the detail tables with names.
  { ignore: "score-*.txt", matches: /(^|\/)score-[^/]*\.txt$/ },
  { ignore: "score-*.json", matches: /(^|\/)score-[^/]*\.json$/ },
];

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

describe("the live stats test set stays off GitHub", () => {
  it(".gitignore names every pattern", () => {
    const lines = readFileSync(new URL(".gitignore", ROOT), "utf8").split("\n").map((line) => line.trim());
    for (const { ignore } of TEST_SET_PATTERNS) expect(lines).toContain(ignore);
  });

  it("git tracks no log, export or truth file", () => {
    const tracked = trackedFiles();
    expect(tracked.length).toBeGreaterThan(0);
    const leaked = tracked.filter((file) => TEST_SET_PATTERNS.some(({ matches }) => matches.test(file)));
    expect(leaked).toEqual([]);
  });

  it("the patterns catch what they should and leave the fixtures alone", () => {
    const hit = (file: string) => TEST_SET_PATTERNS.some(({ matches }) => matches.test(file));
    expect(hit("docs/statcast-log-20261010-2015-abcd1234.json")).toBe(true);
    expect(hit("spotter-log-20261001-1715-ab12cd34.json")).toBe(true);
    expect(hit("notes/game.truth.json")).toBe(true);
    expect(hit("SpotterTestSet/anything.txt")).toBe(true);
    expect(hit("statcast-report-20261010-2015-abcd1234.xlsx")).toBe(true);
    expect(hit("statcast-stats-20261010-2015-abcd1234.csv")).toBe(true);
    expect(hit("score-after.txt")).toBe(true);
    expect(hit("test/fixtures/g5-synthetic-log.json")).toBe(false);
    expect(hit("lib/livestats/truth.ts")).toBe(false);
  });
});
