import { describe, expect, it } from "vitest";
import { cuedPlayType, playCues, type PlayCues } from "@/lib/livestats/parse/playWords";

// The lexicons (v7, Part 2): which words say what. Table-driven, synthetic.

type Keys = Array<keyof Omit<PlayCues, "any" | "matched">>;

const cases: Array<[string, Keys]> = [
  ["hands it off to fennimore up the middle", ["rush"]],
  ["castellane keeps it himself", ["rush"]],
  ["scrambles out to his right", ["rush"]],
  ["sweep to the left side", ["rush"]],
  ["fennimore carries it again", ["rush"]],
  ["castellane drops back and throws", ["pass"]],
  ["fires one over the middle", ["pass"]],
  ["hauls it in at the 40", ["complete"]],
  ["caught by tafita", ["complete"]],
  ["grabs it for a first down", ["complete", "firstDown", "result"]],
  ["and that one falls incomplete", ["incomplete", "result"]],
  ["broken up by brown", ["incomplete", "result"]],
  ["dropped by the receiver", ["incomplete", "result"]],
  ["overthrown and out of bounds", ["incomplete", "result"]],
  ["batted down at the line", ["incomplete", "result", "snap"]],
  ["sacked by quillon for a loss of 8", ["sack", "result"]],
  ["brought down behind the line before he could throw", ["sack", "pass", "tackle", "result"]],
  ["intercepted by brown", ["turnover", "result"]],
  ["picked off at the 30", ["turnover", "result"]],
  ["fumble and it is recovered by the bulldogs", ["turnover", "result"]],
  ["there is a flag on the play", ["penalty"]],
  ["holding number 72", ["penalty"]],
  ["false start on the offense", ["penalty"]],
  ["pass interference in the end zone", ["penalty", "touchdown", "result"]],
  ["brought down by quillon at the 35", ["tackle", "result"]],
  ["wraps him up at the 20", ["tackle", "result"]],
  ["pushed out of bounds at the 44", ["tackle", "result"]],
  ["touchdown sharks", ["touchdown", "result"]],
  ["takes it to the house", ["touchdown", "result"]],
  ["that will move the chains", ["firstDown"]],
  ["punt is away", ["kick"]],
  ["field goal attempt from 42", ["kick"]],
  ["let's look at that again", ["replay"]],
  ["on the replay you can see him slip", ["replay"]],
  ["takes the snap from the shotgun", ["snap"]],
  ["under center with trips right", ["snap"]],
  ["the marching band is on the field", []],
  ["brought to you by the valley credit union", []],
];

describe("playCues", () => {
  for (const [text, keys] of cases) {
    it(text, () => {
      const cues = playCues(text);
      const on = (Object.keys(cues) as Array<keyof PlayCues>).filter((key) => key !== "any" && key !== "matched" && cues[key] === true);
      expect(on.sort()).toEqual([...keys].sort());
      expect(cues.any).toBe(keys.length > 0);
    });
  }

  it("ranks a sack over a pass over a run", () => {
    expect(cuedPlayType(playCues("drops back and is sacked"))).toBe("sack");
    expect(cuedPlayType(playCues("throws it to the back"))).toBe("pass");
    expect(cuedPlayType(playCues("hands it off"))).toBe("rush");
    expect(cuedPlayType(playCues("punts it away"))).toBe("kick");
    expect(cuedPlayType(playCues("the band plays"))).toBeNull();
  });
});
