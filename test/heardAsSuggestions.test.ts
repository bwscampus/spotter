import { describe, expect, it } from "vitest";
import { MIN_TIMES, suggestHeardAs } from "@/lib/game/heardAsSuggestions";
import type { StoredRecord } from "@/lib/log/records";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";

// =============================================================================
// Learning from the last game: the words Deepgram wrote three or more times
// that are on neither roster, are not everyday words, and sound like exactly
// one roster name. Made-up names only: Vexley was written "vecksley".
// =============================================================================

const player = (jersey: string, first_name: string, last_name: string, side: "H" | "A", priority = 0): GamePlayer => ({
  jersey,
  first_name,
  last_name,
  position: side === "H" ? "QB" : "LB",
  spoken_forms: spokenForms(last_name),
  priority,
});

const HOME = [player("7", "Noah", "Vexley", "H", 3), player("81", "Tobin", "Pruett", "H", 2)];
const AWAY = [player("5", "Marek", "Quillon", "A", 2), player("17", "Lio", "Dunmore", "A", 1)];

function log(lines: string[], withGame = true): StoredRecord[] {
  const { entries, keyterms } = buildGameWatchlist(HOME, AWAY);
  const records: StoredRecord[] = [];
  if (withGame) {
    records.push({
      kind: "game",
      gameId: "g1",
      at: 1,
      snapshot: {
        home: { id: "h", name: "Northfield", wearing: null },
        away: { id: "a", name: "Westmere", wearing: null },
        sport: "football",
        watchlist: entries,
        keyterms,
        teamCues: [
          { words: ["northfield"], side: "H" },
          { words: ["westmere"], side: "A" },
        ],
        statsEnabled: true,
      },
    });
  }
  lines.forEach((text, index) => records.push({ kind: "utterance", gameId: "g1", at: 2 + index, connectionId: 1, text, offsetMs: index * 1000 }));
  return records;
}

const repeat = (text: string, times: number) => Array.from({ length: times }, () => text);

describe("suggestHeardAs", () => {
  it("offers a word written three or more times that sounds like one roster name, with the player to add it to", () => {
    const records = log([
      ...repeat("vecksley back to throw", MIN_TIMES + 1),
      "vecksley to pruett for the first down",
      ...repeat("quillon with the stop", MIN_TIMES),
      ...repeat("noah under center", MIN_TIMES),
      ...repeat("early in the second quarter", MIN_TIMES),
      ...repeat("zorbax zorbax", MIN_TIMES),
      "northfield westmere",
    ]);
    const suggestions = suggestHeardAs(records);
    expect(suggestions.map((each) => each.word)).toEqual(["vecksley"]);
    expect(suggestions[0]).toMatchObject({
      times: MIN_TIMES + 2,
      entry: "Vexley",
      label: "Vexley",
      players: [{ side: "H", jersey: "7", first_name: "Noah", last_name: "Vexley" }],
    });
    expect(suggestions[0].score).toBeGreaterThan(0.5);
  });

  it("ignores roster names, first names, team words and everyday words however often they come up", () => {
    const words = suggestHeardAs(log([...repeat("quillon pruett noah northfield westmere early hard", 10)])).map((each) => each.word);
    expect(words).toEqual([]);
  });

  it("needs the word three times", () => {
    expect(suggestHeardAs(log(repeat("vecksley throws", MIN_TIMES - 1)))).toEqual([]);
    expect(suggestHeardAs(log(repeat("vecksley throws", MIN_TIMES)))).toHaveLength(1);
  });

  it("gives nothing for a log with no game record", () => {
    expect(suggestHeardAs(log(repeat("vecksley throws", MIN_TIMES), false))).toEqual([]);
  });
});
