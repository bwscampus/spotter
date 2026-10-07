import { describe, expect, it } from "vitest";
import { matchStats, unmatchedWarnings } from "@/lib/stats/matchStats";
import {
  buildStatsReview,
  cleanLines,
  columnsIn,
  statsImportProps,
  toSetSeasonStatsArgs,
  todayIso,
  withStat,
} from "@/lib/stats/review";
import type { NumberBlock, StatsExtractResponse, StatsPlayer } from "@/lib/stats/types";

// Football stats arrive as numbers and are placed on saved players the same way
// lines are: jersey first, surname second, never a guess. A row that lands on
// nobody is a warning naming its jersey, so the announcer can find it.

const ROSTER: StatsPlayer[] = [
  { id: "p-langan", jersey: "22", last_name: "Langan" },
  { id: "p-ossuetta", jersey: "17", last_name: "Ossuetta" },
  { id: "p-bargas", jersey: "8", last_name: "Bargas" },
  { id: "p-vargas", jersey: "21", last_name: "Vargas" },
  { id: "p-wright", jersey: "0", last_name: "Wright" },
];

const numbers = (jersey: string | null, last_name: string, stats: NumberBlock["stats"]): NumberBlock => ({
  jersey,
  last_name,
  stats,
});

function response(blocks: NumberBlock[], warnings: string[] = []): StatsExtractResponse {
  return { kind: "numbers", blocks, warnings, roster: ROSTER, format: "pdf", route: "vision", pages: 2 };
}

describe("football numbers land on the right players", () => {
  it("places each row by jersey, carrying its numbers untouched", () => {
    const { matched, unmatched } = matchStats(ROSTER, [
      numbers("22", "Langan", { rush_att: 64, rush_yds: 420, rush_td: 5 }),
      numbers("17", "Ossuetta", { tkl: 54, pbu: 3 }),
    ]);
    expect(unmatched).toEqual([]);
    expect(matched.map((match) => [match.player.id, match.block.stats])).toEqual([
      ["p-langan", { rush_att: 64, rush_yds: 420, rush_td: 5 }],
      ["p-ossuetta", { tkl: 54, pbu: 3 }],
    ]);
  });

  it("keeps look-alike surnames apart by jersey: Bargas #8 and Vargas #21", () => {
    const { matched } = matchStats(ROSTER, [numbers("21", "Vargas", { tkl: 12 }), numbers("8", "Bargas", { tkl: 30 })]);
    expect(matched.find((match) => match.player.id === "p-vargas")?.block.stats).toEqual({ tkl: 12 });
    expect(matched.find((match) => match.player.id === "p-bargas")?.block.stats).toEqual({ tkl: 30 });
  });

  it("does not question a surname the sheet printed with an initial", () => {
    const { matched } = matchStats(ROSTER, [numbers("0", "T. Wright", { pass_att: 9 })]);
    expect(matched[0].player.id).toBe("p-wright");
    expect(matched[0].mismatchedName).toBeUndefined();
    // A different surname on the same jersey still is questioned.
    expect(matchStats(ROSTER, [numbers("0", "T. Right", { pass_att: 9 })]).matched[0].mismatchedName).toBe("T. Right");
  });

  it("finds a player by surname through an initial when the sheet has no jersey", () => {
    expect(matchStats(ROSTER, [numbers(null, "S. Langan", { rec: 2 })]).matched[0].player.id).toBe("p-langan");
  });

  it("falls back to the surname when the sheet has no jersey", () => {
    const { matched } = matchStats(ROSTER, [numbers(null, "Wright", { rec: 9 })]);
    expect(matched[0].player.id).toBe("p-wright");
  });

  it("reads '#22' on a sheet as jersey 22, and keeps 0 apart from 00", () => {
    expect(matchStats(ROSTER, [numbers("#22", "Langan", { rec: 1 })]).matched[0].player.id).toBe("p-langan");
    const { matched, unmatched } = matchStats(ROSTER, [numbers("00", "Nobody", { rec: 1 })]);
    expect(matched).toEqual([]);
    expect(unmatched).toHaveLength(1);
  });
});

describe("a row that matches nobody", () => {
  it("becomes a warning naming the jersey", () => {
    const result = matchStats(ROSTER, [numbers("44", "Smith", { tkl: 5 })]);
    expect(result.matched).toEqual([]);
    expect(unmatchedWarnings(result)).toEqual(["#44 Smith: No #44 Smith on the roster."]);
  });

  it("shows up on the review with Claude's own warnings, and is not saved", () => {
    const review = buildStatsReview(
      response([numbers("22", "Langan", { rush_att: 10 }), numbers("44", "Smith", { tkl: 5 })], ["Page 3 was unreadable."]),
    );
    expect(review.warnings).toEqual(["Page 3 was unreadable.", "#44 Smith: No #44 Smith on the roster."]);
    expect(review.rows.map((row) => row.player.id)).toEqual(["p-langan"]);
    expect(review.unmatched).toBe(1);
    expect(review.silent).toBe(4);
  });

  it("does not repeat a warning Claude already gave word for word", () => {
    const review = buildStatsReview(
      response([numbers("44", "Smith", { tkl: 5 })], ["#44 Smith: No #44 Smith on the roster."]),
    );
    expect(review.warnings).toHaveLength(1);
  });
});

describe("the review table", () => {
  it("lists matched players in jersey order", () => {
    const review = buildStatsReview(
      response([
        numbers("22", "Langan", { rush_att: 10 }),
        numbers("0", "Wright", { rec: 4 }),
        numbers("17", "Ossuetta", { tkl: 9 }),
      ]),
    );
    expect(review.rows.map((row) => row.player.jersey)).toEqual(["0", "17", "22"]);
  });

  it("shows the columns the sheet had, in stat key order", () => {
    const review = buildStatsReview(
      response([numbers("22", "Langan", { rush_yds: 420, rush_att: 64 }), numbers("17", "Ossuetta", { tkl: 54 })]),
    );
    expect(columnsIn(review.rows)).toEqual(["rush_att", "rush_yds", "tkl"]);
  });

  it("an edit sets a number, a blank clears it, and junk changes nothing", () => {
    expect(withStat({ tkl: 5 }, "tkl", "6")).toEqual({ tkl: 6 });
    expect(withStat({ tkl: 5 }, "rush_yds", "-3")).toEqual({ tkl: 5, rush_yds: -3 });
    expect(withStat({ tkl: 5 }, "tkl", "  ")).toEqual({});
    expect(withStat({ tkl: 5 }, "tkl", "abc")).toEqual({ tkl: 5 });
  });
});

describe("what set_season_stats is sent", () => {
  it("football: numbers per player id, no lines, and the as-of date", () => {
    const review = buildStatsReview(response([numbers("22", "Langan", { rush_att: 64, rush_yds: 420 })]));
    expect(toSetSeasonStatsArgs("roster-1", "numbers", review.rows, "2026-09-26")).toEqual({
      p_roster_id: "roster-1",
      p_stats: {
        as_of: "2026-09-26",
        players: [{ id: "p-langan", stats: { rush_att: 64, rush_yds: 420 }, lines: [] }],
      },
    });
  });

  it("leaves out a player whose numbers were all cleared, and a bad date", () => {
    const review = buildStatsReview(response([numbers("22", "Langan", { rush_att: 64 })]));
    const cleared = review.rows.map((row) => ({ ...row, stats: withStat(row.stats, "rush_att", "") }));
    expect(toSetSeasonStatsArgs("roster-1", "numbers", cleared, "Friday")).toEqual({
      p_roster_id: "roster-1",
      p_stats: { as_of: null, players: [] },
    });
  });

  it("other sports: lines per player id, blanks dropped, at most three", () => {
    const lines: StatsExtractResponse = {
      kind: "lines",
      blocks: [{ jersey: "22", last_name: "Langan", lines: ["12 kills", "", "  3 aces ", "4 digs", "5 blocks"] }],
      warnings: [],
      roster: ROSTER,
      format: "text",
      route: "text",
      pages: 0,
    };
    const review = buildStatsReview(lines);
    expect(toSetSeasonStatsArgs("roster-1", "lines", review.rows, "2026-09-26").p_stats).toEqual({
      as_of: "2026-09-26",
      players: [{ id: "p-langan", stats: null, lines: ["12 kills", "3 aces", "4 digs"] }],
    });
  });

  it("cuts a line to what the card holds", () => {
    expect(cleanLines(["x".repeat(200)])[0]).toHaveLength(80);
  });

  it("dates the stats today, in the announcer's own time zone", () => {
    expect(todayIso(new Date(2026, 8, 5, 23, 30))).toBe("2026-09-05");
  });
});

describe("the stats import's analytics", () => {
  it("are counts only: no name, jersey or number from the sheet", () => {
    const review = buildStatsReview(
      response([numbers("22", "Langan", { rush_att: 64, rush_yds: 420 }), numbers("44", "Smith", { tkl: 5 })], ["#44 Smith?"]),
    );
    const props = statsImportProps(review);
    expect(props).toEqual({ players_found: 1, players_flagged: 1, players_silent: 4, warnings: 2 });
    const serialized = JSON.stringify(props);
    for (const leak of ["Langan", "Smith", "22", "44", "420"]) expect(serialized).not.toContain(leak);
  });
});
