import { describe, expect, it } from "vitest";
import { EMPTY_SESSION, readPlays, type StatsSession } from "@/lib/livestats/session";
import { RULES, type Action, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// R32 (Oct 10): an extra point or a field goal with no kicker read, or one the
// words never name, goes to that side's kicker (kickerFor: the one already
// credited with a kick tonight, else the roster's only kicker), estimated.
// Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H3-BOOTHBY", side: "home", jersey: "3", first: "Kit", last: "Boothby", position: "K" },
  { playerId: "H4-LINDQVIST", side: "home", jersey: "4", first: "Ole", last: "Lindqvist", position: "K" },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "A8-STRAND", side: "away", jersey: "8", first: "Bo", last: "Strand", position: "K" },
  { playerId: "A31-RENNICK", side: "away", jersey: "31", first: "Tad", last: "Rennick", position: "RB" },
];

function kick(seqStart: number, action: "extra_point" | "field_goal", playerId: string, offense: "home" | "away"): StatsPlay {
  const event: StatsEvent = { playerId, action: action as Action, yards: null, yardsSource: null, made: true };
  return {
    seqStart,
    seqEnd: seqStart + 1,
    quarter: 2,
    clock: null,
    down: null,
    distance: null,
    offense,
    playType: action,
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: action === "extra_point" ? "Extra point good" : "Field goal good",
    evidence: "",
    events: [event],
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
  };
}
const lines = (...said: Array<[number, string]>) => said.map(([seq, text]) => ({ seq, text }));
const kicker = (session: StatsSession, playId: string) =>
  session.plays.find((play) => play.playId === playId)!.play.events.find((event) => event.action === "extra_point" || event.action === "field_goal");

/** Home kicks a field goal with the second kicker, named, so he is the one kicking tonight. */
function afterLindqvist(): StatsSession {
  return readPlays(EMPTY_SESSION, [kick(10, "field_goal", "H4-LINDQVIST", "home")], ROSTER, 1000, {
    utterances: lines([10, "lindqvist from 30"], [11, "it is good"]),
    readThrough: 11,
  }).session;
}

describe("R32: the kicker on an extra point or field goal", () => {
  it("is a stat rule like the others", () => {
    expect(RULES).toContain("R32");
    expect(RULES).toHaveLength(28);
  });

  it("gives an extra point with no kicker read to that side's last kicker", () => {
    const { session } = readPlays(afterLindqvist(), [kick(20, "extra_point", "", "home")], ROSTER, 2000, {
      utterances: lines([20, "the kick"], [21, "is good"]),
      readThrough: 21,
    });
    expect(kicker(session, "20-21")).toMatchObject({ playerId: "H4-LINDQVIST", estimated: true, made: true });
    expect(session.plays[1].dropped).toContainEqual(expect.objectContaining({ rule: "R32", kind: "filled", to: "H4-LINDQVIST" }));
    expect(session.plays[1].changes).toContainEqual(expect.objectContaining({ playerId: "H4-LINDQVIST", key: "xpm", amount: 1 }));
  });

  it("gives a field goal whose kicker is not named to that side's last kicker", () => {
    const { session } = readPlays(afterLindqvist(), [kick(20, "field_goal", "H3-BOOTHBY", "home")], ROSTER, 2000, {
      utterances: lines([20, "the field goal try"], [21, "it's good"]),
      readThrough: 21,
    });
    expect(kicker(session, "20-21")).toMatchObject({ playerId: "H4-LINDQVIST", estimated: true });
  });

  it("before any kick, gives it to the side's only kicker", () => {
    const { session } = readPlays(EMPTY_SESSION, [kick(20, "extra_point", "", "away")], ROSTER, 2000, {
      utterances: lines([20, "extra point"], [21, "good"]),
      readThrough: 21,
    });
    expect(kicker(session, "20-21")).toMatchObject({ playerId: "A8-STRAND", estimated: true });
  });

  it("leaves it blank with two kickers and no kick yet", () => {
    const { session } = readPlays(EMPTY_SESSION, [kick(20, "extra_point", "H3-BOOTHBY", "home")], ROSTER, 2000, {
      utterances: lines([20, "extra point"], [21, "good"]),
      readThrough: 21,
    });
    expect(kicker(session, "20-21")).toBeUndefined();
    expect(session.plays[0].dropped).toContainEqual(expect.objectContaining({ rule: "R18", kind: "dropped", playerId: "H3-BOOTHBY" }));
    expect(session.plays[0].dropped.map((note) => note.rule)).not.toContain("R32");
  });

  it("keeps a kicker who is named", () => {
    const { session } = readPlays(afterLindqvist(), [kick(20, "extra_point", "H3-BOOTHBY", "home")], ROSTER, 2000, {
      utterances: lines([20, "boothby on for the extra point"], [21, "good"]),
      readThrough: 21,
    });
    expect(kicker(session, "20-21")).toEqual(expect.objectContaining({ playerId: "H3-BOOTHBY" }));
    expect(kicker(session, "20-21")?.estimated).toBeUndefined();
  });

  it("gives the reader's kicker back when he is named a line later", () => {
    let session = readPlays(afterLindqvist(), [kick(20, "extra_point", "H3-BOOTHBY", "home")], ROSTER, 2000, {
      utterances: lines([20, "extra point"], [21, "good"]),
      readThrough: 21,
    }).session;
    expect(kicker(session, "20-21")).toMatchObject({ playerId: "H4-LINDQVIST", estimated: true });
    session = readPlays(session, [], ROSTER, 3000, {
      utterances: lines([20, "extra point"], [21, "good"], [22, "boothby with his first of the night"]),
      readThrough: 22,
    }).session;
    expect(kicker(session, "20-21")).toMatchObject({ playerId: "H3-BOOTHBY" });
    expect(session.plays[1].dropped).toContainEqual(expect.objectContaining({ rule: "R32", kind: "restored", playerId: "H3-BOOTHBY" }));
  });
});
