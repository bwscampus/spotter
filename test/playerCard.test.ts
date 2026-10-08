import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerCard, STAT_COLUMNS, STAT_ROWS, writeCard, writeStatLines, type CardFields } from "@/components/PlayerCard";
import { asOfLabel, byJersey, toCardPlayer, type CardSource } from "@/lib/cards/cardPlayer";
import type { CardLines } from "@/lib/cards/lines";
import { sideLooks } from "@/lib/game/colors";

// =============================================================================
// What a card says (docs/CARD_SPEC.md): one wide card, the hero at full size
// and the two older players at half size, all written by writeCard. It is the
// hot path, so it is tested the way it runs: against elements it can only set
// text, hidden and a few styles on. Vitest runs in node, so these are plain
// objects with exactly those properties. Made-up players throughout.
// =============================================================================

type Fake = {
  textContent: string;
  hidden: boolean;
  style: Record<string, string>;
  dataset: Record<string, string>;
};

const el = (): Fake => ({ textContent: "", hidden: false, style: {}, dataset: {} });
const line = (rows: number) => ({
  columns: Array.from({ length: STAT_COLUMNS }, () =>
    Array.from({ length: rows }, () => ({ root: el(), lead: el(), value: el(), label: el() })),
  ),
});

/**
 * A card's fields. `size` is the hero or a half-size card (STAT_ROWS says how
 * many rows each of its two columns has); `tonight` is a game with live stats,
 * whose TONIGHT section takes the lower part of the column (Jed, Oct 7).
 */
function card({ size = "hero", tonight = true }: { size?: "hero" | "small"; tonight?: boolean } = {}): CardFields {
  const section = el();
  section.hidden = !tonight;
  return {
    root: el(), slab: el(), jersey: el(), position: el(), code: el(), big: el(),
    plain: el(), before: el(), stressed: el(), after: el(), smallFirst: el(), smallLast: el(), storyline: el(),
    season: line(5), seasonText: el(), tonight: line(2),
    tonightSection: section, size,
  } as unknown as CardFields;
}

const f = (element: unknown) => element as Fake;
const text = (element: unknown) => f(element).textContent;

/** A section as the card shows it: each column's shown rows, top to bottom, joined by " / ", the columns by " | ". */
function shown(fields: CardFields["season"]): string {
  return fields.columns
    .map((column) =>
      column
        .filter((item) => !f(item.root).hidden)
        .map((item) => `${text(item.lead)}${text(item.value)}${text(item.label)}`)
        .join(" / "),
    )
    .filter((column) => column.length > 0)
    .join(" | ");
}

const QUELLENBACH: CardSource = {
  jersey: "24",
  first_name: "Dario",
  last_name: "Quellenbach",
  position: "RB",
  grade: "Sr",
  height: "5-11",
  weight: "190",
  pronunciations: ["kwell-en-BAHK"],
  season_stats: { rush_att: 64, rush_yds: 420, rush_td: 5 },
  season_lines: [],
  stats_as_of: "2026-09-26",
};

const LOOKS = sideLooks({ color: "#0B2545", school: "Harborview" }, { color: "#FFB612", school: "Castellan Prep" });

describe("a card with a respelling", () => {
  it("makes the respelling the big line and the small line First Surname", () => {
    const fields = card();
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"), LOOKS.H);
    expect([text(fields.plain), text(fields.before), text(fields.stressed), text(fields.after)]).toEqual(["", "kwell-en-", "BAHK", ""]);
    expect(text(fields.smallFirst) + text(fields.smallLast)).toBe("Dario Quellenbach");
  });

  it("shows the number and, under it, the position", () => {
    const fields = card();
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"), LOOKS.H);
    expect(text(fields.jersey)).toBe("24");
    expect(f(fields.jersey).style.fontSize).toBe("4em");
    expect(text(fields.position)).toBe("RB");
  });
});

describe("a card without a respelling", () => {
  const plain = { ...QUELLENBACH, last_name: "MARCHETTO", first_name: "LUCA", pronunciations: [] };

  it("makes the surname the big line, in Title case, and the small line the first name", () => {
    const fields = card();
    writeCard(fields, toCardPlayer(plain, "football", "H"));
    expect(text(fields.plain)).toBe("Marchetto");
    expect(text(fields.before) + text(fields.stressed) + text(fields.after)).toBe("");
    expect(text(fields.smallFirst) + text(fields.smallLast)).toBe("Luca");
  });

  it("goes back to the plain surname for the next player in the same slot", () => {
    const fields = card();
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"));
    writeCard(fields, toCardPlayer(plain, "football", "H"));
    expect(text(fields.plain)).toBe("Marchetto");
    expect(text(fields.stressed)).toBe("");
  });

  it("leaves the position empty, and drops a three-character jersey to the smaller size", () => {
    const fields = card();
    writeCard(fields, toCardPlayer({ ...plain, position: null, jersey: "123" }, "football", "H"));
    expect(text(fields.position)).toBe("");
    expect(f(fields.jersey).style.fontSize).toBe("2.9em");
    writeCard(fields, toCardPlayer({ ...plain, jersey: null }, "football", "H"));
    expect(text(fields.jersey)).toBe("–");
  });

  it("treats a note that is not a respelling as none", () => {
    const fields = card();
    writeCard(fields, toCardPlayer({ ...plain, pronunciations: ["rhymes with Marquetto, not Mar-ketto"] }, "football", "H"));
    expect(text(fields.plain)).toBe("Marchetto");
  });
});

describe("the slab", () => {
  it("is the team's colour with the ink that reads on it, and away is hatched with its school code", () => {
    const away = card();
    writeCard(away, toCardPlayer(QUELLENBACH, "football", "A"), LOOKS.A);
    expect(f(away.slab).style.backgroundColor).toBe("#ffb612");
    expect(f(away.slab).style.color).toBe("#111111");
    expect(f(away.slab).style.backgroundImage).toMatch(/^repeating-linear-gradient\(45deg, rgba\(17, 17, 17, 0\.12\)/);
    expect(text(away.code)).toBe("CP");
    expect(f(away.code).hidden).toBe(false);
  });

  it("home has no hatching and no code", () => {
    const home = card();
    writeCard(home, toCardPlayer(QUELLENBACH, "football", "H"), LOOKS.H);
    expect(f(home.slab).style.backgroundColor).toBe("#0b2545");
    expect(f(home.slab).style.color).toBe("#FFFFFF");
    expect(f(home.slab).style.backgroundImage).toBe("");
    expect(f(home.code).hidden).toBe(true);
  });

  it("a slot that held an away player loses the hatching when a home player goes up in it", () => {
    const fields = card();
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "A"), LOOKS.A);
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"), LOOKS.H);
    expect(f(fields.slab).style.backgroundImage).toBe("");
    expect(text(fields.code)).toBe("");
  });
});

describe("the season and tonight sections: two columns of rows, one stat a row (Jed, Oct 7: show as much as fits)", () => {
  it(`the hero on a stats game: ${STAT_ROWS.hero.withTonight.season} season rows a column, so a running back's whole line, and tonight empty`, () => {
    const fields = card();
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"));
    expect(shown(fields.season)).toBe("64 car / 420 yds / 5 TD");
    expect(shown(fields.tonight)).toBe("");
  });

  it("the hero on a names-only game: the same, with room to spare", () => {
    const fields = card({ tonight: false });
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"));
    expect(shown(fields.season)).toBe("64 car / 420 yds / 5 TD");
  });

  it("a half-size card on a stats game: one group runs down the left column and on into the right", () => {
    const small = card({ size: "small" });
    writeCard(small, toCardPlayer(QUELLENBACH, "football", "H"));
    expect(shown(small.season)).toBe("64 car / 420 yds | 5 TD");
    const namesOnly = card({ size: "small", tonight: false });
    writeCard(namesOnly, toCardPlayer(QUELLENBACH, "football", "H"));
    expect(shown(namesOnly.season)).toBe("64 car / 420 yds / 5 TD");
  });

  it("a player with two groups: the biggest in the left column, the next in the right, each its highest priority rows", () => {
    const twoWay = { ...QUELLENBACH, season_stats: { pass_cmp: 88, pass_att: 140, pass_yds: 1240, pass_td: 9, pass_int: 4, rush_att: 40, rush_yds: 210, rush_td: 3 } };
    const hero = card();
    writeCard(hero, toCardPlayer(twoWay, "football", "H"));
    expect(shown(hero.season)).toBe("88-140 / 1,240 yds / 9 TD | 40 car / 210 yds / 3 TD");
    const small = card({ size: "small" });
    writeCard(small, toCardPlayer(twoWay, "football", "H"));
    // Two rows a column: the passer's completions and touchdowns, and the carries that say the right column is rushing.
    expect(shown(small.season)).toBe("88-140 / 9 TD | 40 car / 210 yds");
    const namesOnly = card({ tonight: false });
    writeCard(namesOnly, toCardPlayer(twoWay, "football", "H"));
    expect(shown(namesOnly.season)).toBe("88-140 / 1,240 yds / 9 TD / 4 INT | 40 car / 210 yds / 3 TD");
  });

  it("with tonight, shows the season with tonight in it and tonight's stats, the estimate marked in black", () => {
    const fields = card();
    const lines: CardLines = {
      season: [{ value: "431", label: "yds", estimated: true, rank: 0 }, { value: "5", label: "TD", estimated: false, rank: 1 }],
      tonight: [{ value: "2", label: "car", estimated: false, rank: 1 }, { value: "11", label: "yds", estimated: true, rank: 0 }],
    };
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"), null, lines);
    expect(shown(fields.season)).toBe("~431 yds / 5 TD");
    expect(shown(fields.tonight)).toBe("2 car / ~11 yds");
    // Not greyed (Jed, Oct 3): nothing but the ~ sets an estimate apart.
    expect(f(fields.tonight.columns[0][1].root).style).toEqual({});
  });

  it("reads a line saved before ranks in spoken order", () => {
    const fields = card();
    writeStatLines(fields, [{ value: "22", label: "rec", estimated: false }, { value: "310", label: "yds", estimated: false }, { value: "4", label: "TD", estimated: false }], "", []);
    expect(shown(fields.season)).toBe("22 rec / 310 yds / 4 TD");
  });

  it("says a label first when it is said first", () => {
    const fields = card({ tonight: false });
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, season_stats: { fgm: 7, fga: 9, fg_long: 42 } }, "football", "H"));
    expect(shown(fields.season)).toBe("7-9 FG / long 42");
  });

  it("another sport shows its first saved line as plain text in the season section", () => {
    const fields = card();
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, season_lines: ["12 kills, 3 aces", "31 digs"] }, "volleyball", "H"));
    expect(text(fields.seasonText)).toBe("12 kills, 3 aces");
    expect(f(fields.seasonText).hidden).toBe(false);
    expect(shown(fields.season)).toBe("");
  });

  it("can take tonight back off when a play is undone", () => {
    const fields = card();
    writeStatLines(fields, [], "", [{ value: "1", label: "tkl", estimated: false }]);
    expect(shown(fields.tonight)).toBe("1 tkl");
    writeStatLines(fields, [], "", []);
    expect(shown(fields.tonight)).toBe("");
  });
});

describe("the storyline", () => {
  it("goes under the name, and is hidden for a player who has none", () => {
    const fields = card();
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, storyline: "  Committed to   Fresno State " }, "football", "H"));
    expect(text(fields.storyline)).toBe("Committed to Fresno State");
    expect(f(fields.storyline).hidden).toBe(false);
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"));
    expect(text(fields.storyline)).toBe("");
    expect(f(fields.storyline).hidden).toBe(true);
  });

  it("is cut to MAX_STORYLINE_CHARS, and the card clamps it to two lines", () => {
    const long = "x".repeat(200);
    expect(toCardPlayer({ ...QUELLENBACH, storyline: long }, "football", "H").face?.storyline).toHaveLength(80);
    const hero = renderToStaticMarkup(createElement(PlayerCard));
    expect(hero).toMatch(/data-card="storyline" hidden="" [^>]*-webkit-line-clamp:2/);
  });
});

describe("the rendered markup", () => {
  const hero = renderToStaticMarkup(createElement(PlayerCard));

  it("has every part writeCard writes, hidden until a player goes up", () => {
    for (const part of ["card", "slab", "jersey", "position", "code", "big", "plain", "before", "stressed", "after", "small-first", "small-last", "storyline", "season", "season-text", "season-item-0-0", "season-item-1-4", "tonight", "tonight-item-0-0", "tonight-item-1-1"]) {
      expect(hero).toContain(`data-card="${part}"`);
    }
    expect(hero).toMatch(/^<article data-card="card" hidden=""/);
  });

  it("labels the two sections SEASON and TONIGHT, and always draws tonight on a stats game", () => {
    expect(hero).toContain(">SEASON<");
    expect(hero).toContain(">TONIGHT<");
    expect(hero).toMatch(/data-card="tonight-section" class="[^"]*bg-\[#F0F0F0\]/);
    expect(hero).not.toMatch(/data-card="tonight-section" hidden/);
    const namesOnly = renderToStaticMarkup(createElement(PlayerCard, { tonight: false }));
    expect(namesOnly).toMatch(/data-card="tonight-section" hidden=""/);
  });

  it("gives every row a fixed height, so what is written never moves a section", () => {
    const rows = [...hero.matchAll(/data-card="(season|tonight)-item-\d-\d"[^>]*style="([^"]*)"/g)];
    expect(rows).toHaveLength(2 * 5 + 2 * 2);
    for (const [, , style] of rows) expect(style).toContain("height:1.1em");
    expect(hero).not.toContain("-sep-");
  });

  it("draws an estimate in the same colour as everything else", () => {
    expect(hero).not.toMatch(/est=true|6B6B6B/i);
  });

  it("draws a small card's labels and code bigger relative to it, so they are never under 0.4em of the stage", () => {
    const small = renderToStaticMarkup(createElement(PlayerCard, { small: true }));
    expect(small).toContain("font-size:0.82em");
    expect(hero).not.toContain("font-size:0.82em");
  });
});

describe("the card's size", () => {
  it("is fixed in the markup: 32em by 6.4em, hero and small alike", () => {
    expect(renderToStaticMarkup(createElement(PlayerCard))).toMatch(/^<article[^>]*style="width:32em;height:6.4em;line-height:1"/);
    expect(renderToStaticMarkup(createElement(PlayerCard, { small: true }))).toMatch(/^<article[^>]*style="width:32em;height:6.4em;line-height:1"/);
  });

  it("is the same whatever is written into it: no writer touches the card's own size", () => {
    const fields = card();
    const long = { ...QUELLENBACH, jersey: "123", last_name: "Vanderkellen-Ruiz", pronunciations: ["vahn-der-KELL-en-roo-eez"] };
    const lines: CardLines = {
      season: [{ value: "1,240", label: "yds", estimated: true }, { value: "12", label: "TD", estimated: false }],
      tonight: [{ value: "12", label: "car", estimated: false }, { value: "188", label: "yds", estimated: true }, { value: "3", label: "TD", estimated: false }],
    };
    for (const player of [toCardPlayer(QUELLENBACH, "football", "H"), toCardPlayer(long, "football", "A"), undefined]) {
      writeCard(fields, player, LOOKS.A, lines, { plain: "", before: "vahn-der-", stressed: "KELL", after: "-\nen-roo-eez", size: 1.45 });
      expect(f(fields.root).style).toEqual({});
    }
  });
});

describe("toCardPlayer", () => {
  it("football builds the season line from the numbers and keeps its text for the refresh", () => {
    const player = toCardPlayer({ ...QUELLENBACH, season_lines: ["stale line"] }, "football", "A");
    // All three stats, one per row on the card; the ranks say which a column with fewer rows keeps.
    expect(player.stat_lines).toEqual(["64 car · 420 yds · 5 TD"]);
    expect(player.face?.season.map((item) => [item.label, item.rank])).toEqual([["car", 2], ["yds", 0], ["TD", 1]]);
    expect(player.side).toBe("A");
  });

  it("other sports use the lines as written, and ignore numbers", () => {
    const player = toCardPlayer({ ...QUELLENBACH, season_stats: { tkl: 3 }, season_lines: ["12 kills, 3 aces", " ", "31 digs"] }, "volleyball", "H");
    expect(player.stat_lines).toEqual(["12 kills, 3 aces", "31 digs"]);
    expect(player.face?.season).toEqual([]);
    expect(player.face?.seasonText).toBe("12 kills, 3 aces");
  });

  it("uses the first pronunciation note that says anything", () => {
    const player = toCardPlayer({ ...QUELLENBACH, pronunciations: ["  ", "AR-uh-gone"] }, "football", "H");
    expect(player.pronunciation).toBe("AR-uh-gone");
    expect(player.face?.stressed).toBe("AR");
  });

  it("puts nothing on the card it no longer shows: no as-of date, no vitals", () => {
    const player = toCardPlayer(QUELLENBACH, "football", "H");
    expect(player.as_of).toBeUndefined();
    expect(JSON.stringify(player.face)).not.toMatch(/5-11|190|9\/26/);
  });
});

describe("asOfLabel, for setup's stale-stats warning", () => {
  it("reads the date as written, with no time zone shift", () => {
    expect(asOfLabel("2026-10-01")).toBe("as of 10/1");
    expect(asOfLabel(null)).toBeNull();
    expect(asOfLabel("soon")).toBeNull();
  });
});

describe("byJersey", () => {
  it("sorts by number, 0 before 00, and players with no number last", () => {
    const players = [
      { jersey: "22", last_name: "Langan" },
      { jersey: null, last_name: "Adams" },
      { jersey: "00", last_name: "Zed" },
      { jersey: "8", last_name: "Bargas" },
      { jersey: "0", last_name: "Wright" },
    ];
    expect([...players].sort(byJersey).map((player) => player.jersey)).toEqual(["0", "00", "8", "22", null]);
  });
});
