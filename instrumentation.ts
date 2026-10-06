// Runs once when the Next.js server starts. The configuration check is Node-only,
// so it is imported only in the Node runtime (Next's documented pattern).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refuseUnsafeConfig } = await import("./lib/server/startup");
    refuseUnsafeConfig();
  }
}
