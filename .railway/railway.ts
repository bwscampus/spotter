import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

// Spotter's Railway project, applied with `railway config plan` / `apply` once per
// environment (docs/technical-design.md section 7). Each environment gets its own
// Postgres (OPS-5). Production deploys `main`, staging deploys `staging`, and
// neither deploys until CI passes on that commit (checkSuites, OPS-1).
//
// Staging runs on the lowest limits: half a vCPU, 512 MB, and the app sleeps when
// nobody is using it. It is for checking a change works, not for load. Production
// keeps Railway's defaults. The database's limits can't be set here (postgres()
// takes only a region); see README "Railway".
//
// Secrets are not here. They are set per environment in Railway's dashboard, or by
// the database-security skill's cutover script for the database URLs, and listed
// below as preserve() so that applying this file keeps them instead of deleting
// them. A variable Railway holds but this file does not name is removed on apply.
export default defineRailway((ctx) => {
  const isProduction = ctx.isEnvironment("production");
  const branch = isProduction ? "main" : "staging";

  const db = postgres("Postgres", { region: "us-west2" });

  const app = service("spotter", {
    source: github("bwscampus/spotter", { branch, checkSuites: true }),
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    start: "npm run start",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    ...(isProduction
      ? {}
      : {
          deploy: {
            sleepApplication: true,
            limitOverride: { containers: { cpu: 0.5, memoryBytes: 512 * 1024 * 1024 } },
          },
        }),
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      // app_rw_login on the private host (DB-4, DB-6); the owner URL is for migrations only.
      DATABASE_URL: preserve(),
      MIGRATION_DATABASE_URL: preserve(),
      APP_DB_PASSWORD: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: preserve(),
      DEEPGRAM_API_KEY: preserve(),
      ANTHROPIC_API_KEY: preserve(),
      SENTRY_DSN: preserve(),
    },
  });

  return project("spotter", { resources: [db, app] });
});
