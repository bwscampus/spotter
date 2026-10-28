import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// =============================================================================
// v7's non-negotiables 1 and 3 (Oct 20), held statically:
//   - the card path (the modules that put a name on screen) reaches nothing
//     in lib/livestats/, whatever it imports, type imports included;
//   - no client bundle file (anything reachable by a value import from a
//     "use client" module) names OPENROUTER or reads a server-only
//     environment variable; the key never leaves the server.
// test/cardPathIsolation.test.ts holds the older, wider rule set; this one is
// the brief's own, kept simple so a failure says where the leak enters.
// =============================================================================

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** The card display path: the engine, the cards, the live screen and what they share with live stats. */
const CARD_MODULES = [
  "lib/matching/SpotterEngine.ts",
  "lib/matching/matcher.ts",
  "lib/matching/numbers.ts",
  "lib/matching/resolveJersey.ts",
  "components/NameDisplay.tsx",
  "components/PlayerCard.tsx",
  "components/live/LiveScreen.tsx",
  "lib/rosters/buildWatchlist.ts",
  "lib/watchlist.ts",
  "lib/game/statsBridge.ts",
  "lib/game/statLines.ts",
  "lib/cards/cardPlayer.ts",
  "lib/cards/lines.ts",
  "lib/cards/tonight.ts",
  "lib/cards/playerKey.ts",
  "lib/cards/statLayout.ts",
];

const IMPORT_FORMS = [
  /\bfrom\s+(["'])([^"']+)\1/g,
  /(?:^|[;\s])import\s+(["'])([^"']+)\1/g,
  /\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g,
  /\brequire\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g,
];

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Every module a file names. With `valuesOnly`, type-only imports (erased from a bundle) are left out. */
function specifiersIn(text: string, valuesOnly = false): string[] {
  const scanned = valuesOnly ? text.replace(/\bimport\s+type\s+[^;]+;/g, "").replace(/\bimport\s*\{([^}]*)\}\s*from\s*(["'])[^"']+\2/g, (whole, names: string) => (names.split(",").every((name) => /^\s*type\s/.test(name) || name.trim() === "") ? "" : whole)) : text;
  return [...new Set(IMPORT_FORMS.flatMap((form) => [...scanned.matchAll(form)].map((match) => match[2])))];
}

function resolveLocal(fromPath: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = normalize(join(dirname(fromPath), specifier));
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(join(ROOT, candidate))) return candidate;
  }
  return base;
}

/** Every local file reachable from the roots, mapped to the file that first reached it. */
function reachable(roots: readonly string[], valuesOnly = false): Map<string, string> {
  const seen = new Map<string, string>(roots.map((path) => [path, "(root)"]));
  const queue = [...roots];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (!existsSync(join(ROOT, path))) continue;
    for (const specifier of specifiersIn(source(path), valuesOnly)) {
      const target = resolveLocal(path, specifier);
      if (target === null || seen.has(target)) continue;
      seen.set(target, path);
      queue.push(target);
    }
  }
  return seen;
}

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the card path and live stats (non-negotiable 1)", () => {
  it("every card module exists", () => {
    for (const path of CARD_MODULES) expect(existsSync(join(ROOT, path)), path).toBe(true);
  });

  it("reaches nothing in lib/livestats/, components/livestats/ or lib/livestats/parse/, type imports included", () => {
    const leaks = [...reachable(CARD_MODULES)].filter(([path]) => path.startsWith("lib/livestats/") || path.startsWith("components/livestats/")).map(([path, importer]) => `${importer} -> ${path}`);
    expect(leaks).toEqual([]);
  });

  it("the walk reaches past the roots", () => {
    expect(reachable(CARD_MODULES).size).toBeGreaterThan(CARD_MODULES.length);
  });
});

describe("the key stays on the server (non-negotiable 3)", () => {
  const clientRoots = [...files("app"), ...files("components")].filter((path) => /^\s*["']use client["']/m.test(source(path)));

  it("finds the client modules", () => {
    expect(clientRoots).toContain("components/livestats/useLiveStats.ts");
    expect(clientRoots.length).toBeGreaterThan(5);
  });

  it("no file in a client bundle names OPENROUTER or reads a server-only environment variable", () => {
    const bundle = reachable(clientRoots, true);
    const offenders: string[] = [];
    for (const [path, importer] of bundle) {
      if (!existsSync(join(ROOT, path)) || !/\.(ts|tsx)$/.test(path)) continue;
      const text = source(path);
      if (/OPENROUTER/.test(text)) offenders.push(`${importer} -> ${path} names OPENROUTER`);
      const envs = [...text.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((match) => match[1]).filter((name) => !name.startsWith("NEXT_PUBLIC_") && name !== "NODE_ENV");
      if (envs.length > 0) offenders.push(`${importer} -> ${path} reads ${envs.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the server-side wire is not in the bundle", () => {
    const bundle = reachable(clientRoots, true);
    expect(bundle.has("lib/livestats/openrouter.ts")).toBe(false);
    expect(bundle.has("lib/ai/openrouter.ts")).toBe(false);
    expect(bundle.has("lib/livestats/zdr.ts")).toBe(false);
  });
});
