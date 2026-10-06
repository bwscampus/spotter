import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Route handlers against a real, migrated Postgres (CI's db job, or the local
// docker database in CLAUDE.md). DATABASE_URL must be the app_rw_login role.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["test/db/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
