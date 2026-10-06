import { describe, expect, it } from "vitest";
import { MAX_LINE_LENGTH, seasonLines } from "@/lib/cards/lines";
import type { FootballStats } from "@/lib/cards/statKeys";

// The SEASON lines are what an announcer reads off the card mid-play, so each
// position group is pinned exactly, and YDS has to ride with every stat that
// has yards (docs/V3_DEFINITION.md 8.7: "YDS on every stat that has yards").

describe("seasonLines, one position group at a time", () => {
  it("a quarterback: C/ATT, YDS, TD, INT", () => {
    expect(seasonLines({ pass_cmp: 98, pass_att: 160, pass_yds: 1420, pass_td: 12, pass_int: 4 })).toEqual([
      "SEASON 98/160 1,420 YDS 12 TD 4 INT",
    ]);
  });

  it("a quarterback's 0 INT is worth saying", () => {
    expect(seasonLines({ pass_cmp: 50, pass_att: 80, pass_yds: 700, pass_int: 0 })).toEqual([
      "SEASON 50/80 700 YDS 0 INT",
    ]);
  });

  it("a running back: CAR, YDS, TD", () => {
    expect(seasonLines({ rush_att: 64, rush_yds: 420, rush_td: 5 })).toEqual(["SEASON 64 CAR 420 YDS 5 TD"]);
  });

  it("a receiver: REC, YDS, TD", () => {
    expect(seasonLines({ rec: 22, rec_yds: 310, rec_td: 3 })).toEqual(["SEASON 22 REC 310 YDS 3 TD"]);
  });

  it("a defender: TKL, SACKS, INT, PBU, FF, FR, with yards on the sacks, picks and recoveries", () => {
    expect(
      seasonLines({ tkl: 54, sacks: 4, sack_yds: 22, def_int: 2, int_ret_yds: 45, pbu: 3, ff: 1, fr: 2, fr_ret_yds: 10 }),
    ).toEqual(["SEASON 54 TKL 4 SACKS 22 YDS 2 INT 45 YDS 3 PBU 1 FF 2 FR 10 YDS"]);
  });

  it("one sack is a SACK, and half sacks keep their half", () => {
    expect(seasonLines({ tkl: 10, sacks: 1 })).toEqual(["SEASON 10 TKL 1 SACK"]);
    expect(seasonLines({ tkl: 10, sacks: 4.5 })).toEqual(["SEASON 10 TKL 4.5 SACKS"]);
  });

  it("a kicker: FG, XP, LONG", () => {
    expect(seasonLines({ fgm: 8, fga: 11, xpm: 24, xpa: 26, fg_long: 42 })).toEqual(["SEASON 8/11 FG 24/26 XP LONG 42"]);
  });

  it("a returner: KR and PR, each with its YDS, and return TDs", () => {
    expect(seasonLines({ kr: 12, kr_yds: 310, pr: 8, pr_yds: 95, kr_td: 1 })).toEqual([
      "SEASON 12 KR 310 YDS 8 PR 95 YDS 1 TD",
    ]);
  });

  it("keeps a quarterback's negative rushing yards", () => {
    expect(seasonLines({ pass_att: 100, pass_cmp: 60, rush_att: 20, rush_yds: -14 })[1]).toBe("20 CAR -14 YDS");
  });
});

describe("seasonLines, a player who does more than one thing", () => {
  const twoWay: FootballStats = { rush_att: 64, rush_yds: 420, rush_td: 5, tkl: 31, sacks: 2, sack_yds: 9 };

  it("puts one group per line, biggest first, with SEASON only on the first", () => {
    expect(seasonLines(twoWay)).toEqual(["SEASON 64 CAR 420 YDS 5 TD", "31 TKL 2 SACKS 9 YDS"]);
  });

  it("leads with whatever the player has the most of", () => {
    expect(seasonLines({ ...twoWay, tkl: 90 })[0]).toBe("SEASON 90 TKL 2 SACKS 9 YDS");
  });

  it("consolidates a fourth group onto the third line", () => {
    const lines = seasonLines({
      rush_att: 80,
      rush_yds: 500,
      rec: 30,
      rec_yds: 250,
      tkl: 20,
      kr: 5,
      kr_yds: 110,
    });
    expect(lines).toEqual(["SEASON 80 CAR 500 YDS", "30 REC 250 YDS", "20 TKL · 5 KR 110 YDS"]);
  });

  it("never passes the card's line limit", () => {
    const busy: FootballStats = {
      pass_cmp: 1234, pass_att: 2345, pass_yds: 12345, pass_td: 123, pass_int: 45,
      rush_att: 1000, rush_yds: 9999, rush_td: 99,
      rec: 900, rec_yds: 9999, rec_td: 99,
      tkl: 800, sacks: 99.5, sack_yds: 999, def_int: 99, int_ret_yds: 999, pbu: 99, ff: 99, fr: 99, fr_ret_yds: 999,
      kr: 99, kr_yds: 9999, pr: 99, pr_yds: 999, kr_td: 9,
      fgm: 99, fga: 120, xpm: 99, xpa: 100, fg_long: 55,
    };
    const lines = seasonLines(busy);
    expect(lines.length).toBeLessThanOrEqual(3);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(MAX_LINE_LENGTH);
  });

  it("drops a whole stat when a line runs long, never a stat's YDS", () => {
    const lines = seasonLines({
      tkl: 800, sacks: 99.5, sack_yds: 999, def_int: 99, int_ret_yds: 999, pbu: 99, ff: 99, fr: 99, fr_ret_yds: 999,
    });
    // Every INT, SACKS or FR that made it onto the line has its yards right after it.
    for (const match of lines[0].matchAll(/\d+(?:\.\d)? (SACKS|INT|FR)\b( \d[\d,]* YDS)?/g)) {
      expect(match[2]).toBeDefined();
    }
  });
});

describe("seasonLines, YDS wherever yards exist", () => {
  const withYards: Array<[string, FootballStats]> = [
    ["passing", { pass_att: 10, pass_cmp: 5, pass_yds: 60 }],
    ["rushing", { rush_att: 10, rush_yds: 60 }],
    ["receiving", { rec: 10, rec_yds: 60 }],
    ["sacks", { sacks: 2, sack_yds: 15 }],
    ["interceptions", { def_int: 2, int_ret_yds: 30 }],
    ["fumble recoveries", { fr: 2, fr_ret_yds: 30 }],
    ["kick returns", { kr: 3, kr_yds: 60 }],
    ["punt returns", { pr: 3, pr_yds: 60 }],
    ["punting", { punts: 10, punt_yds: 380 }],
  ];

  for (const [name, stats] of withYards) {
    it(`shows YDS for ${name}`, () => {
      const [line] = seasonLines(stats);
      expect(line).toMatch(/\d YDS/);
    });
  }

  it("says which yards they are when the sheet gave yards and no count", () => {
    expect(seasonLines({ rush_yds: 45 })).toEqual(["SEASON 45 RUSH YDS"]);
  });
});

describe("seasonLines, nothing to say", () => {
  it("gives no lines for no stats", () => {
    expect(seasonLines(null)).toEqual([]);
    expect(seasonLines({})).toEqual([]);
  });

  it("leaves zeros off, and a player of only zeros has no line", () => {
    expect(seasonLines({ rush_att: 12, rush_yds: 40, rush_td: 0 })).toEqual(["SEASON 12 CAR 40 YDS"]);
    expect(seasonLines({ rush_att: 0, rec: 0, tkl: 0, gp: 0 })).toEqual([]);
  });

  it("does not show games played on its own", () => {
    expect(seasonLines({ gp: 4 })).toEqual([]);
  });
});
