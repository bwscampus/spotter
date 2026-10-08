/**
 * Where this build runs, for deciding what counts. Only Railway's production
 * environment writes analytics, crash reports and shared game logs (Jed, Oct 7:
 * "all activity on non-main branches shouldn't count"). Local runs still work;
 * they just record none of it. Set at build time from RAILWAY_ENVIRONMENT_NAME
 * in next.config.ts, so the browser knows too.
 */
export type DeployEnv = "production" | "preview" | "development";

export function deployEnv(value: string | undefined = process.env.NEXT_PUBLIC_DEPLOY_ENV): DeployEnv {
  return value === "production" || value === "preview" ? value : "development";
}

/** Whether this build's activity is recorded in the database: production only. (V3's name, kept so V3's code ports unchanged.) */
export function countsInSupabase(env: DeployEnv = deployEnv()): boolean {
  return env === "production";
}
