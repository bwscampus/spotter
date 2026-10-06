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
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(process.env.NODE_ENV === "production"),
      },
    ];
  },
};

export default nextConfig;
