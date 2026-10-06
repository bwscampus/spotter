import { describe, expect, it } from "vitest";
import { configProblems } from "@/lib/server/config";

const GOOD = {
  RAILWAY_ENVIRONMENT_NAME: "staging",
  DATABASE_URL: "postgresql://app_rw_login:pw@postgres.railway.internal:5432/railway",
  GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com",
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "abc.apps.googleusercontent.com",
};

describe("configProblems (API-10)", () => {
  it("passes a safe Railway configuration", () => {
    expect(configProblems(GOOD)).toEqual([]);
  });

  it("enforces nothing off Railway", () => {
    expect(configProblems({})).toEqual([]);
  });

  it("names every missing variable, and never a value", () => {
    const problems = configProblems({ RAILWAY_ENVIRONMENT_NAME: "production" });
    expect(problems).toEqual([
      "DATABASE_URL is not set",
      "GOOGLE_CLIENT_ID is not set",
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set",
    ]);
  });

  it("refuses the database owner (DB-6)", () => {
    const problems = configProblems({ ...GOOD, DATABASE_URL: "postgresql://postgres:secret@postgres.railway.internal:5432/railway" });
    expect(problems).toContain("DATABASE_URL must connect as app_rw_login");
    expect(problems.join(" ")).not.toContain("secret");
  });

  it("refuses the public database host (DB-4)", () => {
    expect(configProblems({ ...GOOD, DATABASE_URL: "postgresql://app_rw_login:pw@shuttle.proxy.rlwy.net:4242/railway" })).toEqual([
      "DATABASE_URL must use the private *.railway.internal host",
    ]);
  });

  it("refuses two different Google client ids", () => {
    expect(configProblems({ ...GOOD, NEXT_PUBLIC_GOOGLE_CLIENT_ID: "other" })).toEqual([
      "GOOGLE_CLIENT_ID and NEXT_PUBLIC_GOOGLE_CLIENT_ID differ",
    ]);
  });
});
