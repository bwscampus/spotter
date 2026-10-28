import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { parseContextFor, parseLine } from "@/lib/livestats/parse";
import { Segmenter } from "@/lib/livestats/segment";
import { syntheticBroadcast } from "./fixture";
import { ROSTER, TEAMS } from "./roster";

// The hot path's budget (v7 non-negotiable 2): the parser and the segmenter
// run synchronously on every Deepgram final and must finish in under 5 ms a
// line. 2,000 made-up lines, seeded, after a short warm-up so the JIT is not
// what is measured.

const LINES = 2_000;
const WARM_UP = 50;

/** Passes over the same lines; each line's time is the best of them, so a garbage collection pause is not what is measured. */
const PASSES = 3;

describe("the hot path", () => {
  it(`parses and segments ${LINES} lines in under 10 s, no line over 5 ms`, () => {
    const context = parseContextFor(ROSTER, TEAMS, "home");
    const lines = syntheticBroadcast(LINES + WARM_UP);
    const best = new Array<number>(LINES).fill(Number.POSITIVE_INFINITY);
    let total = Number.POSITIVE_INFINITY;
    for (let pass = 0; pass < PASSES; pass++) {
      const segmenter = new Segmenter();
      let at = 1_800_000_000_000;
      const started = performance.now();
      lines.forEach((text, index) => {
        at += 3_000;
        const before = performance.now();
        const parsed = parseLine(text, context, index);
        segmenter.push(parsed, at);
        const took = performance.now() - before;
        if (index >= WARM_UP) best[index - WARM_UP] = Math.min(best[index - WARM_UP], took);
      });
      total = Math.min(total, performance.now() - started);
    }
    const slowest = Math.max(...best);
    expect(total).toBeLessThan(10_000);
    expect(slowest, `slowest line ${slowest.toFixed(2)} ms`).toBeLessThan(5);
  });
});
