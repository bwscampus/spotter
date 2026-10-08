import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// The audio worklet (public/pcm-capture-worklet.js) run in a sandbox with a
// fake audio thread: a tone goes in at the mic's rate, 16-bit chunks come out.
// The boost (testrun, Oct 3) raises a TV across the room towards -20 dB, never
// by more than 20 dB, and with it off the output is exactly as it was.

const SOURCE = readFileSync(new URL("../public/pcm-capture-worklet.js", import.meta.url), "utf8");
const INPUT_RATE = 48_000;

interface Processor {
  process(inputs: Float32Array[][]): boolean;
}

function worklet(boost: boolean) {
  const chunks: Int16Array[] = [];
  const levels: Array<{ speechDb: number; gainDb: number }> = [];
  let Registered: (new (options: unknown) => Processor) | null = null;
  class AudioWorkletProcessor {
    port = {
      postMessage: (message: unknown) => {
        if (message instanceof ArrayBuffer) chunks.push(new Int16Array(message));
        else levels.push(message as { speechDb: number; gainDb: number });
      },
      onmessage: null as unknown,
    };
  }
  runInNewContext(SOURCE, {
    AudioWorkletProcessor,
    sampleRate: INPUT_RATE,
    registerProcessor: (_name: string, processor: new (options: unknown) => Processor) => (Registered = processor),
    Math,
    Float32Array,
    Int16Array,
  });
  const processor = new Registered!({ processorOptions: { chunkMs: 50, targetSampleRate: 16_000, boost } });
  return { processor, chunks, levels };
}

/** Feeds `seconds` of a 300 Hz tone at `db` (RMS), in 128-frame render quanta. */
function feed(processor: Processor, db: number, seconds: number) {
  const amplitude = Math.pow(10, db / 20) * Math.SQRT2;
  const frames = Math.round(INPUT_RATE * seconds);
  for (let start = 0; start < frames; start += 128) {
    const block = new Float32Array(128);
    for (let i = 0; i < 128; i++) block[i] = amplitude * Math.sin((2 * Math.PI * 300 * (start + i)) / INPUT_RATE);
    processor.process([[block]]);
  }
}

/** RMS of the last `seconds` of output, in dB of full scale. */
function outputDb(chunks: Int16Array[], seconds: number) {
  const samples = chunks.flatMap((chunk) => Array.from(chunk)).slice(-Math.round(16_000 * seconds));
  const rms = Math.sqrt(samples.reduce((sum, s) => sum + (s / 32768) ** 2, 0) / samples.length);
  return 20 * Math.log10(rms);
}

describe("the boost for a TV across the room", () => {
  it("raises quiet speech towards -20 dB", () => {
    const { processor, chunks, levels } = worklet(true);
    feed(processor, -40, 12);
    expect(outputDb(chunks, 2)).toBeGreaterThan(-24);
    expect(outputDb(chunks, 2)).toBeLessThan(-18);
    expect(levels.at(-1)!.gainDb).toBeGreaterThan(15);
  });

  it("never adds more than 20 dB, however quiet", () => {
    const { processor, chunks, levels } = worklet(true);
    feed(processor, -55, 15);
    expect(levels.at(-1)!.gainDb).toBeLessThanOrEqual(20.01);
    expect(outputDb(chunks, 2)).toBeLessThan(-34);
  });

  it("leaves a signal that is already loud alone", () => {
    const { processor, chunks, levels } = worklet(true);
    feed(processor, -14, 6);
    expect(levels.at(-1)!.gainDb).toBeLessThan(0.5);
    expect(outputDb(chunks, 2)).toBeCloseTo(-14, 0);
  });

  it("comes down fast when a quiet stretch turns loud, without clipping", () => {
    const { processor, chunks } = worklet(true);
    feed(processor, -45, 10);
    feed(processor, -8, 2);
    const last = chunks.flatMap((chunk) => Array.from(chunk)).slice(-16_000);
    expect(Math.max(...last.map(Math.abs))).toBeLessThan(32_767);
  });

  it("with the boost off, the output is the input, as before, and still reports the level", () => {
    const { processor, chunks, levels } = worklet(false);
    feed(processor, -40, 6);
    expect(outputDb(chunks, 2)).toBeCloseTo(-40, 0);
    expect(levels.at(-1)!.gainDb).toBe(0);
    expect(levels.at(-1)!.speechDb).toBeGreaterThan(-42);
  });
});
