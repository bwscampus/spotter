// Points git at the repo's own hooks (.githooks/pre-commit refuses the test
// set) on npm install. Quiet and harmless anywhere that is not a git checkout
// (Railway's build, a tarball): nothing to point, nothing to say.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(join(root, ".git"))) {
  try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "ignore" });
  } catch {
    // git is not here or refused; the hook is a safety net, not a requirement.
  }
}
