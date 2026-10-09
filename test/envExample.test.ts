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
  // Every model call: Gemini 3.8 Flash through OpenRouter.
  "OPENROUTER_API_KEY",
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
