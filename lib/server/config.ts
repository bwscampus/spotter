// Production configuration is checked when the server starts (Production
// Standard API-10). A deploy with a missing or unsafe setting fails its health
// check and never goes live, instead of failing later in front of a user.

/** Variables every Railway environment must set. Grows as routes arrive. */
export const REQUIRED_ON_RAILWAY = [
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "NEXT_PUBLIC_GOOGLE_CLIENT_ID",
  // Email/password sign-in: verification and reset emails (lib/server/email.ts).
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "APP_URL",
] as const;

/** Problems with this environment's configuration; empty when it is safe to serve. */
export function configProblems(env: Record<string, string | undefined>): string[] {
  // Off Railway (a laptop, CI) nothing is enforced.
  if (!env.RAILWAY_ENVIRONMENT_NAME) return [];

  const problems: string[] = [];
  for (const name of REQUIRED_ON_RAILWAY) {
    if (!env[name]?.trim()) problems.push(`${name} is not set`);
  }

  if (env.GOOGLE_CLIENT_ID && env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_ID !== env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    problems.push("GOOGLE_CLIENT_ID and NEXT_PUBLIC_GOOGLE_CLIENT_ID differ");
  }

  // Links in emails must not send anyone to a plain-http copy of the site.
  if (env.APP_URL && !/^https:\/\/[^/]+/.test(env.APP_URL)) problems.push("APP_URL must start with https://");

  if (env.DATABASE_URL) {
    let user = "";
    let host = "";
    try {
      const url = new URL(env.DATABASE_URL);
      user = decodeURIComponent(url.username);
      host = url.hostname;
    } catch {
      problems.push("DATABASE_URL is not a URL");
    }
    // DB-6: the app runs as the restricted role, never the owner.
    if (user && user !== "app_rw_login") problems.push("DATABASE_URL must connect as app_rw_login");
    // DB-4: app traffic stays on Railway's private network.
    if (host && !host.endsWith(".railway.internal")) problems.push("DATABASE_URL must use the private *.railway.internal host");
  }

  return problems;
}
