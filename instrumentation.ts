// Runs once when the Next.js server starts. The configuration check is Node-only,
// so it is imported only in the Node runtime (Next's documented pattern).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refuseUnsafeConfig } = await import("./lib/server/startup");
    refuseUnsafeConfig();
    // Which model live stats reads with here, in the deploy log (Oct 26).
    const { readerLine } = await import("./lib/livestats/settings");
    console.info(readerLine());
    const { startHousekeeping } = await import("./lib/server/housekeeping");
    startHousekeeping();
  }
}
