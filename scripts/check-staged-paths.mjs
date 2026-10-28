// The pre-commit check (v7, Oct 20): no staged path may name the live stats
// test set. The set names high school players and lives outside the repo
// (~/SpotterTestSet); .gitignore and test/testSetNotTracked.test.ts hold the
// line too, this is the one that runs before the commit exists.
//
//   node scripts/check-staged-paths.mjs            # the staged files, from git
//   node scripts/check-staged-paths.mjs a.txt b.js # these paths (for the test)
import { execFileSync } from "node:child_process";

/** A path with one of these in it is the test set's, wherever it sits. */
export const FORBIDDEN_PATH_PARTS = ["SpotterTestSet", "spotter-v3-log"];

export function forbiddenPaths(paths) {
  return paths.filter((path) => FORBIDDEN_PATH_PARTS.some((part) => path.toLowerCase().includes(part.toLowerCase())));
}

function stagedPaths() {
  const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], { encoding: "utf8" });
  return out.split("\0").filter(Boolean);
}

const given = process.argv.slice(2);
const paths = given.length > 0 ? given : stagedPaths();
const bad = forbiddenPaths(paths);
if (bad.length > 0) {
  console.error("Refusing to commit: these paths name the live stats test set, which never goes in the repo:");
  for (const path of bad) console.error(`  ${path}`);
  console.error("Unstage them (git restore --staged <path>) and keep the set in ~/SpotterTestSet.");
  process.exit(1);
}
