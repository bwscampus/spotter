import { describe, expect, it } from "vitest";
import { MAX_WINDOW } from "@/lib/plays/window";
import {
  MAX_ALIAS_LENGTH,
  MAX_ALIASES,
  MAX_ROSTER_PLAYERS,
  MAX_UTTERANCE_LENGTH,
  readRequest,
} from "@/lib/livestats/request";
import { MAX_PLAY_UTTERANCES } from "@/lib/rosters/extractErrors";

// What one POST /api/livestats/extract may carry (docs/PRE_LAUNCH_AUDIT.md H2):
// 30 utterances of 400 characters, 300 players, 4 heard-as forms of 40
// characters each. Before Oct 7 a crafted call could reach about 120,000
// input tokens.

const player = (i: number, extra: Record<string, unknown> = {}) => ({
  playerId: `H${i}-P${i}`,
  side: "home",
  jersey: String(i),
  first: "Sam",
  last: `P${i}`,
  position: "RB",
  ...extra,
});

const said = (count: number, text = "first and ten") =>
  Array.from({ length: count }, (_, seq) => ({ seq, text, offsetMs: seq * 1000 }));

function parse(body: unknown) {
  const parsed = readRequest(body);
  if (parsed === null || parsed === "too_long") throw new Error(`expected a request, got ${String(parsed)}`);
  return parsed;
}

describe("the caps", () => {
  it("are the numbers the audit asked for", () => {
    expect(MAX_PLAY_UTTERANCES).toBe(30);
    expect(MAX_UTTERANCE_LENGTH).toBe(400);
    expect(MAX_ROSTER_PLAYERS).toBe(300);
    expect(MAX_ALIASES).toBe(4);
    expect(MAX_ALIAS_LENGTH).toBe(40);
  });

  it("never refuse the loop's own window", () => {
    expect(MAX_WINDOW).toBeLessThanOrEqual(MAX_PLAY_UTTERANCES);
  });
});

describe("utterances", () => {
  it("takes 30 and refuses 31 as too long", () => {
    expect(parse({ utterances: said(30), rosters: [player(1)] }).utterances).toHaveLength(30);
    expect(readRequest({ utterances: said(31), rosters: [player(1)] })).toBe("too_long");
  });

  it("cuts a long utterance to 400 characters rather than lose the whole read", () => {
    const parsed = parse({ utterances: said(2, "a".repeat(5_000)), rosters: [player(1)] });
    expect(parsed.utterances.map((utterance) => utterance.text.length)).toEqual([400, 400]);
  });
});

describe("rosters", () => {
  it("takes 300 players and refuses 301", () => {
    const players = Array.from({ length: 301 }, (_, i) => player(i));
    expect(parse({ utterances: said(1), rosters: players.slice(0, 300) }).rosters).toHaveLength(300);
    expect(readRequest({ utterances: said(1), rosters: players })).toBeNull();
  });

  it("keeps the first four heard-as forms and drops any over 40 characters", () => {
    const aliases = ["vecksley", "x".repeat(41), "vexly", "veksli", "vecksly", "vexlee"];
    const parsed = parse({ utterances: said(1), rosters: [player(7, { aliases })] });
    expect(parsed.rosters[0].aliases).toEqual(["vecksley", "vexly", "veksli", "vecksly"]);
  });

  it("keeps a form of exactly 40 characters", () => {
    const parsed = parse({ utterances: said(1), rosters: [player(7, { aliases: ["y".repeat(40)] })] });
    expect(parsed.rosters[0].aliases).toEqual(["y".repeat(40)]);
  });
});
