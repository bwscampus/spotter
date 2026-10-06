import { describe, expect, it } from "vitest";
import { describeRosterChanges } from "@/lib/game/rosterChanges";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";

const player = (
  jersey: string | null,
  last_name: string,
  over: Partial<GamePlayer> = {},
): GamePlayer => ({
  jersey,
  last_name,
  first_name: null,
  spoken_forms: spokenForms(last_name),
  stat_lines: [],
  ...over,
});

const HOME = [player("12", "Chen"), player("23", "Williams")];
const AWAY = [player("5", "Hayes")];
const before = buildGameWatchlist(HOME, AWAY).entries;

const after = (home: GamePlayer[], away: GamePlayer[] = AWAY) =>
  describeRosterChanges(before, buildGameWatchlist(home, away).entries);

describe("describeRosterChanges", () => {
  it("says nothing changed when nothing did", () => {
    expect(after(HOME)).toBe("No changes.");
  });

  it("counts a player added and a player dropped", () => {
    expect(after([...HOME, player("7", "Brooks")])).toBe("1 added");
    expect(after([HOME[0]])).toBe("1 removed");
  });

  it("counts a jersey fixed as a renumbering, not as a new player", () => {
    expect(after([player("21", "Chen"), HOME[1]])).toBe("1 renumbered");
  });

  it("counts a stats upload", () => {
    expect(after([player("12", "Chen", { stat_lines: ["14 ppg"] }), HOME[1]])).toBe("1 with new stats");
  });

  it("counts a pronunciation typed on the teams screen", () => {
    // Pronunciations are folded into spoken_forms when a roster is saved, so
    // this is what a refresh actually sees come back.
    const withSaid = player("12", "Chen", { spoken_forms: spokenForms("Chen", ["shen"]) });
    expect(after([withSaid, HOME[1]])).toBe("1 pronunciation added");
  });

  it("says everything that changed, in one line", () => {
    expect(after([player("21", "Chen", { stat_lines: ["14 ppg"] }), HOME[1], player("7", "Brooks")])).toBe(
      "1 added · 1 renumbered · 1 with new stats",
    );
  });

  it("lines a player up by side, so the same surname on both teams is two people", () => {
    expect(after(HOME, [player("5", "Hayes"), player("9", "Chen")])).toBe("1 added");
  });
});
