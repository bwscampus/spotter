import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Mirrors the "@/*" path alias in tsconfig.json. Tests live under test/ so the
// Next.js router never sees them.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
