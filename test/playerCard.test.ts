import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerCard, writeCard, writeStatLines, type CardFields } from "@/components/PlayerCard";
import { asOfLabel, byJersey, toCardPlayer, type CardSource } from "@/lib/cards/cardPlayer";
import { MAX_FACTS } from "@/lib/cards/cardFace";
import { MAX_FACT_SIZE_EM } from "@/lib/cards/factLayout";
import type { CardLines } from "@/lib/cards/lines";
import { MAX_STAT_SIZE_EM, MAX_STAT_SLOTS } from "@/lib/cards/statLayout";
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
const line = () => ({
  grid: el(),
  slots: Array.from({ length: MAX_STAT_SLOTS }, () => ({ root: el(), lead: el(), value: el(), label: el() })),
});

/**
 * A card's fields. `size` is the hero or a half-size card; `tonight` is a game
 * with live stats, whose TONIGHT section takes the lower part of the column.
 */
function card({ size = "hero", tonight = true }: { size?: "hero" | "small"; tonight?: boolean } = {}): CardFields {
  const section = el();
  section.hidden = !tonight;
  return {
    root: el(), slab: el(), jersey: el(), position: el(), code: el(), big: el(),
    plain: el(), before: el(), stressed: el(), after: el(), smallFirst: el(), smallLast: el(),
    factsBox: el(), scoring: el(), factColumns: el(), factColumn: [el(), el()],
    factSlots: [Array.from({ length: MAX_FACTS }, el), Array.from({ length: MAX_FACTS }, el)],
    season: line(), tonight: line(),
    tonightSection: section, size,
  } as unknown as CardFields;
}

const f = (element: unknown) => element as Fake;
const text = (element: unknown) => f(element).textContent;

/** The shown slots of a section, each with the cell the writer put it in (1-based, as CSS grid has them). */
function cells(fields: CardFields["season"]) {
  return fields.slots
    .filter((item) => !f(item.root).hidden)
    .map((item) => ({
      text: `${text(item.lead)}${text(item.value)}${text(item.label)}`,
      column: Number(f(item.root).style.gridColumn),
      row: Number(f(item.root).style.gridRow),
    }));
}

/** A section as the card shows it: each column's rows, top to bottom, joined by " / ", the columns by " | ". */
function shown(fields: CardFields["season"]): string {
  const placed = cells(fields);
  const columns = [...new Set(placed.map((cell) => cell.column))].sort((a, b) => a - b);
  return columns
    .map((column) =>
      placed
        .filter((cell) => cell.column === column)
        .sort((a, b) => a.row - b.row)
        .map((cell) => cell.text)
        .join(" / "),
    )
    .join(" | ");
}

/** The stat size the writer set on a section, in em of the card. */
const sizeOf = (fields: CardFields["season"]) => parseFloat(f(fields.grid).style.fontSize);

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

describe("the season and tonight sections: every stat, a column per group, none cut off (Jed, Oct 8)", () => {
  const quarterback = {
    ...QUELLENBACH,
    season_stats: { pass_cmp: 88, pass_att: 140, pass_yds: 1240, pass_td: 9, pass_int: 4, rush_att: 40, rush_yds: 210, rush_td: 3 },
  };
  const twoWay = {
    ...QUELLENBACH,
    season_stats: { rush_att: 120, rush_yds: 1045, rush_td: 14, rec: 22, rec_yds: 220, rec_td: 3, tkl: 45, sacks: 4.5, def_int: 3, pbu: 6, kr: 12, kr_yds: 310 },
  };

  it("the hero: a running back's whole line in one column, at the usual size, and tonight empty", () => {
    for (const tonight of [true, false]) {
      const fields = card({ tonight });
      writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"));
      expect(shown(fields.season)).toBe("64 car / 420 yds / 5 TD");
      expect(sizeOf(fields.season)).toBeGreaterThanOrEqual(MAX_STAT_SIZE_EM.hero * 0.9);
      expect(shown(fields.tonight)).toBe("");
    }
  });

  it("a quarterback's passing and running, each group in its own column, every item shown", () => {
    const fields = card({ tonight: false });
    writeCard(fields, toCardPlayer(quarterback, "football", "H"));
    expect(shown(fields.season)).toBe("88-140 / 1,240 yds / 9 TD / 4 INT | 40 car / 210 yds / 3 TD");
  });

  it("shows every item exactly once, whatever the card and whatever the game", () => {
    for (const size of ["hero", "small"] as const) {
      for (const tonight of [true, false]) {
        const fields = card({ size, tonight });
        const player = toCardPlayer(twoWay, "football", "H");
        writeCard(fields, player);
        const expected = player.face!.season.map((item) => `${item.labelFirst ? `${item.label} ` : ""}${item.value}${item.labelFirst ? "" : ` ${item.label}`}`);
        expect(cells(fields.season).map((cell) => cell.text).sort()).toEqual([...expected].sort());
      }
    }
  });

  it("starts each group at the top of a new column, the biggest group first, and runs down it in spoken order", () => {
    const fields = card();
    writeCard(fields, toCardPlayer(twoWay, "football", "H"));
    const columns = shown(fields.season).split(" | ");
    // Rushing, then defense, then receiving, then returns: four groups, each from row 1 of its own column(s).
    expect(columns[0].startsWith("120 car")).toBe(true);
    expect(shown(fields.season)).toMatch(/120 car.*1,045 yds.*14 TD.*45 tkl.*4\.5 sk.*3 INT.*6 PBU.*22 rec.*220 yds.*3 TD.*12 kr.*310 yds/);
    const firstOfGroup = ["120 car", "45 tkl", "22 rec", "12 kr"].map((label) => cells(fields.season).find((cell) => cell.text === label)!);
    for (const cell of firstOfGroup) expect(cell.row).toBe(1);
    expect(new Set(firstOfGroup.map((cell) => cell.column)).size).toBe(4);
  });

  it("draws a card with more to say smaller, never bigger than the usual size", () => {
    const busy = card();
    writeCard(busy, toCardPlayer(twoWay, "football", "H"));
    const plain = card();
    writeCard(plain, toCardPlayer(QUELLENBACH, "football", "H"));
    expect(sizeOf(busy.season)).toBeLessThan(sizeOf(plain.season));
    expect(sizeOf(plain.season)).toBeLessThanOrEqual(MAX_STAT_SIZE_EM.hero);
  });

  it("with tonight, shows the season with tonight in it and tonight's stats, the estimate marked in black", () => {
    const fields = card();
    const lines: CardLines = {
      season: [{ value: "431", label: "yds", estimated: true }, { value: "5", label: "TD", estimated: false }],
      tonight: [{ value: "2", label: "car", estimated: false }, { value: "11", label: "yds", estimated: true }],
    };
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"), null, lines);
    expect(shown(fields.season)).toBe("~431 yds / 5 TD");
    expect(shown(fields.tonight)).toBe("2 car / ~11 yds");
    // Not greyed (Jed, Oct 3): nothing but the ~ sets an estimate apart.
    expect(f(fields.tonight.slots[1].value).style).toEqual({});
  });

  it("reads a line saved before groups as one group, in spoken order", () => {
    const fields = card();
    writeStatLines(fields, [{ value: "22", label: "rec", estimated: false }, { value: "310", label: "yds", estimated: false }, { value: "4", label: "TD", estimated: false }], "", []);
    expect(shown(fields.season)).toBe("22 rec / 310 yds / 4 TD");
  });

  it("says a label first when it is said first", () => {
    const fields = card({ tonight: false });
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, season_stats: { fgm: 7, fga: 9, fg_long: 42 } }, "football", "H"));
    expect(shown(fields.season)).toBe("7-9 FG / long 42");
  });

  it("another sport shows every saved line, split where it lists things, a column a line", () => {
    const fields = card({ tonight: false });
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, season_lines: ["12 kills, 3 aces", "31 digs · 1,204 kills"] }, "volleyball", "H"));
    expect(shown(fields.season)).toBe("12 kills / 3 aces | 31 digs / 1,204 kills");
  });

  it("hides the slots a player does not use, so a busy card's stats never linger on the next one", () => {
    const fields = card();
    writeCard(fields, toCardPlayer(twoWay, "football", "H"));
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"));
    expect(cells(fields.season)).toHaveLength(3);
  });

  it("can take tonight back off when a play is undone", () => {
    const fields = card();
    writeStatLines(fields, [], "", [{ value: "1", label: "tkl", estimated: false }]);
    expect(shown(fields.tonight)).toBe("1 tkl");
    writeStatLines(fields, [], "", []);
    expect(shown(fields.tonight)).toBe("");
  });
});

/** The facts as the card shows them: each column's facts, " / " between them, " | " between the columns. */
function factsShown(fields: CardFields): string {
  if (f(fields.factsBox).hidden || f(fields.factColumns).hidden) return "";
  return fields.factSlots
    .filter((_, column) => !f(fields.factColumn[column]).hidden)
    .map((slots) => slots.filter((slot) => !f(slot).hidden).map(text).join(" / "))
    .join(" | ");
}

/** The scoring row as the card shows it, or "". */
const scoringShown = (fields: CardFields) => (f(fields.factsBox).hidden || f(fields.scoring).hidden ? "" : text(fields.scoring));

const SCORER: CardSource = {
  ...QUELLENBACH,
  season_stats: { gp: 12, h_goals: 11, h_assists: 6, h_points: 17, h_sog: 40 },
};

describe("the facts (Nov 15: every one on the card, none cut off)", () => {
  it("go under the name, and are hidden for a player who has none", () => {
    const fields = card();
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, facts: ["  Committed to   Fresno State "] }, "football", "H"));
    expect(factsShown(fields)).toBe("Committed to Fresno State");
    expect(f(fields.factsBox).hidden).toBe(false);
    // No facts and no scoring numbers (basketball has no scoring row): nothing under the name, as before.
    writeCard(fields, toCardPlayer(QUELLENBACH, "basketball", "H"));
    expect(factsShown(fields)).toBe("");
    expect(f(fields.factsBox).hidden).toBe(true);
    // A football player with touchdowns keeps room for the scoring row, empty in the facts view.
    writeCard(fields, toCardPlayer(QUELLENBACH, "football", "H"));
    expect(factsShown(fields)).toBe("");
    expect(scoringShown(fields)).toBe("");
  });

  it("draw one fact exactly as the storyline was: one column, the storyline's size, no rule", () => {
    const fields = card();
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, facts: ["Committed to Fresno State"] }, "football", "H"));
    expect(f(fields.factColumns).style.fontSize).toBe(`${MAX_FACT_SIZE_EM.hero}em`);
    expect(f(fields.factColumn[1]).hidden).toBe(true);
    expect(f(fields.factSlots[0][0]).style.borderLeft).toBe("");
  });

  it("show every fact a player has, in the order typed, each with a rule when there are several", () => {
    const fields = card();
    const facts = ["Committed to Fresno State", "4-year starter", "All-league 1st team as a junior"];
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, facts }, "football", "H"));
    expect(factsShown(fields).split(/ \/ | \| /)).toEqual(facts);
    expect(f(fields.factSlots[0][0]).style.borderLeft).not.toBe("");
  });

  it("go to two columns when five short facts read bigger that way, and still show all five in order", () => {
    const fields = card();
    const facts = ["4-year starter", "Team captain", "All-league 1st team", "Committed to Cal Poly", "School record 41 sacks"];
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, facts }, "football", "H"));
    expect(factsShown(fields)).toContain(" | ");
    expect(factsShown(fields).split(/ \/ | \| /)).toEqual(facts);
  });

  it("stay in one column, smaller, when five long facts would only wrap more in two, and show all five", () => {
    const fields = card();
    const facts = Array.from({ length: MAX_FACTS }, (_, index) => `${index + 1} Scored the winning goal in overtime against Westlake last week`);
    writeCard(fields, toCardPlayer({ ...QUELLENBACH, facts }, "football", "H"));
    expect(factsShown(fields).split(/ \/ | \| /)).toEqual(facts);
    expect(parseFloat(f(fields.factColumns).style.fontSize)).toBeLessThan(MAX_FACT_SIZE_EM.hero);
  });

  it("are cut to 80 characters each and at most five", () => {
    const long = "x".repeat(200);
    const face = toCardPlayer({ ...QUELLENBACH, facts: [long, "a", "b", "c", "d", "e", "f"] }, "football", "H").face;
    expect(face?.facts?.[0]).toHaveLength(80);
    expect(face?.facts).toHaveLength(MAX_FACTS);
  });

  it("read a game built before facts, whose face has its one storyline", () => {
    const fields = card();
    const player = toCardPlayer(QUELLENBACH, "football", "H");
    const old = { ...player, face: { ...player.face!, facts: undefined, storyline: "Back from a broken wrist" } };
    writeCard(fields, old);
    expect(factsShown(fields)).toBe("Back from a broken wrist");
  });
});

describe("the scoring view (Nov 15)", () => {
  it("puts the scoring numbers first, bold, on their own row, and keeps the facts under them when they fit", () => {
    const fields = card();
    const player = toCardPlayer({ ...SCORER, facts: ["Committed to Fresno State"] }, "ice_hockey", "H");
    writeCard(fields, player, LOOKS.H, undefined, undefined, "scoring");
    expect(scoringShown(fields)).toBe("11 G · 6 A · 17 PTS");
    expect(factsShown(fields)).toBe("Committed to Fresno State");
    writeCard(fields, player, LOOKS.H, undefined, undefined, "facts");
    expect(scoringShown(fields)).toBe("");
    expect(factsShown(fields)).toBe("Committed to Fresno State");
  });

  it("is the normal card for a player with no scoring numbers: never an empty row", () => {
    const fields = card();
    const player = toCardPlayer({ ...QUELLENBACH, facts: ["Committed to Fresno State"] }, "ice_hockey", "H");
    writeCard(fields, player, LOOKS.H, undefined, undefined, "scoring");
    expect(scoringShown(fields)).toBe("");
    expect(f(fields.scoring).hidden).toBe(true);
    expect(factsShown(fields)).toBe("Committed to Fresno State");
  });

  it("drops the facts rather than shrink them past reading under the row", () => {
    const fields = card();
    const facts = Array.from({ length: MAX_FACTS }, () => "Scored the winning goal in overtime against Westlake last Friday night");
    writeCard(fields, toCardPlayer({ ...SCORER, facts }, "ice_hockey", "H"), LOOKS.H, undefined, undefined, "scoring");
    expect(scoringShown(fields)).toBe("11 G · 6 A · 17 PTS");
    expect(factsShown(fields)).toBe("");
  });

  it("writes the same as today for a player with no facts and no scoring numbers, in either view", () => {
    const today = card();
    const scoring = card();
    writeCard(today, toCardPlayer(QUELLENBACH, "ice_hockey", "H"), LOOKS.H);
    writeCard(scoring, toCardPlayer(QUELLENBACH, "ice_hockey", "H"), LOOKS.H, undefined, undefined, "scoring");
    expect(scoring).toEqual(today);
    expect(f(today.factsBox).hidden).toBe(true);
  });

  it("keeps the box under the name the same height in both views, so the name never moves on a swap", () => {
    const fields = card();
    for (const facts of [[], ["Committed to Fresno State"], ["4-year starter", "Team captain", "All-league 1st team", "Committed to Cal Poly", "School record 41 points"]]) {
      const player = toCardPlayer({ ...SCORER, facts }, "ice_hockey", "H");
      writeCard(fields, player, LOOKS.H);
      const factsHeight = f(fields.factsBox).style.height;
      writeCard(fields, player, LOOKS.H, undefined, undefined, "scoring");
      expect(f(fields.factsBox).style.height).toBe(factsHeight);
      expect(parseFloat(factsHeight)).toBeGreaterThan(0);
    }
  });

  it("never touches the card's own size, or the stats column", () => {
    const facts = card();
    const scoring = card();
    const player = toCardPlayer({ ...SCORER, facts: ["Committed to Fresno State"] }, "ice_hockey", "H");
    writeCard(facts, player, LOOKS.H);
    writeCard(scoring, player, LOOKS.H, undefined, undefined, "scoring");
    expect(f(scoring.root).style).toEqual({});
    expect(shown(scoring.season)).toBe(shown(facts.season));
  });
});

describe("the rendered markup", () => {
  const hero = renderToStaticMarkup(createElement(PlayerCard));

  it("has every part writeCard writes, hidden until a player goes up", () => {
    for (const part of ["card", "slab", "jersey", "position", "code", "big", "plain", "before", "stressed", "after", "small-first", "small-last", "facts", "scoring", "fact-columns", "fact-0-0", `fact-1-${MAX_FACTS - 1}`, "season", "season-item-0", `season-item-${MAX_STAT_SLOTS - 1}`, "tonight", "tonight-item-0", `tonight-item-${MAX_STAT_SLOTS - 1}`]) {
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

  it("gives each section a fixed height and its rows a fixed height, so what is written never moves a section", () => {
    const slots = [...hero.matchAll(/data-card="(season|tonight)-item-\d+"/g)];
    expect(slots).toHaveLength(2 * MAX_STAT_SLOTS);
    expect(hero).toMatch(/data-card="season" class="grid[^"]*" style="[^"]*grid-auto-rows:1.1em/);
    expect(hero).toMatch(/style="height:3.712em;/);
    expect(hero).toMatch(/data-card="tonight-section" class="[^"]*" style="height:2.688em;/);
    expect(renderToStaticMarkup(createElement(PlayerCard, { tonight: false }))).toMatch(/style="height:6.4em;/);
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
    // All three stats, in the order they are said, one group.
    expect(player.stat_lines).toEqual(["64 car · 420 yds · 5 TD"]);
    expect(player.face?.season.map((item) => [item.label, item.group])).toEqual([["car", 0], ["yds", 0], ["TD", 0]]);
    expect(player.side).toBe("A");
  });

  it("other sports use every line as written, and ignore numbers", () => {
    const player = toCardPlayer({ ...QUELLENBACH, season_stats: { tkl: 3 }, season_lines: ["12 kills, 3 aces", " ", "31 digs"] }, "volleyball", "H");
    expect(player.stat_lines).toEqual(["12 kills, 3 aces", "31 digs"]);
    expect(player.face?.season).toEqual([]);
    expect(player.face?.seasonText).toBe("12 kills, 3 aces\n31 digs");
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
