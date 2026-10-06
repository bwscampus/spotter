import { defineRailway, github, postgres, project, service } from "railway/iac";

// Spotter's Railway project, applied with `railway config plan` / `apply` once per
// environment (docs/technical-design.md section 7). Each environment gets its own
// Postgres (OPS-5). Production deploys `main`, staging deploys `staging`, and
// neither deploys until CI passes on that commit (checkSuites, OPS-1).
//
// Secrets are not here. API keys and the Google client id are set per environment
// in Railway's dashboard; the database URLs and the app role arrive with
// security/db-auth.
export default defineRailway((ctx) => {
  const branch = ctx.isEnvironment("production") ? "main" : "staging";

  const db = postgres("Postgres", { region: "us-west2" });

  const app = service("spotter", {
    source: github("bwscampus/spotter", { branch, checkSuites: true }),
    build: { builder: "RAILPACK", buildCommand: "npm run build" },
    start: "npm run start",
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });

  return project("spotter", { resources: [db, app] });
});
