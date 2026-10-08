import { describe, expect, it } from "vitest";
import { STATS_SCHEMA, STATS_SYSTEM_PROMPT } from "@/lib/livestats/prompt";

// The reader's prompt carries the Oct 4 wording: what the transcript is, how
// to send a player nobody could read, the score, the flag, and the examples
// from the two college audits. Each line here is one of those.

describe("STATS_SYSTEM_PROMPT, after the Oct 4 audits", () => {
  it("says the transcript is machine-made and the roster carries first names", () => {
    expect(STATS_SYSTEM_PROMPT).toContain("The transcript is machine-made and misspells names");
    expect(STATS_SYSTEM_PROMPT).toContain("The roster lines carry first names");
  });

  it("asks for a pass event on every pass, and an empty playerId for a player nobody could read", () => {
    expect(STATS_SYSTEM_PROMPT).toContain("A pass always comes back with a pass event");
    expect(STATS_SYSTEM_PROMPT).toContain('send that event with playerId ""');
    expect(STATS_SYSTEM_PROMPT).toContain('A run or a catch whose player cannot be read comes back with playerId "" too');
    expect(STATS_SYSTEM_PROMPT).toContain("A misspelled name that clearly points at one offensive skill player is that player, at low confidence");
  });

  it("asks for the score and the flag, and for later reads to update a play", () => {
    expect(STATS_SYSTEM_PROMPT).toContain("score is the score whenever this play's lines state it");
    expect(STATS_SYSTEM_PROMPT).toContain("noPlay is true when the down is replayed or the play comes back, which includes accepted defensive pass interference on an incomplete pass");
    expect(STATS_SYSTEM_PROMPT).toContain("beforeSnap is true for a foul that happens before the snap");
    expect(STATS_SYSTEM_PROMPT).toContain("Wording that looks back at a play never makes a new play");
    expect(STATS_SYSTEM_PROMPT).toContain("Return that play again with updates set to its id");
  });

  it.each([
    ['"dumps it short, inaccurately", "dropped by", "off target", "couldn\'t hang on"', "an incomplete pass. The passer gets pass_incomplete; the receiver named is never charged"],
    ['"just slipped, oh man, touchdown", said about what would have been', "an incomplete pass, and no touchdown"],
    ["A pitch or a handoff right after a missed field goal or a punt is a run from scrimmage, never a kickoff return", "A kickoff only follows a score or starts a half"],
    ['"out of the backfield" with a catch word', "is a reception"],
    ['"takes the handoff from the quarterback" is a run, never a completion', ""],
    ["A stat said as commentary is still that play", '"just 4 yards on 1st down", "pushing ahead past the 40"'],
    ["A mascot or a nickname is not a formation", '"another type of wildcat"'],
  ])("has the example %s", (lead, rest) => {
    expect(STATS_SYSTEM_PROMPT).toContain(lead);
    if (rest) expect(STATS_SYSTEM_PROMPT).toContain(rest);
  });

  it("has the Oct 6 wording: what a sack is, a return is never a run, and a pass the words do not call a pass", () => {
    expect(STATS_SYSTEM_PROMPT).toContain("A sack is a pass play where the quarterback is tackled behind the line of scrimmage.");
    expect(STATS_SYSTEM_PROMPT).not.toContain("A sack needs the word");
    expect(STATS_SYSTEM_PROMPT).toContain("A return right after a kickoff or a punt is a return, never a run.");
    expect(STATS_SYSTEM_PROMPT).toContain("if the quarterback is named as throwing, or is named just before him, it is a pass");
    expect(STATS_SYSTEM_PROMPT).toContain("One snap is one play.");
  });

  it("has the score and the flag in the schema, with the flag costing no nullable field", () => {
    const play = (STATS_SCHEMA.properties.plays.items as { properties: Record<string, unknown> }).properties;
    expect(play.score).toBeDefined();
    expect(play.penalty).toMatchObject({ type: "object", required: ["on", "noPlay", "beforeSnap"] });
  });
});
