import { describe, expect, it, vi } from "vitest";
import { createOpenRouterClient } from "@/lib/ai/openrouter";
import { callRateFor } from "@/lib/cards/callRate";
import { toCardPlayer, type CardSource } from "@/lib/cards/cardPlayer";
import { lineText } from "@/lib/cards/lines";
import { basketballLine, hittingText, seasonLineFor, volleyballLine } from "@/lib/cards/sportLines";
import {
  BASKETBALL_STAT_KEYS,
  cleanSeasonNumbers,
  cleanStatsFor,
  keyGroupsFor,
  numberSport,
  SEASON_STAT_KEYS,
  VOLLEYBALL_STAT_KEYS,
} from "@/lib/cards/sportStats";
import { FOOTBALL_STAT_KEYS } from "@/lib/cards/statKeys";
import { extractStats, normalizeNumbers } from "@/lib/stats/extractStats";
import { buildStatsReview, columnsIn, toSetSeasonStatsArgs } from "@/lib/stats/review";
import { BASKETBALL_STATS_SYSTEM_PROMPT, VOLLEYBALL_STATS_SYSTEM_PROMPT } from "@/lib/stats/statsPrompt";
import { statsKindFor, type StatsExtractResponse } from "@/lib/stats/types";
import { chatReply, fakeFetch } from "./fakeOpenRouter";

// =============================================================================
// Basketball and volleyball season stats as numbers (Nov 2): their keys, what
// the database keeps, the import, the review, the card line, the call rate.
// Made-up names only.
// =============================================================================

describe("the keys", () => {
  it("are numbers for football, basketball, volleyball, ice hockey and soccer, and lines for every other sport", () => {
    expect(["football", "basketball", "volleyball"].map(statsKindFor)).toEqual(["numbers", "numbers", "numbers"]);
    expect(["lacrosse", "baseball", "other", null].map(statsKindFor)).toEqual(["lines", "lines", "lines", "lines"]);
    expect(numberSport("water_polo")).toBeNull();
  });

  it("never share a name with football's but games played, so one sport's number cannot be read as another's", () => {
    const football = new Set<string>(FOOTBALL_STAT_KEYS);
    expect(BASKETBALL_STAT_KEYS.filter((key) => football.has(key))).toEqual(["gp"]);
    expect(VOLLEYBALL_STAT_KEYS.filter((key) => football.has(key))).toEqual(["gp"]);
    expect(new Set(SEASON_STAT_KEYS).size).toBe(SEASON_STAT_KEYS.length);
  });

  it("clean to the sport's own keys, and a stored row keeps whichever sport's it holds", () => {
    expect(cleanStatsFor("basketball", { pts: 184, rush_yds: 40, ppg: 18.4, reb: "9" })).toEqual({ pts: 184 });
    expect(cleanStatsFor("volleyball", { kills: 312, pts: 10 })).toEqual({ kills: 312 });
    expect(cleanSeasonNumbers({ kills: 312, pts: 184, nope: 1 })).toEqual({ pts: 184, kills: 312 });
    expect(cleanStatsFor("basketball", { nope: 1 })).toBeNull();
  });

  it("are read in one call each: a basketball or volleyball sheet is a page or two", () => {
    expect(keyGroupsFor("basketball")).toHaveLength(1);
    expect(keyGroupsFor("volleyball")).toHaveLength(1);
    expect(keyGroupsFor("football")).toHaveLength(3);
  });
});

describe("the basketball card line", () => {
  it("reads per game when games played are known, scoring first, with the shooting that has enough attempts", () => {
    const line = basketballLine({ gp: 10, pts: 184, fg_made: 70, fg_att: 150, three_made: 22, three_att: 54, ft_made: 22, ft_att: 30, reb: 61, ast: 44, stl: 21, blk: 3 });
    expect(lineText(line)).toBe("18.4 ppg · 47% FG · 41% 3PT · 73% FT · 6.1 rpg · 4.4 apg · 2.1 spg · 0.3 bpg");
    expect(line[0].group).toBe(0);
  });

  it("reads totals with no games played, counts threes too few to rate, and adds offensive and defensive boards", () => {
    expect(lineText(basketballLine({ pts: 98, three_made: 4, three_att: 6, oreb: 10, dreb: 30 }))).toBe("98 pts · 4 3PM · 40 reb");
  });

  it("puts the biggest group first: a rebounder's rebounds lead", () => {
    expect(lineText(basketballLine({ gp: 10, pts: 40, reb: 98 }))).toBe("9.8 rpg · 4.0 ppg");
  });

  it("is empty with nothing, and never shows a zero", () => {
    expect(basketballLine(null)).toEqual([]);
    expect(basketballLine({ gp: 10, pts: 0 })).toEqual([]);
  });
});

describe("the volleyball card line", () => {
  it("reads totals, kills per set and hitting beside the kills, then each group biggest first", () => {
    const line = volleyballLine({ gp: 20, sets: 80, kills: 312, attack_err: 80, attack_att: 820, aces: 41, digs: 120, solo_blocks: 10, block_assists: 15 });
    expect(lineText(line)).toBe("312 kills · 3.9 per set · hitting .283 · 120 digs · 41 aces · 17.5 blocks");
  });

  it("writes hitting percentage the way it is printed", () => {
    expect(hittingText(10, 2, 20)).toBe(".400");
    expect(hittingText(2, 4, 20)).toBe("-.100");
    expect(hittingText(20, 0, 20)).toBe("1.000");
  });

  it("leads a setter with assists, and uses the sheet's own total blocks", () => {
    expect(lineText(volleyballLine({ assists: 804, digs: 90, blocks: 12, solo_blocks: 1 }))).toBe("804 assists · 90 digs · 12 blocks");
  });
});

describe("the card", () => {
  const source = (extra: Partial<CardSource>): CardSource => ({
    jersey: "22",
    first_name: "Devin",
    last_name: "Quintero",
    position: "G",
    grade: null,
    height: null,
    weight: null,
    pronunciations: [],
    season_stats: null,
    season_lines: [],
    stats_as_of: null,
    ...extra,
  });

  it("builds a basketball card's season from its numbers", () => {
    const card = toCardPlayer(source({ season_stats: { gp: 10, pts: 210 } }), "basketball", "H");
    expect(card.stat_lines).toEqual(["21.0 ppg"]);
    expect(card.face?.seasonText).toBe("");
  });

  it("keeps the lines a basketball team saved before Nov 2 until it imports again", () => {
    const card = toCardPlayer(source({ season_lines: ["21.0 ppg, 6.1 reb"] }), "basketball", "H");
    expect(card.stat_lines).toEqual(["21.0 ppg, 6.1 reb"]);
    expect(card.face?.seasonText).toBe("21.0 ppg, 6.1 reb");
  });

  it("leaves football and every other sport as they were", () => {
    expect(toCardPlayer(source({ season_stats: { rush_att: 10, rush_yds: 60 } }), "football", "H").stat_lines).toEqual(["10 car · 60 yds"]);
    expect(toCardPlayer(source({ season_stats: { pts: 210 }, season_lines: ["12 goals"] }), "soccer", "H").stat_lines).toEqual(["12 goals"]);
  });
});

describe("the call rate", () => {
  it("counts a basketball player's shots, trips to the line, boards, assists, steals, blocks and turnovers per game", () => {
    // (150 + 30 * 0.5 + 61 + 44 + 21 + 3 + 20) / 10
    expect(callRateFor("basketball", { gp: 10, fg_att: 150, ft_att: 30, reb: 61, ast: 44, stl: 21, blk: 3, tov: 20 })).toBe(31.4);
    expect(callRateFor("basketball", { gp: 2, oreb: 3, dreb: 5 })).toBe(4);
  });

  it("counts a volleyball player's kills, aces, digs, blocks and half the assists per match", () => {
    expect(callRateFor("volleyball", { gp: 20, kills: 312, aces: 41, digs: 120, solo_blocks: 10, block_assists: 15, assists: 40 })).toBe(25.5);
    expect(callRateFor("volleyball", null)).toBe(0);
  });

  it("is football's own for football", () => {
    expect(callRateFor("football", { gp: 2, rush_att: 30, rec: 10 })).toBe(20);
  });
});

type Call = { messages: Array<{ role: string; content: unknown }>; response_format: { json_schema: { schema: unknown } } };

function fakeClient(answer: unknown) {
  const calls: Call[] = [];
  const create = vi.fn(async (params: Call) => {
    calls.push(params);
    return chatReply(answer, { completion_tokens: 100 });
  });
  return { client: createOpenRouterClient("test-key", fakeFetch(create)), calls };
}

const keysOf = (call: Call) =>
  (call.response_format.json_schema.schema as { properties: { players: { items: { properties: { stats: { items: { properties: { key: { enum: string[] } } } } } } } } }).properties.players
    .items.properties.stats.items.properties.key.enum;

describe("the import", () => {
  const ROSTER = [{ jersey: "22", first_name: "Devin", last_name: "Quintero" }];
  const SIGNAL = new AbortController().signal;

  it("reads a basketball sheet in one call with basketball's prompt and keys", async () => {
    const { client, calls } = fakeClient({ players: [{ jersey: "22", last_name: "Quintero", stats: [{ key: "pts", value: 210 }, { key: "gp", value: 10 }] }], warnings: [] });
    const result = await extractStats(client, { kind: "text", text: "x" }, ROSTER, "basketball", SIGNAL);
    expect(calls).toHaveLength(1);
    expect(calls[0].messages[0].content).toBe(BASKETBALL_STATS_SYSTEM_PROMPT);
    expect(keysOf(calls[0])).toEqual([...BASKETBALL_STAT_KEYS]);
    expect(result).toMatchObject({ kind: "numbers", blocks: [{ jersey: "22", last_name: "Quintero", stats: { pts: 210, gp: 10 } }] });
  });

  it("reads a volleyball sheet with volleyball's prompt", async () => {
    const { client, calls } = fakeClient({ players: [], warnings: [] });
    await extractStats(client, { kind: "text", text: "x" }, ROSTER, "volleyball", SIGNAL);
    expect(calls[0].messages[0].content).toBe(VOLLEYBALL_STATS_SYSTEM_PROMPT);
    expect(keysOf(calls[0])).toEqual([...VOLLEYBALL_STAT_KEYS]);
  });

  it("drops a key from another sport, and a player of only zeros", () => {
    const read = normalizeNumbers(
      {
        players: [
          { jersey: "22", last_name: "Quintero", stats: [{ key: "pts", value: 210 }, { key: "rush_yds", value: 40 }, { key: "kills", value: 3 }] },
          { jersey: "4", last_name: "Hollins", stats: [{ key: "pts", value: 0 }] },
        ],
        warnings: [],
      },
      BASKETBALL_STAT_KEYS,
      "basketball",
    );
    expect(read.blocks).toEqual([{ jersey: "22", last_name: "Quintero", stats: { pts: 210 } }]);
  });

  it("tells the prompts to copy totals only, never an average", () => {
    for (const prompt of [BASKETBALL_STATS_SYSTEM_PROMPT, VOLLEYBALL_STATS_SYSTEM_PROMPT]) {
      expect(prompt).toContain("Copy season totals only");
      expect(prompt).toContain("Never invent");
    }
  });
});

describe("the review", () => {
  const response = (sport: string | undefined): StatsExtractResponse => ({
    kind: "numbers",
    blocks: [{ jersey: "22", last_name: "Quintero", stats: { pts: 210, gp: 10, rush_yds: 4 } }],
    warnings: [],
    roster: [{ id: "p-22", jersey: "22", last_name: "Quintero" }],
    format: "text",
    route: "text",
    pages: 0,
    ...(sport === undefined ? {} : { sport }),
  });

  it("knows the sport, shows its columns in its sheet's order, and saves only its keys", () => {
    const review = buildStatsReview(response("basketball"));
    expect(review.sport).toBe("basketball");
    expect(columnsIn(review.rows, "basketball")).toEqual(["gp", "pts"]);
    const args = toSetSeasonStatsArgs("roster-1", "numbers", review.rows, "2026-11-02", "basketball");
    expect(args.p_stats).toEqual({ as_of: "2026-11-02", players: [{ id: "p-22", stats: { gp: 10, pts: 210 }, lines: [] }] });
  });

  it("takes a read from a server before Nov 2 as football", () => {
    expect(buildStatsReview(response(undefined)).sport).toBe("football");
  });

  it("builds the card line the review shows from the sport's numbers", () => {
    expect(lineText(seasonLineFor("basketball", { gp: 10, pts: 210 }))).toBe("21.0 ppg");
  });
});
