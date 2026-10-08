import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import { securityHeaders } from "./lib/securityHeaders";

/**
 * The commit this build came from, shown on the home page and sent with
 * analytics as app_version. Railway sets RAILWAY_GIT_COMMIT_SHA; a local build
 * asks git; anything else says so rather than failing the build.
 */
function gitCommit(): string {
  const fromRailway = process.env.RAILWAY_GIT_COMMIT_SHA?.trim();
  if (fromRailway) return fromRailway;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_COMMIT: gitCommit(),
    // "production" on Railway's production environment, "development" anywhere
    // else (lib/deployEnv.ts): only production writes analytics, crash reports
    // and shared game logs.
    NEXT_PUBLIC_DEPLOY_ENV: process.env.RAILWAY_ENVIRONMENT_NAME === "production" ? "production" : "development",
  },
  poweredByHeader: false,
  // unpdf bundles its own serverless build of PDF.js. Leaving it to the bundler
  // works, but keeping it external avoids Turbopack rewriting the inlined worker.
  serverExternalPackages: ["unpdf"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "production"),
      },
    ];
  },
  experimental: {
    // With a proxy.ts present, Next buffers the request bodies it matches and
    // silently truncates anything past this limit. proxy.ts skips /api/*, so
    // uploads never pass through it; this is headroom if that ever changes.
    proxyClientMaxBodySize: "12mb",
  },
};

export default nextConfig;
