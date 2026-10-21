import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderExamples, WORKED_EXAMPLES } from "@/lib/livestats/extract/examples";
import { EXTRACT_SYSTEM_PROMPT } from "@/lib/livestats/extract/prompt";
import { cachedPrefix, segmentChatRequest } from "@/lib/livestats/extract/run";
import { renderSegmentUser, type SegmentRequest } from "@/lib/livestats/extract/request";
import { DEFAULT_V7_MODEL_A } from "@/lib/livestats/settings";

// The extractor's prompt (v7, Part 5): under 600 words, never "high school",
// fourteen worked examples with made-up names, and a cached prefix of about
// 2,500 tokens. When the test set is on this machine, no name from any of
// its rosters appears in the examples.

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Words of the game that are also somebody's surname somewhere (a Rush, a Pass, a Block). */
const FOOTBALL_WORDS = ["rush", "pass", "sack", "block", "back", "ball", "down", "line", "kick", "punt", "snap", "drive", "home", "away", "deep", "free", "hand", "move", "over"];

describe("the system prompt", () => {
  it("is under 600 words and names six rules", () => {
    expect(words(EXTRACT_SYSTEM_PROMPT)).toBeLessThan(600);
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/Six rules/);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(EXTRACT_SYSTEM_PROMPT).toMatch(new RegExp(`^${n}\\. `, "m"));
  });

  it("credits a name said after the result (fix 1, Part 4)", () => {
    const rule1 = EXTRACT_SYSTEM_PROMPT.split("\n").find((line) => line.startsWith("1. "))!;
    expect(rule1).toMatch(/PLAY or POST lines name a candidate as the one who ran, caught or threw, credit him/);
    expect(rule1).toMatch(/even when the name comes after the result/);
    expect(rule1).toMatch(/NOT_NAMED only when no candidate is named doing it/);
  });

  it("lets a name said before the snap be credited only when the play goes to his role (fix 1, Part 1)", () => {
    const rule1 = EXTRACT_SYSTEM_PROMPT.split("\n").find((line) => line.startsWith("1. "))!;
    expect(rule1).toMatch(/named before snap/);
    expect(rule1).toMatch(/PLAY lines send the play to his role/);
    expect(rule1).toMatch(/never just because he was mentioned before the snap/);
  });

  it("never says high school, and says the lines are the only source", () => {
    expect(`${EXTRACT_SYSTEM_PROMPT}\n${renderExamples()}`.toLowerCase()).not.toContain("high school");
    expect(EXTRACT_SYSTEM_PROMPT).toMatch(/only source/);
  });
});

describe("the worked examples", () => {
  it("are fourteen, each answering with the schema's fields and a candidate list that ends with NOT_NAMED", () => {
    expect(WORKED_EXAMPLES).toHaveLength(14);
    for (const example of WORKED_EXAMPLES) {
      expect(Object.keys(example.answer).sort()).toEqual(["carrierIdx", "confidence", "passerIdx", "penalty", "playType", "receiverIdx", "tacklerIdx", "touchdown", "yardsSaid"]);
      expect(example.candidates[example.candidates.length - 1]).toBe("0: NOT_NAMED");
      expect(example.lines.some((line) => line.role === "play")).toBe(true);
    }
  });

  it("cover the patterns the brief lists", () => {
    const titles = WORKED_EXAMPLES.map((example) => example.title.toLowerCase());
    for (const pattern of ["plain run", "jersey number", "hauls it in", "named target", "broken up", "sack", "interception", "wipes the play", "nobody is named", "replay talk", "shared surname", "touchdown run"]) {
      expect(titles.some((title) => title.includes(pattern)), pattern).toBe(true);
    }
    // Fix 1, Part 4: a run and a completion whose player is named only in the POST lines.
    const after = WORKED_EXAMPLES.filter((example) => example.title.includes("named only after the result"));
    expect(after.map((example) => example.answer.playType).sort()).toEqual(["pass_complete", "rush"]);
    for (const example of after) {
      const play = example.lines.filter((line) => line.role === "play").map((line) => line.text).join(" ");
      const post = example.lines.filter((line) => line.role === "post").map((line) => line.text).join(" ");
      const credited = example.answer.carrierIdx ?? example.answer.receiverIdx!;
      const surname = example.candidates.find((candidate) => candidate.startsWith(`${credited}: `))!.split(" ")[3].toLowerCase();
      expect(play).not.toContain(surname);
      expect(post).toContain(surname);
    }
    const notNamed = WORKED_EXAMPLES.find((example) => example.title.includes("nobody"))!;
    expect(notNamed.answer.carrierIdx).toBe(0);
    const replay = WORKED_EXAMPLES.find((example) => example.title.includes("replay"))!;
    expect(replay.answer.receiverIdx).toBe(2);
  });

  it("use no name from a roster in the test set, when the set is on this machine", () => {
    const folder = join(homedir(), "SpotterTestSet");
    if (!existsSync(folder)) return;
    const names = new Set<string>();
    const walk = (dir: string, depth: number) => {
      if (depth > 2) return;
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, name.name);
        if (name.isDirectory()) walk(path, depth + 1);
        else if (name.name.endsWith(".json") && !name.name.endsWith(".truth.json")) collect(path);
      }
    };
    const collect = (path: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        return;
      }
      const visit = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (typeof value !== "object" || value === null) return;
        const record = value as Record<string, unknown>;
        for (const key of ["last", "last_name", "first", "first_name"]) if (typeof record[key] === "string" && record[key].length >= 4) names.add((record[key] as string).toLowerCase());
        Object.values(record).forEach(visit);
      };
      visit(parsed);
    };
    walk(folder, 0);
    // A real surname that is also a word every example needs ("rush", "pass") is
    // not a leaked name: the examples cannot describe a run without it.
    for (const word of FOOTBALL_WORDS) names.delete(word);
    const text = renderExamples().toLowerCase();
    const leaked = [...names].filter((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
    expect(leaked).toEqual([]);
  });
});

describe("the cached prefix", () => {
  const request: SegmentRequest = {
    look: "segment",
    segment: { id: "seg-1-2", lines: [{ seq: 0, text: "second and 4", role: "pre" }, { seq: 1, text: "fennimore up the middle for 6", role: "play" }, { seq: 2, text: "third and 1", role: "post" }], dd: { down: 2, distance: 4, isGoal: false } },
    candidates: [{ idx: 1, playerId: "H22-FENNIMORE", label: "#22 Reed Fennimore RB HOME", heardAs: [], score: 1, side: "home", tags: [] }, { idx: 0, playerId: null, label: "NOT_NAMED", heardAs: [], score: 0, side: null, tags: [] }],
    gameState: { offense: "home", down: 2, distance: 4 },
  };

  it("is about 2,500 tokens, the same bytes every call, with the cache breakpoint on it", () => {
    const prefix = cachedPrefix();
    // About four characters a token: between 1,500 and 4,000 tokens.
    expect(prefix.length / 4).toBeGreaterThan(1_500);
    expect(prefix.length / 4).toBeLessThan(4_000);
    const a = segmentChatRequest(request, DEFAULT_V7_MODEL_A);
    const b = segmentChatRequest({ ...request, segment: { ...request.segment, id: "seg-9-9" } }, DEFAULT_V7_MODEL_A);
    expect(a.system).toEqual(b.system);
    expect((a.system as Array<{ cache_control?: unknown }>)[0].cache_control).toEqual({ type: "ephemeral" });
    expect(a.maxTokens).toBe(1_500);
  });

  it("puts the game state, the marked lines and the candidates in the user message, with no roster block", () => {
    const user = renderSegmentUser(request);
    expect(user).toMatch(/GAME STATE/);
    expect(user).toMatch(/PRE\t0\tsecond and 4/);
    expect(user).toMatch(/PLAY\t1\tfennimore up the middle for 6/);
    expect(user).toMatch(/1: #22 Reed Fennimore RB HOME/);
    expect(user).toMatch(/0: NOT_NAMED/);
    expect(user).not.toMatch(/THE TWO ROSTERS|PLAYS ALREADY APPLIED/);
  });
});
