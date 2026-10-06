import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G1 (docs/V3_DEFINITION.md section 4): the matching engine, the Deepgram
// connection and the audio capture came from Spotter V3 (ad934d3) byte for byte.
// The manifest holds each file's SHA-256 at that commit. A change to one of these
// files is a deliberate decision: make it its own small change with its own tests,
// and regenerate the manifest line for that file in the same commit.

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GUARDED_DIRS = ["lib/matching", "lib/deepgram", "lib/audio"];

const manifest = new Map(
  readFileSync(join(ROOT, "test/fixtures/g1-ad934d3.sha256"), "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [hash, path] = line.split(/\s+/);
      return [path, hash] as const;
    }),
);

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)));
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");

describe("G1: the engine is ported, not rewritten", () => {
  it.each([...manifest])("%s matches ad934d3", (path, hash) => {
    expect(sha256(path)).toBe(hash);
  });

  it("has no file in the guarded folders that ad934d3 did not have", () => {
    const extra = GUARDED_DIRS.flatMap(filesUnder).filter((path) => !manifest.has(path));
    expect(extra).toEqual([]);
  });
});
