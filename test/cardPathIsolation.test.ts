import { existsSync, readdirSync, readFileSync } from "node:fs";
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
// Forbidden: lib/plays/ (V2's play feed, of which only window.ts survives),
// lib/livestats/ (V3's stats), components/livestats/ (the stats strip and the
// loop on the live screen) and lib/replay/ (the G5 check, which runs both
// sides). Allowed: lib/cards/, where the shared card-line code goes, since
// both sides need it, and lib/game/statsBridge.ts, the one shape the live
// screen knows live stats by.
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
  "lib/cards/tonight.ts",
  "lib/cards/playerKey.ts",
  "lib/cards/cardFace.ts",
  "lib/cards/bigLine.ts",
  // The card's look: slab colours, ink and school codes; the stage's font;
  // and the canvas measure that fits each big line before a card goes up.
  "lib/game/colors.ts",
  "components/stageFont.ts",
  "components/measureBigLine.ts",
  // The live screen: the socket, handleResults, and the direct DOM writes.
  "components/live/LiveScreen.tsx",
  "lib/afterPaint.ts",
  // What the live screen knows of live stats: an interface, and the mapping
  // from playerKeys to the player objects the cards are put up with.
  "lib/game/statsBridge.ts",
  "lib/game/statLines.ts",
];

const LIVE_SCREEN = "components/live/LiveScreen.tsx";

const FORBIDDEN = ["lib/plays/", "lib/livestats/", "components/livestats/", "lib/replay/"];

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/**
 * Every module a file names, in any quotes: after a `from` (type-only imports
 * included), a bare `import "x"`, a dynamic `import("x")` and a `require("x")`.
 */
const IMPORT_FORMS = [
  /\bfrom\s+(["'])([^"']+)\1/g,
  /(?:^|[;\s])import\s+(["'])([^"']+)\1/g,
  /\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g,
  /\brequire\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g,
];

function specifiersIn(text: string): string[] {
  return [...new Set(IMPORT_FORMS.flatMap((form) => [...text.matchAll(form)].map((match) => match[2])))];
}

function importsOf(path: string): string[] {
  return specifiersIn(source(path));
}

describe("the import walker", () => {
  // Pre-launch audit M8: it used to see only `from "x"`, so any other way in was invisible.
  it("sees every way a file can name a module", () => {
    const text = [
      `import { a } from "@/lib/one";`,
      `import type { B } from '@/lib/two';`,
      `import "@/lib/three";`,
      `import './four';`,
      `const five = await import("@/lib/livestats/five");`,
      `const six = import('@/lib/plays/six');`,
      "const seven = require(`@/lib/replay/seven`);",
      `const eight = require("../eight");`,
      `export { nine } from "@/lib/nine";`,
    ].join("\n");
    expect(specifiersIn(text).sort()).toEqual(
      [
        "@/lib/one",
        "@/lib/two",
        "@/lib/three",
        "./four",
        "@/lib/livestats/five",
        "@/lib/plays/six",
        "@/lib/replay/seven",
        "../eight",
        "@/lib/nine",
      ].sort(),
    );
  });

  it("does not take the word import inside a sentence for an import", () => {
    expect(specifiersIn(`// the "important" thing\nconst text = "imports nothing";`)).toEqual([]);
  });
});

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

/**
 * Every local file reachable from the roots, and how it got there. The walk
 * stops at anything `stop` says, so a leak is reported where it enters rather
 * than followed through.
 */
function reachable(roots: string[] = CARD_PATH, stop: (path: string) => boolean = isForbidden): Map<string, string> {
  const seen = new Map<string, string>(roots.map((path) => [path, "(root)"]));
  const queue = [...roots];
  while (queue.length > 0) {
    const path = queue.shift()!;
    for (const specifier of importsOf(path)) {
      const target = resolveLocal(path, specifier);
      if (target === null || seen.has(target)) continue;
      seen.set(target, path);
      if (!stop(target) && existsSync(join(ROOT, target))) queue.push(target);
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
      expect(imports.filter((specifier) => specifier.includes("replay/"))).toEqual([]);
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
    // Through the live screen, into what it runs after paint.
    expect(found.has("lib/log/gameLog.ts")).toBe(true);
    expect(found.has("lib/game/calledGames.ts")).toBe(true);
  });
});

// =============================================================================
// And the other direction (G3): live stats may not reach the engine or the
// code that puts cards up. It supplies text; it never calls NameDisplay.show(),
// never runs the matcher, and never touches the live screen's card writes.
// lib/cards/ is the one place both sides meet.
// =============================================================================

/**
 * Everything that is live stats: the loop and the rules, and the strip and the
 * hook on the live screen. Not LiveGame.tsx, the composition root, whose whole
 * job is to hand the live screen the bridge and so must import it.
 */
const COMPOSITION_ROOT = "components/livestats/LiveGame.tsx";
const LIVE_STATS = [
  ...readdirSync(join(ROOT, "lib/livestats"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => `lib/livestats/${file}`),
  ...readdirSync(join(ROOT, "components/livestats"))
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => `components/livestats/${file}`)
    .filter((path) => path !== COMPOSITION_ROOT),
];

const OFF_LIMITS_TO_STATS = ["lib/matching/", "components/NameDisplay.tsx", "components/PlayerCard.tsx", "components/live/", "lib/deepgram/"];

function offLimitsToStats(path: string): boolean {
  return OFF_LIMITS_TO_STATS.some((prefix) => path.startsWith(prefix));
}

describe("live stats", () => {
  it("has files to check", () => {
    expect(LIVE_STATS).toContain("lib/livestats/apply.ts");
    expect(LIVE_STATS).toContain("lib/livestats/extract.ts");
    expect(LIVE_STATS).toContain("lib/livestats/controller.ts");
    expect(LIVE_STATS).toContain("components/livestats/StatsStrip.tsx");
    expect(LIVE_STATS).toContain("components/livestats/useLiveStats.ts");
    expect(LIVE_STATS).not.toContain(COMPOSITION_ROOT);
  });

  it("never calls show() or runs the engine, by name either", () => {
    for (const path of LIVE_STATS) {
      const text = source(path);
      expect(text, path).not.toMatch(/\.show\(|\.restat\(|SpotterEngine|scanWords|markSlotWrong|markNewestWrong/);
    }
  });

  it("meets the live screen in exactly one place, which adds nothing but the wiring", () => {
    const imports = importsOf(COMPOSITION_ROOT);
    expect(imports).toContain("@/components/live/LiveScreen");
    // The engine, the cards and the matcher are the live screen's business, never this file's.
    expect(imports.filter((specifier) => /matching\/|NameDisplay|PlayerCard|deepgram\//.test(specifier))).toEqual([]);
    // And nothing but the composition root and the page that renders it imports the live screen.
    const importers = [...reachable(["app/live/page.tsx"], () => false)]
      .filter(([, importer]) => importer !== "(root)")
      .filter(([path]) => path === LIVE_SCREEN)
      .map(([, importer]) => importer);
    expect(importers).toEqual([COMPOSITION_ROOT]);
  });

  it("reaches neither the engine nor anything that puts a card up", () => {
    const leaks = [...reachable(LIVE_STATS, offLimitsToStats)]
      .filter(([path]) => offLimitsToStats(path))
      .map(([path, importer]) => `${importer} -> ${path}`);
    expect(leaks).toEqual([]);
  });

  it("gets its card lines from lib/cards/, the shared folder", () => {
    // The walk has to get somewhere for the check above to mean anything.
    const found = reachable(LIVE_STATS, offLimitsToStats);
    expect(found.has("lib/cards/playerKey.ts")).toBe(true);
    expect(found.has("lib/cards/tonight.ts")).toBe(true);
    expect(found.has("lib/cards/lines.ts")).toBe(true);
    expect(found.has("lib/game/statsBridge.ts")).toBe(true);
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
    // This repo's server calls go through lib/apiClient.ts api(), which is a fetch.
    expect(body).not.toMatch(/\bapi\(|apiClient/);
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

// =============================================================================
// SpotterEngine.process and everything it calls: every file under lib/matching/
// is held to the hot path's rule, not just handleResults (pre-launch audit M8).
// Comments are stripped first, so a sentence about fetch is not a fetch.
// =============================================================================

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("the engine, every file in lib/matching/", () => {
  const files = readdirSync(join(ROOT, "lib/matching"))
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => `lib/matching/${file}`);

  it("has files to check, the engine among them", () => {
    expect(files).toContain("lib/matching/SpotterEngine.ts");
    expect(files).toContain("lib/matching/matcher.ts");
    expect(files.length).toBeGreaterThan(5);
  });

  // V2's match log keeps rows in localStorage, which V3 never calls (V3's log
  // is lib/log/). It cannot be edited (G1), so it is held to something
  // stronger: no file in lib/matching/ and not the live screen may import
  // anything from it but types, so none of its storage can run there.
  const STORAGE_EXEMPT = "lib/matching/matchLog.ts";

  it("lets nothing on the card path import matchLog.ts but its types", () => {
    for (const path of [...files, LIVE_SCREEN]) {
      const valueImports = [...source(path).matchAll(/import\s+(?!type\b)[^;]*?from\s+["']([^"']*matchLog)["']/g)].map((match) => match[1]);
      expect(valueImports, path).toEqual([]);
      expect(source(path), path).not.toMatch(/(?:import|require)\s*\(\s*["'`][^"'`]*matchLog/);
    }
  });

  for (const path of files.filter((file) => file !== STORAGE_EXEMPT)) {
    it(`${path} has no await, no fetch, no storage, no IndexedDB and no Supabase`, () => {
      const text = withoutComments(source(path));
      expect(text).not.toMatch(/\bawait\b|\basync\b/);
      expect(text).not.toMatch(/\bfetch\(/);
      expect(text).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
      expect(text).not.toMatch(/supabase|createClient/i);
      expect(text).not.toMatch(/\bapi\(|apiClient/);
      expect(importsOf(path).filter((specifier) => /supabase|livestats\/|plays\/|replay\/|\/log\//.test(specifier))).toEqual([]);
    });
  }
});

// =============================================================================
// writeCard and show(): the DOM writes on the hot path. Text,
// hidden flags and a few style or attribute writes on elements that already
// exist. No layout read, which would force the browser to lay the page out
// mid-result, and no element created (docs/CARD_SPEC.md).
// =============================================================================

/** The text of a top-level `export function name(` up to the next top-level function. */
function exported(path: string, name: string): string {
  const text = source(path);
  const start = text.indexOf(`export function ${name}(`);
  expect(start, `${name} not found in ${path}`).toBeGreaterThan(-1);
  const end = text.indexOf("\nfunction ", start + 1);
  const next = text.indexOf("\nexport function ", start + 1);
  const stop = [end, next].filter((index) => index > -1).sort((a, b) => a - b)[0];
  return text.slice(start, stop);
}

/** The body of a method in NameDisplay's handle, up to the next one. */
function handleMethod(name: string): string {
  const text = source("components/NameDisplay.tsx");
  const start = text.indexOf(`      ${name}(`);
  expect(start, `${name} not found in NameDisplay`).toBeGreaterThan(-1);
  const end = text.indexOf("\n      },\n", start);
  return text.slice(start, end);
}

const LAYOUT_READ =
  /getBoundingClientRect|getClientRects|offset(Width|Height|Top|Left)|client(Width|Height|Top|Left)|scroll(Width|Height|Top|Left)|getComputedStyle|innerText|measureText/;
const MAKES_ELEMENTS = /createElement|cloneNode|innerHTML|outerHTML|insertAdjacent|appendChild|append\(|prepend\(|replaceChildren|insertBefore/;

describe("the card writes", () => {
  const writers = [
    ...["writeCard", "writeBigLine", "writeStatLines", "writeLine", "writeItem", "writeSlab"].map((name) => ({
      name,
      body: ["writeLine", "writeItem", "writeSlab"].includes(name) ? privateFunction(name) : exported("components/PlayerCard.tsx", name),
    })),
    { name: "show", body: handleMethod("show") },
    { name: "restat", body: handleMethod("restat") },
  ];

  function privateFunction(name: string): string {
    const text = source("components/PlayerCard.tsx");
    const start = text.indexOf(`function ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const end = text.indexOf("\n}\n", start);
    return text.slice(start, end);
  }

  for (const { name, body } of writers) {
    it(`${name} reads no layout and creates no element`, () => {
      expect(body.length).toBeGreaterThan(40);
      expect(body).not.toMatch(LAYOUT_READ);
      expect(body).not.toMatch(MAKES_ELEMENTS);
      expect(body).not.toMatch(/\bawait\b|\basync\b|localStorage|sessionStorage|indexedDB|fetch\(/);
    });
  }

  it("show runs no fit: the card's size never depends on what it says", () => {
    expect(source("components/NameDisplay.tsx")).not.toMatch(/fitCards|getBoundingClientRect/);
  });

  it("restat writes stat lines through the same exported functions the cards use", () => {
    expect(handleMethod("restat")).toMatch(/writeStatLines\(/);
    expect(exported("components/PlayerCard.tsx", "writeCard")).toMatch(/writeStatLines\(/);
  });
});
