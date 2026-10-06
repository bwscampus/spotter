import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// LIC-1: PolyForm Noncommercial from the first commit, never a scaffold's default.

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("license (LIC-1)", () => {
  it("LICENSE.md starts with the Required Notice and is PolyForm Noncommercial", () => {
    const license = read("LICENSE.md");
    expect(license.split("\n")[0]).toMatch(/^Required Notice: Copyright \d{4} The Spotter founders/);
    expect(license).toContain("PolyForm Noncommercial License 1.0.0");
  });

  it("package.json declares the same license", () => {
    expect(JSON.parse(read("package.json")).license).toBe("PolyForm-Noncommercial-1.0.0");
  });
});
