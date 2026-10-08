import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

// Spotter's Railway project: one environment, production, deploying `main`
// once CI has passed on the commit (checkSuites, OPS-1). Applied with
// `railway config plan` / `apply` (docs/technical-design.md section 7).
//
// There is no staging environment (decided Oct 7): changes are tested by CI and
// locally, then go live from main. If one is ever added back, give it its own
// Postgres (OPS-5) and the lowest limits: half a vCPU, 512 MB, sleep when idle.
//
// Secrets are not here. They are set in Railway's dashboard, or by the
// database-security skill's cutover script for the database URLs, and listed
// below as preserve() so that applying this file keeps them instead of deleting
// them. A variable Railway holds but this file does not name is removed on apply.
export default defineRailway(() => {
  const db = postgres("Postgres", { region: "us-west2" });

  const app = service("spotter", {
    source: github("bwscampus/spotter", { branch: "main", checkSuites: true }),
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    start: "npm run start",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    // Production's address (Oct 8). Listed so applying this file keeps it.
    domains: ["thestatcast.com"],
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      // app_rw_login on the private host (DB-4, DB-6); the owner URL is for migrations only.
      DATABASE_URL: preserve(),
      MIGRATION_DATABASE_URL: preserve(),
      APP_DB_PASSWORD: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: preserve(),
      DEEPGRAM_API_KEY: preserve(),
      SENTRY_DSN: preserve(),
      // Every model call goes to Gemini through OpenRouter (Oct 8).
      OPENROUTER_API_KEY: preserve(),
      // No longer read (Oct 8). Kept, not deleted, so rolling a deploy back still finds them.
      ANTHROPIC_API_KEY: preserve(),
      LIVE_STATS_PROVIDER: preserve(),
      // Email/password sign-in: verification and reset emails through Resend, links to APP_URL.
      RESEND_API_KEY: preserve(),
      EMAIL_FROM: preserve(),
      APP_URL: preserve(),
    },
  });

  return project("spotter", { resources: [db, app] });
});
