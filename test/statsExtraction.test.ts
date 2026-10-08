import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { cleanFootballStats, FOOTBALL_KEY_GROUPS, FOOTBALL_STAT_KEYS, isEmptyStats } from "@/lib/cards/statKeys";
import { extractStats, mergeNumberReads, normalizeNumbers, statsContent } from "@/lib/stats/extractStats";
import {
  FOOTBALL_STATS_SCHEMA,
  FOOTBALL_STATS_SYSTEM_PROMPT,
  STATS_SCHEMA,
  STATS_SYSTEM_PROMPT,
} from "@/lib/stats/statsPrompt";
import { statsKindFor } from "@/lib/stats/types";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

// =============================================================================
// Reading a season stats sheet. Football comes back as numbers on the stat keys
// in docs/V3_DEFINITION.md 9.2; the spec, the code and the database each keep
// that list, and these keep the three in step.
// =============================================================================

describe("the football stat keys", () => {
  it("are exactly the list in docs/V3_DEFINITION.md 9.2", () => {
    const spec = readFileSync(`${ROOT}docs/V3_DEFINITION.md`, "utf8");
    const section = spec.split("### 9.2")[1].split("###")[0];
    const listed = /`(gp,[^`]+)`/.exec(section)![1].split(",").map((key) => key.trim());
    expect([...FOOTBALL_STAT_KEYS]).toEqual(listed);
  });

  it("are exactly the keys clean_season_stats keeps in the database", () => {
    // The newest migration that defines the function is what the database runs.
    const dir = `${ROOT}db/migrations/`;
    const latest = readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .filter((file) => readFileSync(dir + file, "utf8").includes("function public.clean_season_stats"))
      .at(-1)!;
    const sql = readFileSync(dir + latest, "utf8");
    const list = sql.split("key = any (array[")[1].split("])")[0];
    const keys = [...list.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect([...FOOTBALL_STAT_KEYS]).toEqual(keys);
  });
});

describe("cleanFootballStats", () => {
  it("keeps finite numbers on known keys and drops everything else", () => {
    expect(
      cleanFootballStats({ rush_att: 64, rush_yds: -3, yards_per_carry: 6.5, tkl: "12", rec: Number.NaN, sacks: 4.5 }),
    ).toEqual({ rush_att: 64, rush_yds: -3, sacks: 4.5 });
  });

  it("is null when nothing is left", () => {
    expect(cleanFootballStats({ nope: 1 })).toBeNull();
    expect(cleanFootballStats(null)).toBeNull();
    expect(cleanFootballStats([1, 2])).toBeNull();
  });

  it("counts a player of only zeros as empty", () => {
    expect(isEmptyStats({ gp: 0, tkl: 0 })).toBe(true);
    expect(isEmptyStats({ gp: 0, tkl: 1 })).toBe(false);
  });
});

type Node = Record<string, unknown>;

function walk(node: unknown): Node[] {
  if (typeof node !== "object" || node === null) return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  return [node as Node, ...Object.values(node).flatMap(walk)];
}

describe("the stats schemas", () => {
  for (const [name, schema] of [
    ["football", FOOTBALL_STATS_SCHEMA],
    ["lines", STATS_SCHEMA],
  ] as const) {
    it(`${name}: never pairs an enum with a nullable type (the trap in CLAUDE.md)`, () => {
      for (const node of walk(schema)) {
        if (Array.isArray(node.enum)) expect(Array.isArray(node.type)).toBe(false);
      }
    });

    it(`${name}: closes every object`, () => {
      for (const node of walk(schema)) {
        if (node.type === "object") expect(node.additionalProperties).toBe(false);
      }
    });
  }

  it("football: offers exactly the 9.2 keys, and nothing in a stat is nullable", () => {
    const stat = FOOTBALL_STATS_SCHEMA.properties.players.items.properties.stats.items;
    expect(stat.properties.key.enum).toEqual([...FOOTBALL_STAT_KEYS]);
    expect(stat.properties.value.type).toBe("number");
  });

  it("football keeps the rules about columns, team totals and never inventing", () => {
    expect(FOOTBALL_STATS_SYSTEM_PROMPT).toMatch(/Columns matter/);
    expect(FOOTBALL_STATS_SYSTEM_PROMPT).toMatch(/Opponents/);
    expect(FOOTBALL_STATS_SYSTEM_PROMPT).toMatch(/Never invent, round, or estimate/);
    expect(FOOTBALL_STATS_SYSTEM_PROMPT).toMatch(/warning naming the jersey/);
  });
});

describe("normalizeNumbers", () => {
  it("builds each player's stats from the pairs, dropping unknown keys and repeats", () => {
    const { blocks } = normalizeNumbers({
      players: [
        {
          jersey: "22",
          last_name: "Langan",
          stats: [
            { key: "rush_att", value: 64 },
            { key: "rush_yds", value: 420 },
            { key: "rush_att", value: 99 },
            { key: "ypc", value: 6.5 },
          ],
        },
      ],
      warnings: [" #44 is not on the roster. ", ""],
    });
    expect(blocks).toEqual([{ jersey: "22", last_name: "Langan", stats: { rush_att: 64, rush_yds: 420 } }]);
  });

  it("skips a player with nothing but zeros, and one with no surname", () => {
    const result = normalizeNumbers({
      players: [
        { jersey: "5", last_name: "Zero", stats: [{ key: "tkl", value: 0 }] },
        { jersey: "6", last_name: " ", stats: [{ key: "tkl", value: 3 }] },
      ],
      warnings: [" #44 is not on the roster. ", ""],
    });
    expect(result.blocks).toEqual([]);
    expect(result.warnings).toEqual(["#44 is not on the roster."]);
  });
});

describe("what Claude is sent", () => {
  it("a PDF goes as the document itself, never as its text layer", () => {
    const content = statsContent({ kind: "pdf", base64: "JVBERi0=" }, "Read this.");
    expect(content[0]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" },
    });
    expect(content.filter((block) => block.type === "text")).toEqual([{ type: "text", text: "Read this." }]);
  });

  it("screenshots go as images, pasted text and spreadsheet rows as text", () => {
    const images = statsContent({ kind: "images", images: [{ mediaType: "image/png", base64: "iVBO" }] }, "Read this.");
    expect(images.map((block) => block.type)).toEqual(["image", "text"]);
    const text = statsContent({ kind: "text", text: "Name | Car | Yds" }, "Read this.");
    expect(text).toHaveLength(1);
    expect(text[0].type === "text" && text[0].text).toContain("Name | Car | Yds");
  });

  it("every other sport gets one lines call, at low effort", async () => {
    const { client, calls } = fakeClient(() => ({ players: [], warnings: [] }));
    await extractStats(client, { kind: "text", text: "x" }, ROSTER, statsKindFor("volleyball"), SIGNAL);
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(STATS_SYSTEM_PROMPT);
    expect(calls[0].output_config.format.schema).toBe(STATS_SCHEMA);
    expect(calls[0].output_config.effort).toBe("low");
  });
});

// =============================================================================
// Football is read in three calls at once, one per group of keys, because one
// call writing every number on a real seven page MaxPreps sheet ran past the
// route's time limit.
// =============================================================================

type Call = {
  system: string;
  messages: Array<{ content: Array<{ type: string; text?: string }> }>;
  output_config: { effort?: string; format: { schema: unknown } };
};

const ROSTER = [
  { jersey: "8", first_name: "Ben", last_name: "Mikail" },
  { jersey: "0", first_name: "Rory", last_name: "Sullivan" },
];
const SIGNAL = new AbortController().signal;

/** The enum a call's schema offers for stat keys: which group the call is for. */
function keysOf(call: Call): string[] {
  const schema = call.output_config.format.schema as typeof FOOTBALL_STATS_SCHEMA;
  return [...schema.properties.players.items.properties.stats.items.properties.key.enum];
}

function fakeClient(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const create = vi.fn(async (params: Call) => {
    calls.push(params);
    const reply = answer(params);
    if (reply instanceof Error) throw reply;
    return { stop_reason: "end_turn", usage: { output_tokens: 100 }, content: [{ type: "text", text: JSON.stringify(reply) }] };
  });
  return { client: { messages: { create } } as unknown as Anthropic, calls };
}

describe("football's key groups", () => {
  it("cover every 9.2 key exactly once", () => {
    const grouped = FOOTBALL_KEY_GROUPS.flatMap((group) => [...group.keys]);
    expect([...grouped].sort()).toEqual([...FOOTBALL_STAT_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

describe("the football prompt", () => {
  it("leaves zeros out, and skips the sections that only repeat numbers", () => {
    expect(FOOTBALL_STATS_SYSTEM_PROMPT).toMatch(/Leave out any stat that is 0 or blank/);
    for (const section of ["All Purpose Yards", "Total Yards", "Scoring", "Touchdowns", "Conversions", "Pancake Blocks"]) {
      expect(FOOTBALL_STATS_SYSTEM_PROMPT).toContain(section);
    }
    expect(FOOTBALL_STATS_SYSTEM_PROMPT).not.toMatch(/Write 0 only/);
  });
});

describe("reading football", () => {
  it("makes one call per group, each offered only its own keys and told its own sections", async () => {
    const { client, calls } = fakeClient(() => ({ players: [], warnings: [] }));
    await extractStats(client, { kind: "pdf", base64: "JVBERi0=" }, ROSTER, "numbers", SIGNAL);
    expect(calls).toHaveLength(FOOTBALL_KEY_GROUPS.length);
    calls.forEach((call, index) => {
      const group = FOOTBALL_KEY_GROUPS[index];
      expect(call.system).toBe(FOOTBALL_STATS_SYSTEM_PROMPT);
      expect(call.output_config.effort).toBe("low");
      expect(keysOf(call)).toEqual([...group.keys]);
      const instruction = call.messages[0].content.find((block) => block.type === "text")?.text ?? "";
      expect(instruction).toContain(group.sections);
      expect(instruction).toContain("#8 Mikail, Ben");
      // Every call reads the whole sheet as pages.
      expect(call.messages[0].content[0].type).toBe("document");
    });
  });

  it("joins one player's groups into one block, and keeps each warning once", async () => {
    const { client } = fakeClient((call) => {
      const keys = keysOf(call);
      if (keys.includes("pass_att")) {
        return {
          players: [
            { jersey: "8", last_name: "Mikail", stats: [{ key: "pass_att", value: 147 }, { key: "pass_yds", value: 990 }] },
            { jersey: "0", last_name: "Sullivan", stats: [{ key: "rush_att", value: 28 }] },
          ],
          warnings: ["#44 J. Smith is not on the roster."],
        };
      }
      if (keys.includes("tkl")) {
        return {
          // A key from another group is ignored: that call reads it.
          players: [{ jersey: "0", last_name: "R. Sullivan", stats: [{ key: "tkl", value: 16 }, { key: "rush_att", value: 99 }] }],
          warnings: ["#44 J. Smith is not on the roster."],
        };
      }
      return { players: [{ jersey: "8", last_name: "Mikail", stats: [{ key: "punts", value: 3 }] }], warnings: [] };
    });

    const result = await extractStats(client, { kind: "pdf", base64: "JVBERi0=" }, ROSTER, "numbers", SIGNAL);
    expect(result.kind).toBe("numbers");
    expect(result.blocks).toEqual([
      { jersey: "8", last_name: "Mikail", stats: { pass_att: 147, pass_yds: 990, punts: 3 } },
      { jersey: "0", last_name: "Sullivan", stats: { rush_att: 28, tkl: 16 } },
    ]);
    expect(result.warnings).toEqual(["#44 J. Smith is not on the roster."]);
    expect(result.usage).toEqual({ calls: 3, outputTokens: 300 });
  });

  it("fails the whole import when one group's call fails, with that call's code", async () => {
    const { client } = fakeClient((call) =>
      keysOf(call).includes("tkl") ? new Error("boom") : { players: [], warnings: [] },
    );
    await expect(
      extractStats(client, { kind: "pdf", base64: "JVBERi0=" }, ROSTER, "numbers", SIGNAL),
    ).rejects.toMatchObject({ code: "unknown" });
  });
});

describe("mergeNumberReads", () => {
  it("keeps the first value if a key ever came back twice", () => {
    const merged = mergeNumberReads([
      { kind: "numbers", blocks: [{ jersey: "8", last_name: "Mikail", stats: { gp: 5 } }], warnings: [] },
      { kind: "numbers", blocks: [{ jersey: "#8", last_name: "B. Mikail", stats: { gp: 4, tkl: 2 } }], warnings: [] },
    ]);
    expect(merged.blocks).toEqual([{ jersey: "8", last_name: "Mikail", stats: { gp: 5, tkl: 2 } }]);
  });
});
