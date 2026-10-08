import { describe, expect, it } from "vitest";
import { decideHeard, pickSoundCheck, SOUND_CHECK_PER_TEAM, type SoundCheckName } from "@/lib/game/soundCheck";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";

// =============================================================================
// The name sound check's decisions (lib/game/soundCheck.ts): who is asked for,
// and what one transcript says about a name. Made-up names only.
// =============================================================================

const player = (jersey: string, first_name: string, last_name: string, priority?: number): GamePlayer => ({
  jersey,
  first_name,
  last_name,
  position: "RB",
  spoken_forms: spokenForms(last_name),
  ...(priority !== undefined ? { priority } : {}),
});

describe("pickSoundCheck", () => {
  it("takes each side's most called names, away first, ties in roster order", () => {
    const home = Array.from({ length: SOUND_CHECK_PER_TEAM + 3 }, (_, i) => player(String(i + 1), "H", `Homer${i}`, i === 4 ? 9 : (SOUND_CHECK_PER_TEAM + 3 - i) / 10));
    const away = [player("5", "Marek", "Quillon", 1), player("17", "Lio", "Dunmore", 2), player("99", "Nobody", "Rated")];
    const picked = pickSoundCheck(buildGameWatchlist(home, away).entries);
    expect(picked).toHaveLength(SOUND_CHECK_PER_TEAM + 3);
    expect(picked.slice(0, 3).map((name) => name.last_name)).toEqual(["Dunmore", "Quillon", "Rated"]);
    expect(picked[3].last_name).toBe("Homer4");
    expect(picked[4].last_name).toBe("Homer0");
    expect(picked.filter((name) => name.side === "H")).toHaveLength(SOUND_CHECK_PER_TEAM);
    expect(picked.map((name) => name.last_name)).not.toContain(`Homer${SOUND_CHECK_PER_TEAM + 2}`);
  });

  it("carries every form the matcher listens for", () => {
    const [name] = pickSoundCheck(buildGameWatchlist([], [{ ...player("3", "Kai", "Sanchez-Greenfield"), spoken_forms: spokenForms("Sanchez-Greenfield", ["san-chez"]) }]).entries);
    expect(name.forms).toEqual(expect.arrayContaining(["sanchezgreenfield", "sanchez", "greenfield", "sanchez"]));
    expect(name.entry).toBe("Sanchez-Greenfield");
  });
});

describe("decideHeard", () => {
  const vexley: SoundCheckName = { side: "H", jersey: "7", first_name: "Noah", last_name: "Vexley", entry: "Vexley", forms: ["vexley"], priority: 3 };

  it("is right when any word is one of the forms", () => {
    expect(decideHeard("noah vexley", vexley)).toEqual({ kind: "right", word: "vexley" });
    expect(decideHeard("Vexley.", vexley)).toEqual({ kind: "right", word: "vexley" });
  });

  it("offers what was written instead of the surname, without the first name or filler", () => {
    expect(decideHeard("noah vecksley", vexley)).toEqual({ kind: "different", form: "vecksley" });
    expect(decideHeard("uh the vecksley there", vexley)).toEqual({ kind: "different", form: "vecksley" });
    expect(decideHeard("marie sano", { ...vexley, last_name: "Reescanto", forms: ["reescanto"] })).toEqual({ kind: "different", form: "marie sano" });
  });

  it("hears a two-part surname said as two words", () => {
    const cruz: SoundCheckName = { ...vexley, last_name: "De La Cruz", forms: ["delacruz", "cruz"] };
    expect(decideHeard("de la cruz", cruz)).toMatchObject({ kind: "right" });
  });

  it("has nothing when only the first name, filler or everyday words came through", () => {
    expect(decideHeard("noah", vexley)).toEqual({ kind: "nothing" });
    expect(decideHeard("uh the and for", vexley)).toEqual({ kind: "nothing" });
    expect(decideHeard("", vexley)).toEqual({ kind: "nothing" });
  });
});
