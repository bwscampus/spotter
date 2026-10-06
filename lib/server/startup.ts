import { configProblems } from "./config";

/**
 * Refusing to start on bad configuration keeps a broken deploy from going live
 * (API-10): its health check fails and Railway keeps the previous deployment.
 * Names only: never print a value.
 */
export function refuseUnsafeConfig(): void {
  const problems = configProblems(process.env);
  if (problems.length > 0) {
    console.error(`Refusing to start: ${problems.join("; ")}.`);
    process.exit(1);
  }
}
