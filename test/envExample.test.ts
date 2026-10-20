import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// .env.example is the one env file that is committed. It names every variable
// the app reads (docs/technical-design.md) and must never carry a value.

const EXPECTED = [
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "APP_DB_PASSWORD",
  "GOOGLE_CLIENT_ID",
  "DEEPGRAM_API_KEY",
  "SENTRY_DSN",
  "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  // Every model call goes through OpenRouter (Claude Sonnet 5 for imports, Gemini 3.8 Flash for live stats).
  "OPENROUTER_API_KEY",
  // Optional: the live stats model and effort (lib/livestats/settings.ts).
  "LIVE_STATS_MODEL",
  "LIVE_STATS_EFFORT",
  // Optional, v7 (docs/LIVE_STATS_V7.md): the pipeline and its readers.
  "LIVE_STATS_PIPELINE",
  "LIVE_STATS_MODEL_B",
  "LIVE_STATS_EFFORT_B",
  "LIVE_STATS_TIE_BREAK_EFFORT",
  "LIVE_STATS_RECONCILE",
  "LIVE_STATS_INFER_RB",
  "LIVE_STATS_MAX_COST_USD",
  // Email/password sign-in.
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_URL",
];

const lines = readFileSync(new URL("../.env.example", import.meta.url), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

describe(".env.example", () => {
  it("names exactly the expected variables", () => {
    expect(lines.map((line) => line.split("=")[0]).sort()).toEqual([...EXPECTED].sort());
  });

  it("holds no values", () => {
    for (const line of lines) expect(line).toMatch(/^[A-Z_]+=$/);
  });
});
