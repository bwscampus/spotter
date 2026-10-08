import { describe, expect, it } from "vitest";
import { countsInSupabase, deployEnv } from "@/lib/deployEnv";

// Jed, Oct 7: only production counts (here, Railway's production environment). Branch
// previews and local runs write no analytics, crash reports or shared logs.
describe("what counts in Supabase", () => {
  it("is production only", () => {
    expect(countsInSupabase(deployEnv("production"))).toBe(true);
    expect(countsInSupabase(deployEnv("preview"))).toBe(false);
    expect(countsInSupabase(deployEnv(undefined))).toBe(false);
    expect(countsInSupabase(deployEnv("anything else"))).toBe(false);
  });

  it("is what /api/events checks before it records anything", async () => {
    const { readFileSync } = await import("node:fs");
    for (const route of ["app/api/events/route.ts", "app/api/client-errors/route.ts"]) {
      const code = readFileSync(route, "utf8");
      expect(code).toMatch(/if \(process\.env\.RAILWAY_ENVIRONMENT_NAME !== "production"\) return nothing\(\);/);
      expect(code).not.toMatch(/env !== "preview"/);
    }
    expect(readFileSync("lib/log/shareLog.ts", "utf8")).toMatch(/if \(!countsInSupabase\(\)\) return false;/);
  });
});
