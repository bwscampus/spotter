import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isHaiku, openRouterBody } from "@/lib/livestats/openrouter";
import { HAIKU_READER_NOTES, STATS_SYSTEM_PROMPT } from "@/lib/livestats/prompt";
import { allSettings, GEMINI_FLASH_MODEL } from "@/lib/livestats/settings";
import type { ExtractStatsRequest } from "@/lib/livestats/types";

// =============================================================================
// Haiku's own reader notes (HAIKU_READER_NOTES in lib/livestats/prompt.ts, a
// test on testrun2, Oct 10). Only Claude Haiku gets them; Gemini's system
// message is held byte for byte to the snapshot taken before they were added.
// =============================================================================

/** The request the snapshot was taken with; made-up players. */
const REQUEST: ExtractStatsRequest = {
  utterances: [{ seq: 0, text: "first and ten", offsetMs: 0 }],
  rosters: [
    { playerId: "H22-LANGAN", side: "home", jersey: "22", first: "Sam", last: "Langan", position: "RB" },
    { playerId: "A7-ORTEGA", side: "away", jersey: "7", first: "Milo", last: "Ortega", position: "QB" },
  ],
  recentPlays: [],
};

type TextPart = { type: "text"; text: string; cache_control?: { type: string } };

function systemOf(model: string, effort: string): TextPart[] {
  const body = openRouterBody(REQUEST, { model, effort } as never);
  return body.messages[0].content as TextPart[];
}

describe("Haiku's reader notes", () => {
  it("leave Gemini's system message exactly as it was", () => {
    const snapshot = readFileSync(new URL("./fixtures/gemini-stats-system.json", import.meta.url), "utf8");
    const body = openRouterBody(REQUEST, { model: GEMINI_FLASH_MODEL, effort: "minimal" });
    expect(JSON.stringify(body.messages[0], null, 2) + "\n").toBe(snapshot);
    expect(JSON.stringify(body.messages[0])).not.toContain("MORE ON READING EACH PLAY");
  });

  it("go to Haiku at every effort, between the instructions and the cached rosters", () => {
    const haiku = allSettings().filter((setting) => isHaiku(setting.model));
    expect(haiku.map((setting) => setting.effort)).toEqual(["low", "medium"]);
    for (const setting of haiku) {
      const system = systemOf(setting.model, setting.effort);
      expect(system.map((part) => part.text.slice(0, 20))).toEqual([
        STATS_SYSTEM_PROMPT.slice(0, 20),
        HAIKU_READER_NOTES.slice(0, 20),
        expect.any(String),
      ]);
      expect(system[1].text).toBe(HAIKU_READER_NOTES);
      // The cache mark stays on the last block, so the notes are inside the cached prefix.
      expect(system.map((part) => part.cache_control?.type ?? null)).toEqual([null, null, "ephemeral"]);
      // Apart from the notes, Haiku's system message is Gemini's.
      expect([system[0], system[2]]).toEqual(systemOf(GEMINI_FLASH_MODEL, "minimal"));
    }
  });

  it("only Haiku is Haiku", () => {
    expect(isHaiku("anthropic/claude-haiku-5.5")).toBe(true);
    expect(isHaiku(GEMINI_FLASH_MODEL)).toBe(false);
    expect(isHaiku("anthropic/claude-sonnet-5")).toBe(false);
  });

  it("cover the four points, and only those", () => {
    const points = HAIKU_READER_NOTES.split("\n").filter((line) => line.startsWith("- "));
    expect(points).toHaveLength(4);
    expect(points[0]).toMatch(/enough to return the play/);
    expect(points[0]).toMatch(/below 0\.5/);
    expect(points[1]).toMatch(/Credit only the player who had the ball/);
    expect(points[2]).toMatch(/sounds closest/);
    expect(points[3]).toMatch(/before the first "\|"/);
  });

  it("name nobody from the test fixtures' rosters", () => {
    const log = JSON.parse(readFileSync(new URL("./fixtures/g5-synthetic-log.json", import.meta.url), "utf8")) as unknown;
    const names = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          if (["first", "last", "first_name", "last_name", "name"].includes(key) && typeof inner === "string") {
            for (const word of inner.toLowerCase().split(/[^a-z']+/)) if (word.length > 1) names.add(word);
          } else walk(inner);
        }
      }
    };
    walk(log);
    expect(names.size).toBeGreaterThan(10);
    const words = new Set(HAIKU_READER_NOTES.toLowerCase().split(/[^a-z']+/));
    expect([...names].filter((name) => words.has(name))).toEqual([]);
  });
});
