// Runs once when the Next.js server starts. The configuration check is Node-only,
// so it is imported only in the Node runtime (Next's documented pattern).
//
// main has no live stats (Nov 1), so it prints no "[Spotter] Live stats" reader
// line; testrun2 does. Merging testrun2 into main, keep main's side of this file.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refuseUnsafeConfig } = await import("./lib/server/startup");
    refuseUnsafeConfig();
    const { startHousekeeping } = await import("./lib/server/housekeeping");
    startHousekeeping();
  }
}
