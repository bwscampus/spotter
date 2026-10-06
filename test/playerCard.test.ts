import { describe, expect, it } from "vitest";
import { writeCard, type CardFields } from "@/components/PlayerCard";
import { asOfLabel, byJersey, toCardPlayer, type CardSource } from "@/lib/cards/cardPlayer";

// =============================================================================
// What a card says. writeCard is the hot path, so it is tested the way it runs:
// against elements it can only set text, hidden and a style on. Vitest runs in
// node, so these are plain objects with exactly those properties.
// =============================================================================

type Fake = { textContent: string; hidden: boolean; style: { color: string; textTransform: string } };

const el = (): Fake => ({ textContent: "", hidden: false, style: { color: "", textTransform: "" } });

function fields(compact = false): CardFields & Record<string, unknown> {
  return {
    root: el(),
    compact,
    jersey: el(),
    first: el(),
    last: el(),
    spelled: el(),
    vitals: el(),
    tonight: el(),
    stats: [el(), el(), el()],
    asOf: el(),
  } as unknown as CardFields & Record<string, unknown>;
}

const OSSUETTA: CardSource = {
  jersey: "17",
  first_name: "Nico",
  last_name: "Ossuetta",
  position: "LB",
  grade: "Sr",
  height: "6-1",
  weight: "205",
  pronunciations: ["oh-soo-EH-tuh"],
  season_stats: { tkl: 54, sacks: 4, sack_yds: 22, rush_att: 12, rush_yds: 40 },
  season_lines: [],
  stats_as_of: "2026-09-26",
};

const text = (element: unknown) => (element as Fake).textContent;
const hidden = (element: unknown) => (element as Fake).hidden;

describe("the card with a pronunciation note", () => {
  it("puts the pronunciation where the surname goes, keeping its case, and the surname small beside it", () => {
    const card = fields();
    writeCard(card, toCardPlayer(OSSUETTA, "football", "H"));
    expect(text(card.last)).toBe("oh-soo-EH-tuh");
    expect((card.last as unknown as Fake).style.textTransform).toBe("none");
    expect(text(card.spelled)).toBe("Ossuetta");
    expect(hidden(card.spelled)).toBe(false);
  });

  it("goes back to the plain surname for the next player in the same slot", () => {
    const card = fields();
    writeCard(card, toCardPlayer(OSSUETTA, "football", "H"));
    writeCard(card, toCardPlayer({ ...OSSUETTA, last_name: "Langan", pronunciations: [] }, "football", "H"));
    expect(text(card.last)).toBe("Langan");
    expect((card.last as unknown as Fake).style.textTransform).toBe("");
    expect(text(card.spelled)).toBe("");
    expect(hidden(card.spelled)).toBe(true);
  });
});

describe("the card's stats and as-of date", () => {
  it("shows the SEASON lines and the as-of stamp", () => {
    const card = fields();
    writeCard(card, toCardPlayer(OSSUETTA, "football", "H"));
    expect(card.stats.map(text)).toEqual(["SEASON 54 TKL 4 SACKS 22 YDS", "12 CAR 40 YDS", ""]);
    expect(text(card.asOf)).toBe("as of 9/26");
    expect(hidden(card.asOf)).toBe(false);
  });

  it("has no stamp without a date, or without stats to date", () => {
    const card = fields();
    writeCard(card, toCardPlayer({ ...OSSUETTA, stats_as_of: null }, "football", "H"));
    expect(hidden(card.asOf)).toBe(true);
    writeCard(card, toCardPlayer({ ...OSSUETTA, season_stats: null }, "football", "H"));
    expect(hidden(card.asOf)).toBe(true);
    expect(card.stats.every((slot) => hidden(slot))).toBe(true);
  });
});

describe("toCardPlayer", () => {
  it("football builds lines from the numbers and ignores any text lines", () => {
    const player = toCardPlayer({ ...OSSUETTA, season_lines: ["stale line"] }, "football", "A");
    expect(player.stat_lines[0]).toBe("SEASON 54 TKL 4 SACKS 22 YDS");
    expect(player.side).toBe("A");
  });

  it("other sports use the lines as written, and ignore numbers", () => {
    const player = toCardPlayer(
      { ...OSSUETTA, season_stats: { tkl: 3 }, season_lines: ["12 kills, 3 aces", " ", "31 digs"] },
      "volleyball",
      "H",
    );
    expect(player.stat_lines).toEqual(["12 kills, 3 aces", "31 digs"]);
    expect(player.pronunciation).toBe("oh-soo-EH-tuh");
  });

  it("uses the first pronunciation that says anything", () => {
    expect(toCardPlayer({ ...OSSUETTA, pronunciations: ["  ", "AR-uh-gone"] }, "football", "H").pronunciation).toBe(
      "AR-uh-gone",
    );
  });
});

describe("asOfLabel", () => {
  it("reads the date as written, with no time zone shift", () => {
    expect(asOfLabel("2026-10-01")).toBe("as of 10/1");
    expect(asOfLabel("2026-09-26")).toBe("as of 9/26");
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
