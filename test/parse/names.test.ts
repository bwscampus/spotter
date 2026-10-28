import { describe, expect, it } from "vitest";
import { bestHits, buildNameIndex, nameHits, SCORE_EXACT, SCORE_FIRST_LAST, SCORE_JERSEY_CUE, SCORE_JERSEY_POSITION, SCORE_SPELLING } from "@/lib/livestats/parse/names";
import { tokenize } from "@/lib/livestats/parse/tokens";
import { ROSTER } from "./roster";

// Who a line names (v7, Part 2), with the ASR's quirks: misspellings, sound-
// alikes, a split surname, a jersey cue, two players who share a surname.
// Synthetic roster; "tafitaga" for Tafita stands in for a real garbling the
// brief cites, under a made-up name.

const index = buildNameIndex(ROSTER);
const hits = (text: string) => bestHits(nameHits(tokenize(text), index));
const ids = (text: string, min = 0.55) =>
  hits(text)
    .filter((hit) => hit.score >= min)
    .map((hit) => hit.playerId);

describe("nameHits", () => {
  it("finds the surname as written, at 1.0", () => {
    const [hit] = hits("fennimore up the middle");
    expect(hit).toMatchObject({ playerId: "H22-FENNIMORE", score: SCORE_EXACT, how: "exact", span: [0, 0], viaJersey: false });
  });

  it("finds a first name and surname together, and the first name alone only below the line", () => {
    expect(hits("reed fennimore up the middle")[0]).toMatchObject({ playerId: "H22-FENNIMORE", score: SCORE_FIRST_LAST, how: "first_last", span: [0, 1] });
    const alone = hits("reed up the middle");
    expect(alone[0]).toMatchObject({ playerId: "H22-FENNIMORE", score: 0.5, how: "first" });
    expect(ids("reed up the middle")).toEqual([]);
  });

  it("reads a garbled surname by sound: tafitaga is Tafita at 0.7 or better", () => {
    const [hit] = hits("tafitaga hauls it in");
    expect(hit.playerId).toBe("H3-TAFITA");
    expect(hit.score).toBeGreaterThanOrEqual(0.7);
    expect(hit.how).toBe("sound");
  });

  it("reads a close spelling at 0.85", () => {
    expect(hits("fenimore picks up 4")[0]).toMatchObject({ playerId: "H22-FENNIMORE", score: SCORE_SPELLING, how: "spelling" });
    expect(hits("quillan on the stop")[0]).toMatchObject({ playerId: "A17-QUILLON", score: SCORE_SPELLING });
  });

  it("returns both players who share a surname, at the same score", () => {
    const browns = hits("brown breaks it up").filter((hit) => hit.playerId.endsWith("-BROWN"));
    expect(browns.map((hit) => hit.playerId).sort()).toEqual(["A4-BROWN", "H11-BROWN"]);
    expect(browns[0].score).toBe(browns[1].score);
    // The first name settles it.
    expect(ids("jace brown breaks it up")).toEqual(["A4-BROWN"]);
  });

  it("finds a hyphenated surname by either half and split across words", () => {
    expect(ids("okonkwo falls on it")).toEqual(["H55-OKONKWO-REYES"]);
    expect(ids("reyes falls on it")).toEqual(["H55-OKONKWO-REYES"]);
    expect(ids("ndiaye hall hauls it in")).toEqual(["A81-NDIAYE-HALL"]);
    expect(ids("van tree out of the backfield")).toEqual(["H88-VANTREE"]);
  });

  it("reads a jersey number with a cue beside it, on both sides when both have the number", () => {
    const cued = hits("number 22 up the middle");
    expect(cued.map((hit) => hit.playerId).sort()).toEqual(["A22-GRENVILLE", "H22-FENNIMORE"]);
    expect(cued[0]).toMatchObject({ score: SCORE_JERSEY_CUE, viaJersey: true, how: "jersey" });
    expect(hits("the tailback 22 bounces outside")[0]).toMatchObject({ score: SCORE_JERSEY_POSITION, viaJersey: true });
    expect(hits("22 the running back")[0]).toMatchObject({ score: SCORE_JERSEY_POSITION, viaJersey: true });
    // A bare number is a score, a clock, a yard line: nobody.
    expect(ids("down to the 22")).toEqual([]);
    expect(ids("leads 22 to 7")).toEqual([]);
  });

  it("does not take a word that is exactly one player's name as a near miss of another's", () => {
    // "brown" is two players exactly; nobody else sounds like it.
    expect([...ids("brown")].sort()).toEqual(["A4-BROWN", "H11-BROWN"]);
  });

  it("names nobody on ordinary talk", () => {
    expect(ids("the band is on the field and the crowd is loud")).toEqual([]);
    expect(ids("third and seven from the 31")).toEqual([]);
  });

  it("keeps a heard-as form as the player's own word", () => {
    const roster = ROSTER.map((player) => (player.playerId === "H7-CASTELLANE" ? { ...player, aliases: ["castle lane"] } : player));
    const own = buildNameIndex(roster);
    const found = bestHits(nameHits(tokenize("castlelane throws it"), own));
    expect(found[0]).toMatchObject({ playerId: "H7-CASTELLANE", score: SCORE_EXACT, how: "alias" });
  });
});
