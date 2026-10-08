import { describe, expect, it } from "vitest";
import type { DeepgramResults } from "@/lib/deepgram/config";
import { assembleGame, type GamePlayerRow } from "@/lib/game/buildGame";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";
import { hasSuffix, stripSuffix } from "@/lib/rosters/suffix";

// Suffixes (Oct 4): nobody says "junior". "roberts" scored 0.81 against
// "Roberts Jr." all night and never fired. The bare surname is now a form of
// the entry and its keyterm, while the card keeps the name as printed.
// Through the real engine and the real matcher. Made-up names only.

function result(transcript: string): DeepgramResults {
  const words = transcript.split(" ").map((word, index) => ({ word, start: index * 0.3, end: index * 0.3 + 0.25, confidence: 0.98 }));
  return { type: "Results", is_final: true, speech_final: true, start: 0, duration: words.length * 0.3, channel: { alternatives: [{ transcript, confidence: 0.98, words }] } };
}

const player = (jersey: string, first_name: string, last_name: string, extra: Partial<GamePlayer> = {}): GamePlayer => ({
  jersey,
  first_name,
  last_name,
  spoken_forms: spokenForms(last_name),
  ...extra,
});

describe("stripSuffix", () => {
  it("drops Jr., Sr., II, III, IV and V, however punctuated, and nothing else", () => {
    expect(stripSuffix("Roberts Jr.")).toBe("Roberts");
    expect(stripSuffix("Beebe, Sr")).toBe("Beebe");
    expect(stripSuffix("Molette III")).toBe("Molette");
    expect(stripSuffix("French IV")).toBe("French");
    expect(stripSuffix("Bootle II")).toBe("Bootle");
    expect(stripSuffix("Sanchez-Greenfield")).toBe("Sanchez-Greenfield");
    expect(stripSuffix("Vila")).toBe("Vila");
    expect(hasSuffix("Roberts Jr.")).toBe(true);
    expect(hasSuffix("Roberts")).toBe(false);
  });
});

describe("a suffixed surname in a game", () => {
  it.each([
    ["Roberts Jr.", "roberts"],
    ["Beebe Sr.", "beebe"],
    ["Bootle II", "bootle"],
    ["Molette III", "molette"],
    ["French IV", "french"],
  ])("%s fires on %s, exactly", (printed, said) => {
    const { entries } = buildGameWatchlist([player("5", "Antwan", printed)], [player("9", "Kai", "Quillon")]);
    const entry = entries.find((each) => each.name === printed)!;
    expect(entry.aliases).toContain(said);
    expect(entry.keyterm).toBe(stripSuffix(printed));
    expect(entry.label).toBe(printed);

    const engine = new SpotterEngine(entries, { sport: "football", teamCues: [] });
    const outcome = engine.process(result(`${said} up the middle for six`), 1, 0, 0);
    expect(outcome.display?.players.map((card) => card.last_name)).toEqual([printed]);
    const match = outcome.rows.find((row) => row.type === "match")!;
    expect(match.score).toBe(1);
  });

  it("keeps the card's name as printed", () => {
    const { entries } = buildGameWatchlist([player("5", "Antwan", "Roberts Jr.")], []);
    expect(entries[0].players?.[0].last_name).toBe("Roberts Jr.");
    expect(entries[0].name).toBe("Roberts Jr.");
  });

  it("leaves a surname with no suffix exactly as it was", () => {
    const { entries } = buildGameWatchlist([player("3", "Sam", "Sanchez-Greenfield")], []);
    expect(entries[0]).toMatchObject({ name: "Sanchez-Greenfield", aliases: ["sanchez", "greenfield"], keyterm: "Sanchez-Greenfield" });
  });

  it("reaches a saved roster whose stored forms predate the fix, because the game builds the forms again", () => {
    const HOME = { id: "home", school: "Harborview", mascot: "Gulls", sport: "football" };
    const AWAY = { id: "away", school: "Millbrook", mascot: "Foxes", sport: "football" };
    const row: GamePlayerRow = {
      roster_id: "home",
      jersey: "5",
      first_name: "Antwan",
      last_name: "Roberts Jr.",
      position: "RB",
      grade: null,
      height: null,
      weight: null,
      pronunciations: [],
      // As an older save might have stored them.
      spoken_forms: ["robertsjr"],
      spot_mode: "normal",
      season_stats: null,
      season_lines: [],
      stats_as_of: null,
    };
    const loaded = assembleGame(HOME, AWAY, [row, { ...row, roster_id: "away", jersey: "9", last_name: "Quillon", first_name: "Kai" }]);
    const roberts = loaded.watchlist.entries.find((entry) => entry.name === "Roberts Jr.")!;
    expect(roberts.aliases).toContain("roberts");
    expect(loaded.watchlist.keyterms).toContain("Roberts");
    expect(loaded.watchlist.keyterms).not.toContain("Roberts Jr.");
  });
});
