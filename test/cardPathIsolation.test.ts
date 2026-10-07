import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// =============================================================================
// The card path must not be able to be dragged into anything that reads plays.
//
// "Every failure mode is silent to the card display" is the rule live stats are
// built under (docs/V3_DEFINITION.md section 4, G3), and the strongest way to
// hold it is structural: the modules that put a name on screen do not import the
// play code at all, so there is nothing for a network error, a timeout or a bad
// reply to reach them through.
//
// Forbidden: lib/plays/ (V2's play feed, of which only window.ts survives) and
// lib/livestats/ (where V3's stats will live). Allowed: lib/cards/, where the
// shared card-line code goes, since both sides need it.
//
// A source read rather than a runtime check, because the thing being asserted
// is about the shape of the dependency graph rather than about any one call.
// The live screen is in CARD_PATH, and its handleResults has its own
// no-await, no-fetch, no-storage assertions below.
// =============================================================================

const CARD_PATH = [
  "lib/matching/SpotterEngine.ts",
  "lib/matching/matcher.ts",
  "lib/matching/numbers.ts",
  "lib/matching/resolveJersey.ts",
  "lib/matching/jerseySound.ts",
  "lib/matching/matchLog.ts",
  "components/NameDisplay.tsx",
  "components/PlayerCard.tsx",
  "lib/rosters/buildWatchlist.ts",
  "lib/watchlist.ts",
  // Shared with live stats, so held to the card path's rule: both sides may
  // import lib/cards/, and lib/cards/ imports neither side.
  "lib/cards/cardPlayer.ts",
  "lib/cards/lines.ts",
  "lib/cards/limits.ts",
  "lib/cards/statKeys.ts",
  // The live screen: the socket, handleResults, and the direct DOM writes.
  "components/live/LiveScreen.tsx",
  "lib/afterPaint.ts",
];

const LIVE_SCREEN = "components/live/LiveScreen.tsx";

const FORBIDDEN = ["lib/plays/", "lib/livestats/"];

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Every specifier after a `from`, type-only imports included. */
function importsOf(path: string): string[] {
  return [...source(path).matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
}

/** A repo-relative file for a local specifier, or null for a package. */
function resolveLocal(fromPath: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = normalize(join(dirname(fromPath), specifier));
  else return null;

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(join(ROOT, candidate))) return candidate;
  }
  // A local import that does not resolve is itself a finding: return the bare
  // path so the forbidden check still sees where it points.
  return base;
}

function isForbidden(path: string): boolean {
  return FORBIDDEN.some((prefix) => path.startsWith(prefix));
}

/** Every local file the card path reaches, and how it got there. */
function reachable(): Map<string, string> {
  const seen = new Map<string, string>(CARD_PATH.map((path) => [path, "(root)"]));
  const queue = [...CARD_PATH];
  while (queue.length > 0) {
    const path = queue.shift()!;
    for (const specifier of importsOf(path)) {
      const target = resolveLocal(path, specifier);
      if (target === null || seen.has(target)) continue;
      seen.set(target, path);
      if (!isForbidden(target) && existsSync(join(ROOT, target))) queue.push(target);
    }
  }
  return seen;
}

describe("the card path", () => {
  for (const path of CARD_PATH) {
    it(`${path} exists`, () => {
      expect(existsSync(join(ROOT, path))).toBe(true);
    });

    it(`${path} does not import plays or live stats`, () => {
      const imports = importsOf(path);
      expect(imports.filter((specifier) => specifier.includes("plays/"))).toEqual([]);
      expect(imports.filter((specifier) => specifier.includes("livestats/"))).toEqual([]);
    });
  }

  it("reaches neither plays nor live stats through anything it imports", () => {
    const leaks = [...reachable()]
      .filter(([path]) => isForbidden(path))
      .map(([path, importer]) => `${importer} -> ${path}`);
    expect(leaks).toEqual([]);
  });

  // The walk is only worth something if it walks: it must get past the roots.
  // lib/cards/ is pure: numbers and strings in, strings out. Nothing in it may
  // reach the network, the DOM or React, or the card path would inherit it.
  it("keeps lib/cards/ free of React, Supabase and fetch", () => {
    for (const path of CARD_PATH.filter((file) => file.startsWith("lib/cards/"))) {
      const text = source(path);
      expect(importsOf(path).filter((specifier) => /react|supabase|next\//.test(specifier))).toEqual([]);
      expect(text).not.toMatch(/\bfetch\(|\bawait\b|localStorage|document\./);
    }
  });

  it("follows imports beyond the listed files", () => {
    const found = reachable();
    expect(found.has("lib/rosters/jerseyForms.ts")).toBe(true);
    expect(found.has("lib/game/colors.ts")).toBe(true);
    // Through the live screen, into what it runs after paint.
    expect(found.has("lib/log/gameLog.ts")).toBe(true);
    expect(found.has("lib/game/calledGames.ts")).toBe(true);
  });
});

// =============================================================================
// handleResults: the hot path. Matching is synchronous and the card is written
// into the DOM before anything else happens. Everything else (the browser log,
// the counts, analytics, React state) waits for afterPaint.
// =============================================================================

/** The text of a `const name = (...) => { ... }` in the live screen, up to the next top-level const. */
function liveFunction(name: string): string {
  const text = source(LIVE_SCREEN);
  const start = text.indexOf(`  const ${name} = `);
  expect(start, `${name} not found in ${LIVE_SCREEN}`).toBeGreaterThan(-1);
  const end = text.indexOf("\n  const ", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

describe("handleResults", () => {
  const body = liveFunction("handleResults");
  const paint = body.indexOf("afterPaint(");
  const beforePaint = body.slice(0, paint);

  it("is the function the Deepgram stream calls", () => {
    expect(source(LIVE_SCREEN)).toMatch(/useDeepgramStream\(\{[\s\S]*?onResults: handleResults/);
  });

  it("has no await, no fetch, no storage and no Supabase in it", () => {
    expect(body).not.toMatch(/\bawait\b|\basync\b/);
    expect(body).not.toMatch(/\bfetch\(/);
    expect(body).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(body).not.toMatch(/supabase|createClient/i);
  });

  it("runs the engine and writes the cards before it waits for paint", () => {
    expect(paint).toBeGreaterThan(-1);
    expect(beforePaint).toMatch(/engine\.process\(/);
    expect(beforePaint).toMatch(/showPlayers\(/);
  });

  it("never writes the log, counts or analytics itself: only from inside afterPaint", () => {
    // Nothing that records anything is called on the way to the card.
    expect(beforePaint).not.toMatch(/logWriter|\.push\(|bump\(|writeLiveCounts|track\(|set[A-Z]\w*\(/);
    // In the whole body the log is reached only through afterResult...
    expect(body).not.toMatch(/logWriter|writeLiveCounts|track\(/);
    // ...and afterResult is called only from inside the afterPaint callback.
    expect(body.indexOf("afterResult(")).toBeGreaterThan(paint);
  });

  it("afterResult, where the log is written, is called from nowhere but handleResults' afterPaint", () => {
    const text = source(LIVE_SCREEN);
    const calls = [...text.matchAll(/afterResult\(/g)].length;
    // The definition's own "afterResult = (" does not match; one call site remains.
    expect(calls).toBe(1);
    expect(liveFunction("afterResult")).toMatch(/logWriter\(\)/);
  });

  it("afterPaint is the real one, from lib/afterPaint", () => {
    expect(importsOf(LIVE_SCREEN)).toContain("@/lib/afterPaint");
  });
});
