import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The pre-commit hook (v7, Oct 20): a staged path naming the test set fails
// the commit; the script is run with paths so no git state is needed.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const run = (...paths: string[]) => spawnSync(process.execPath, ["scripts/check-staged-paths.mjs", ...paths], { cwd: ROOT, encoding: "utf8" });

describe("the pre-commit check", () => {
  it("refuses a path naming SpotterTestSet or spotter-v3-log, in any case", () => {
    for (const path of ["SpotterTestSet/game.json", "docs/spottertestset-copy.md", "runs/spotter-v3-log-abc.json", "notes/Spotter-V3-Log.txt"]) {
      const result = run("lib/ok.ts", path);
      expect(result.status, path).toBe(1);
      expect(result.stderr).toContain(path);
    }
  });

  it("lets ordinary paths through", () => {
    expect(run("lib/livestats/replayLog.ts", "test/parse/fixture.ts").status).toBe(0);
  });

  it("is what the hook runs, and npm install points git at the hook", () => {
    expect(readFileSync(new URL(".githooks/pre-commit", `file://${ROOT}`), "utf8")).toContain("check-staged-paths.mjs");
    const pkg = JSON.parse(readFileSync(new URL("package.json", `file://${ROOT}`), "utf8"));
    expect(pkg.scripts.prepare).toBe("node scripts/install-hooks.mjs");
    expect(readFileSync(new URL("scripts/install-hooks.mjs", `file://${ROOT}`), "utf8")).toContain(".githooks");
  });
});
