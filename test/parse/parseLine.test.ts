import { describe, expect, it } from "vitest";
import { parseContextFor, parseLine } from "@/lib/livestats/parse";
import { ROSTER, TEAMS } from "./roster";

// One line through everything at once (v7, Part 2): the shape the segmenter
// and the candidate builder read. Synthetic lines in the ASR's own style.

const context = parseContextFor(ROSTER, TEAMS, "home");

describe("parseLine", () => {
  it("reads a whole play line: the names, the play words, the spot and the number", () => {
    const line = parseLine("castellane hands off to fennimore up the middle picks up 7 out to the 38 brought down by quillon", context, 12);
    expect(line.seq).toBe(12);
    expect(line.dd).toBeNull();
    expect(line.cues).toMatchObject({ rush: true, tackle: true, result: true, pass: false });
    expect(line.nameHits.filter((hit) => hit.score >= 0.55).map((hit) => hit.playerId)).toEqual(["H7-CASTELLANE", "H22-FENNIMORE", "A17-QUILLON"]);
    expect(line.spots).toEqual([expect.objectContaining({ yardLine: 38, kind: "end" })]);
    expect(line.numbers.map((number) => number.value)).toEqual([7, 38]);
  });

  it("reads a down and distance call with its spot", () => {
    const line = parseLine("second and 3 from the bulldogs 44", context);
    expect(line.dd).toMatchObject({ down: 2, distance: 3 });
    expect(line.spots).toEqual([expect.objectContaining({ yardLine: 44, territory: "opp", team: "away", kind: "start" })]);
    expect(line.cues.any).toBe(false);
  });

  it("builds the name index once per roster", () => {
    expect(parseContextFor(ROSTER).names).toBe(parseContextFor(ROSTER).names);
  });

  it("is quiet on talk that is not football", () => {
    const line = parseLine("the sharks are wearing their throwback uniforms tonight", context);
    expect(line.dd).toBeNull();
    expect(line.spots).toEqual([]);
    expect(line.cues.any).toBe(false);
    expect(line.nameHits.filter((hit) => hit.score >= 0.55)).toEqual([]);
  });
});
