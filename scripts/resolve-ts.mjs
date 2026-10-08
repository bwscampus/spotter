// Lets `node` run this repo's TypeScript the way the app imports it.
//
// Node strips types itself, but it does no extension resolution and knows
// nothing about the "@/" alias, so `import { x } from "./types"` and
// `from "@/lib/livestats/cost"` both fail. Rather than write extensions into every
// file in lib/ so one script can run, the two rules live here.
//
// registerHooks is the synchronous resolve hook API, in Node since 22.15.
// Used by `npm run replay:stats` and `npm run check:cards`; nothing the app
// ships goes through it.

import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const named = specifier.startsWith("@/")
      ? pathToFileURL(path.join(ROOT, specifier.slice(2))).href
      : specifier;
    try {
      return nextResolve(named, context);
    } catch (error) {
      for (const extension of EXTENSIONS) {
        try {
          return nextResolve(named + extension, context);
        } catch {
          // Try the next one. The original error is thrown if none work.
        }
      }
      throw error;
    }
  },
});
