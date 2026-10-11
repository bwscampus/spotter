import { describe, expect, it } from "vitest";
import { crossTeamUpdate } from "@/lib/livestats/merge";
import { correctPlay, EMPTY_SESSION, readPlays, type StatsSession } from "@/lib/livestats/session";
import type { Action, StatsEvent, StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// An update stays on its own team (R34), and the side check (R12) runs on a
// play again after an update. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB", season: { pass_att: 120 } },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR" },
  { playerId: "A12-VANTREE", side: "away", jersey: "12", first: "Oren", last: "Vantree", position: "QB", season: { pass_att: 100 } },
  { playerId: "A88-KOLBY", side: "away", jersey: "88", first: "Mace", last: "Kolby", position: "WR" },
  { playerId: "A84-RUDDER", side: "away", jersey: "84", first: "Jett", last: "Rudder", position: "WR" },
  { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
];
const INDEX = new Map(ROSTER.map((player) => [player.playerId, player]));

function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}
function play(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
    quarter: 2,
    clock: null,
    down: 1,
    distance: 10,
    offense: "away",
    playType: "pass",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: "a play",
    evidence: events.map((event) => event.playerId.split("-")[1].toLowerCase()).join(" "),
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    ...extra,
  };
}

/** An away touchdown pass, read and counted. */
function awayTouchdown(): StatsSession {
  const td = play(10, 12, [ev("A12-VANTREE", "pass_complete", 30), ev("A88-KOLBY", "reception", 30)], { touchdown: true });
  return readPlays(EMPTY_SESSION, [td], ROSTER, 1000).session;
}

describe("an update stays on its own team (R34)", () => {
  it("drops an update by id whose receiver is on the other team, and keeps the play as it was", () => {
    const session = awayTouchdown();
    const update = play(130, 133, [ev("H81-PREWITT", "reception", 22)], { offense: null, touchdown: true, updates: "10-12" });
    const after = readPlays(session, [update], ROSTER, 2000);
    expect(after.session.plays).toHaveLength(1);
    const kept = after.session.plays[0];
    expect(kept.play.events.map((event) => `${event.playerId} ${event.action}`)).toEqual(["A12-VANTREE pass_complete", "A88-KOLBY reception"]);
    expect(kept.play.touchdown).toBe(true);
    expect(kept.changes).toContainEqual(expect.objectContaining({ playerId: "A88-KOLBY", key: "rec_td", amount: 1 }));
    expect(kept.changes.some((change) => change.playerId === "H81-PREWITT")).toBe(false);
    expect(kept.updated).toBe(0);
    expect(kept.dropped).toContainEqual(expect.objectContaining({ rule: "R34", kind: "dropped", playerId: "H81-PREWITT", action: "reception" }));
    expect(after.added).toEqual([]);
    expect(after.updated.map((each) => each.playId)).toEqual(["10-12"]);
  });

  it("drops an update by id that says the other team had the ball", () => {
    const session = awayTouchdown();
    const update = play(130, 133, [], { offense: "home", updates: "10-12" });
    const kept = readPlays(session, [update], ROSTER, 2000).session.plays[0];
    expect(kept.play.touchdown).toBe(true);
    expect(kept.dropped).toContainEqual(expect.objectContaining({ rule: "R34", playerId: "" }));
  });

  it("still lets an update on the same team replace the receiver", () => {
    const session = awayTouchdown();
    const update = play(13, 14, [ev("A84-RUDDER", "reception")], { updates: "10-12" });
    const merged = readPlays(session, [update], ROSTER, 2000).session.plays[0];
    expect(merged.play.events.map((event) => `${event.playerId} ${event.action}`)).toEqual(["A12-VANTREE pass_complete", "A84-RUDDER reception"]);
    expect(merged.dropped.some((drop) => drop.rule === "R34")).toBe(false);
  });

  it("says why, and needs the earlier play's offense to say anything", () => {
    const earlier = play(10, 12, [], { offense: "away" });
    expect(crossTeamUpdate(play(20, 21, [ev("H22-FENNIMORE", "rush")], { offense: null }), earlier, INDEX)).toMatch(/rush to the home team/);
    expect(crossTeamUpdate(play(20, 21, [ev("A17-DUNMORE", "tackle")], { offense: null }), earlier, INDEX)).toBeNull();
    expect(crossTeamUpdate(play(20, 21, [ev("H22-FENNIMORE", "rush")]), { ...earlier, offense: null }, INDEX)).toBeNull();
  });
});

describe("the side check after an update (R12)", () => {
  it("drops a carry by a defender that a later read of the same lines brought in", () => {
    const run = play(10, 12, [ev("H22-FENNIMORE", "rush", 4)], { offense: "home", playType: "run" });
    const session = readPlays(EMPTY_SESSION, [run], ROSTER, 1000).session;
    const recap = play(10, 12, [ev("A17-DUNMORE", "rush")], { offense: null, playType: "run" });
    const merged = readPlays(session, [recap], ROSTER, 2000).session.plays[0];
    expect(merged.play.events.some((event) => event.playerId === "A17-DUNMORE" && event.action === "rush")).toBe(false);
    expect(merged.dropped).toContainEqual(expect.objectContaining({ rule: "R12", playerId: "A17-DUNMORE", action: "rush" }));
    expect(merged.changes.some((change) => change.playerId === "A17-DUNMORE")).toBe(false);
  });

  it("never drops a credit the announcer typed", () => {
    // A home completion whose catch an earlier read gave to an away receiver,
    // and the announcer typed the right receiver in.
    const pass = play(10, 12, [ev("H7-CASTELLANE", "pass_complete", 9), ev("H81-PREWITT", "reception", 9)], { offense: "home" });
    const read = readPlays(EMPTY_SESSION, [pass], ROSTER, 1000).session.plays[0];
    const swap = (id: string) => (id === "H81-PREWITT" ? "A88-KOLBY" : id);
    const misread = {
      ...read,
      play: { ...read.play, events: read.play.events.map((event) => ({ ...event, playerId: swap(event.playerId) })) },
      changes: read.changes.map((change) => ({ ...change, playerId: swap(change.playerId) })),
    };
    let session: StatsSession = { plays: [misread] };
    const index = misread.changes.findIndex((change) => change.playerId === "A88-KOLBY" && change.key === "rec");
    session = correctPlay(session, misread.playId, { type: "player", index, playerId: "H81-PREWITT" }).session;

    // A later read of the same lines adds a tackler, and the play is rebuilt.
    const tackle = play(10, 12, [ev("A17-DUNMORE", "tackle")], { offense: null });
    const rebuilt = readPlays(session, [tackle], ROSTER, 2000).session.plays[0];
    expect(rebuilt.dropped.some((drop) => drop.rule === "R12")).toBe(false);
    expect(rebuilt.changes).toContainEqual(expect.objectContaining({ playerId: "H81-PREWITT", key: "rec", amount: 1 }));
    expect(rebuilt.changes).toContainEqual(expect.objectContaining({ playerId: "A17-DUNMORE", key: "tkl", amount: 1 }));
  });
});
