import { describe, expect, it } from "vitest";
import type { DeepgramResults } from "@/lib/deepgram/config";
import { createLogWriter, FLUSH_AT_RECORDS, FLUSH_DELAY_MS, type LogSink } from "@/lib/log/gameLog";
import {
  downloadName,
  resultRecord,
  toDeepgramResults,
  toMatchLogCsv,
  toReplayFile,
  type LogRecord,
  type StoredRecord,
} from "@/lib/log/records";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import { buildGameWatchlist } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";

// The browser log. Made-up names only.

const GAME = "5f0c1a52-8d1e-4a57-9d6f-2a8f6e0c9b11";

function fakeSink() {
  const batches: LogRecord[][] = [];
  const sink: LogSink = {
    put: async (records) => {
      batches.push(records);
    },
  };
  return { sink, batches };
}

function fakeTimers() {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  return { timers, delay: (fn: () => void, ms: number) => timers.push({ fn, ms }) };
}

const utterance = (text: string, at = 1): LogRecord => ({ kind: "utterance", gameId: GAME, at, connectionId: 1, text, offsetMs: 0 });

describe("the log writer", () => {
  it("does no I/O on push: nothing reaches the sink until the timer fires", () => {
    const { sink, batches } = fakeSink();
    const { timers, delay } = fakeTimers();
    const writer = createLogWriter(sink, { delay });
    writer.push(utterance("first"));
    writer.push(utterance("second"));
    expect(batches).toEqual([]);
    expect(writer.pending()).toBe(2);
    // One timer for the whole batch, not one per record.
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(FLUSH_DELAY_MS);
  });

  it("writes the whole batch in one go, in order, when the timer fires", async () => {
    const { sink, batches } = fakeSink();
    const { timers, delay } = fakeTimers();
    const writer = createLogWriter(sink, { delay });
    writer.push(utterance("first"));
    writer.push(utterance("second"));
    timers[0].fn();
    await writer.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0].map((record) => (record.kind === "utterance" ? record.text : ""))).toEqual(["first", "second"]);
    expect(writer.pending()).toBe(0);
  });

  it("sends a long buffer straight away rather than holding it", async () => {
    const { sink, batches } = fakeSink();
    const { delay } = fakeTimers();
    const writer = createLogWriter(sink, { delay });
    for (let i = 0; i < FLUSH_AT_RECORDS; i++) writer.push(utterance(`u${i}`));
    await writer.flush();
    expect(batches[0]).toHaveLength(FLUSH_AT_RECORDS);
  });

  it("keeps going when a batch cannot be written", async () => {
    const good = fakeSink();
    let failed = false;
    const sink: LogSink = {
      put: async (records) => {
        if (!failed) {
          failed = true;
          throw new Error("QuotaExceededError");
        }
        return good.sink.put(records);
      },
    };
    const { delay } = fakeTimers();
    const writer = createLogWriter(sink, { delay });
    writer.push(utterance("lost"));
    await writer.flush();
    writer.push(utterance("kept"));
    await writer.flush();
    expect(good.batches).toHaveLength(1);
  });
});

const word = (text: string, start: number, confidence = 0.95) => ({
  word: text,
  punctuated_word: text,
  start,
  end: start + 0.3,
  confidence,
});

const result = (words: string[], isFinal: boolean, start = 0): DeepgramResults => ({
  type: "Results",
  is_final: isFinal,
  speech_final: isFinal,
  start,
  duration: words.length * 0.4,
  channel: {
    alternatives: [
      {
        transcript: words.join(" "),
        confidence: 0.9,
        words: words.map((text, i) => word(text, start + i * 0.4)),
      },
    ],
  },
});

describe("a logged result", () => {
  it("keeps every word with its confidence and timing, is_final, and the socket it came on", () => {
    const record = resultRecord(GAME, result(["langan", "on", "the", "carry"], true, 12), 1_700_000_000_000, 3);
    expect(record).toMatchObject({
      kind: "result",
      gameId: GAME,
      at: 1_700_000_000_000,
      connectionId: 3,
      is_final: true,
      start: 12,
      transcript: "langan on the carry",
    });
    expect(record.words[0]).toEqual({ word: "langan", start: 12, end: 12.3, confidence: 0.95 });
  });

  it("replays through the card path to exactly the cards it put up live", () => {
    const player = (jersey: string, last_name: string) => ({ jersey, last_name, spoken_forms: spokenForms(last_name) });
    const { entries } = buildGameWatchlist([player("22", "Langan"), player("5", "Tremaine")], [player("17", "Okonkwo")]);
    const said = [
      result(["handoff", "langan"], false, 0),
      result(["handoff", "langan", "up", "the", "middle"], true, 0),
      result(["number", "17"], false, 3),
      result(["number", "17", "on", "the", "stop"], true, 3),
      result(["tremaine"], true, 6),
    ];

    const shown = (feed: DeepgramResults[]) => {
      const engine = new SpotterEngine(entries, { sport: "football", teamCues: [] });
      return feed.map((results, i) => {
        const outcome = engine.process(results, 1, i * 1000, i * 1000);
        return outcome.display?.players.map((p) => p.last_name) ?? null;
      });
    };

    const live = shown(said);
    const replayed = shown(said.map((results, i) => toDeepgramResults(resultRecord(GAME, results, i * 1000, 1))));
    expect(replayed).toEqual(live);
    // And it actually put cards up, so the comparison means something.
    expect(live.filter(Boolean).length).toBeGreaterThan(0);
  });
});

describe("the downloads", () => {
  const records: StoredRecord[] = [
    { seq: 3, ...utterance("third", 3) },
    {
      seq: 2,
      kind: "row",
      gameId: GAME,
      at: 2,
      row: {
        at: "2026-09-25T19:03:00.000Z",
        type: "match",
        name: "Langan",
        word: "langan",
        score: 1,
        threshold: 0.85,
        confidence: 0.91,
        source: "interim",
        latencyMs: 812.4,
        domMs: 1.2,
        cue: null,
        cueWord: null,
        slots: ["Langan#0"],
      },
    },
    { seq: 1, ...utterance("first", 1) },
  ];

  it("the .json holds every record in the order it happened, without the storage sequence", () => {
    const file = toReplayFile(GAME, records, new Date("2026-09-25T21:05:00.000Z"));
    expect(file).toMatchObject({ format: "spotter-v3-log", version: 1, gameId: GAME, exportedAt: "2026-09-25T21:05:00.000Z" });
    expect(file.records.map((record) => record.kind)).toEqual(["utterance", "row", "utterance"]);
    expect(file.records.every((record) => !("seq" in record))).toBe(true);
  });

  it("the .csv has V2's match log columns and only the match log rows", () => {
    const [header, ...rows] = toMatchLogCsv(records).split("\r\n");
    expect(header).toBe(
      "timestamp,type,name,word,match_score,threshold,deepgram_confidence,result,cue,cue_word,reason,ms_to_paint,ms_to_dom",
    );
    expect(rows).toEqual(["2026-09-25T19:03:00.000Z,match,Langan,langan,1,0.85,0.91,interim,,,,812.4,1.2"]);
  });

  it("names the files by time and game, never by school or player", () => {
    const at = new Date(2026, 8, 25, 19, 3);
    expect(downloadName("log", GAME, at)).toBe("statcast-log-20260925-1903-5f0c1a52.json");
    expect(downloadName("matches", GAME, at)).toBe("statcast-matches-20260925-1903-5f0c1a52.csv");
  });
});
