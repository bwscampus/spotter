import { describe, expect, it } from "vitest";
import { tallyChanges } from "@/lib/cards/tonight";
import { findUpdateTarget, mergeUpdate, sameLines, UPDATE_LOOKBACK } from "@/lib/livestats/merge";
import { counted, EMPTY_SESSION, freshReads, okPlay, readPlays, talliesOf, undoLast, waiting, type StatsSession } from "@/lib/livestats/session";
import type { Action, StatsEvent, StatsPlay, StatsRosterPlayer, YardsSource } from "@/lib/livestats/types";

// =============================================================================
// One play, one record (lib/livestats/merge.ts, through readPlays), Oct 6: a
// read is an applied play when its lines are mostly that play's, or when the
// reader names the play by id; otherwise it is new. An update replaces what
// one player holds, adds what several can, and follows the newest read's play
// type. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB", season: { pass_att: 120 } },
  { playerId: "H12-BRINDLE", side: "home", jersey: "12", first: "Ash", last: "Brindle", position: "QB", season: { pass_att: 10 } },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR" },
  { playerId: "H3-BOOTHBY", side: "home", jersey: "3", first: "Kit", last: "Boothby", position: "K" },
  { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
  { playerId: "A24-ASHGROVE", side: "away", jersey: "24", first: "Penn", last: "Ashgrove", position: "DB" },
];

function ev(playerId: string, action: Action, yards: number | null = null, yardsSource: YardsSource | null = yards === null ? null : "stated"): StatsEvent {
  return { playerId, action, yards, yardsSource, made: null };
}

function play(seqStart: number, seqEnd: number, summary: string, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
    quarter: 2,
    clock: null,
    down: 2,
    distance: 7,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary,
    // Everyone on the play is named, so the check (R18) lets the credits stand.
    evidence: events.map((event) => event.playerId.split("-")[1].toLowerCase()).join(" "),
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    ...extra,
  };
}

/** Reads each batch in turn, the way the loop does, one reply at a time. */
function readAll(batches: StatsPlay[][], utterances: Array<{ seq: number; text: string }> = []) {
  let session: StatsSession = EMPTY_SESSION;
  let last: ReturnType<typeof readPlays> | null = null;
  batches.forEach((batch, i) => {
    last = readPlays(session, batch, ROSTER, (i + 1) * 1000, { utterances });
    session = last.session;
  });
  return { session, last: last! };
}

const eventsOf = (p: StatsPlay) => p.events.map((event) => `${event.playerId} ${event.action} ${event.yards ?? "?"}${event.yardsSource && event.yardsSource !== "stated" ? `~${event.yardsSource}` : ""}`);

describe("which play a read is", () => {
  it("a new play that shares only its first line with the play before stays a separate play", () => {
    const first = play(10, 13, "FENNIMORE run for 4", [ev("H22-FENNIMORE", "rush", 4)]);
    const next = play(13, 16, "FENNIMORE run for 3", [ev("H22-FENNIMORE", "rush", 3)], { down: 3, distance: 3 });
    const { session } = readAll([[first], [next]]);
    expect(session.plays.map((p) => p.playId)).toEqual(["10-13", "13-16"]);
  });

  it("so does one that starts on the next line with the same runner", () => {
    const first = play(10, 11, "FENNIMORE run", [ev("H22-FENNIMORE", "rush", 4)]);
    const next = play(12, 13, "FENNIMORE run again", [ev("H22-FENNIMORE", "rush", 3)]);
    expect(readAll([[first], [next]]).session.plays.map((p) => p.playId)).toEqual(["10-11", "12-13"]);
  });

  it("an item with the same lines as an applied play is that play, even if it carries a different update id", () => {
    const a = play(10, 11, "FENNIMORE run", [ev("H22-FENNIMORE", "rush", 4)]);
    const b = play(14, 15, "PREWITT catch", [ev("H7-CASTELLANE", "pass_complete", 6), ev("H81-PREWITT", "reception", 6)], { playType: "pass" });
    const again = play(10, 11, "FENNIMORE run, DUNMORE tackle", [ev("H22-FENNIMORE", "rush", 4), ev("A17-DUNMORE", "tackle")], { updates: "14-15" });
    const { session } = readAll([[a], [b], [again]]);
    expect(session.plays).toHaveLength(2);
    expect(eventsOf(session.plays[0].play)).toEqual(["H22-FENNIMORE rush 4", "A17-DUNMORE tackle ?"]);
    expect(eventsOf(session.plays[1].play)).toEqual(["H7-CASTELLANE pass_complete 6", "H81-PREWITT reception 6"]);
  });

  it(`mostly the same lines: more than half of the shorter read`, () => {
    expect(sameLines({ seqStart: 10, seqEnd: 13 }, { seqStart: 12, seqEnd: 15 })).toBe(false);
    expect(sameLines({ seqStart: 10, seqEnd: 13 }, { seqStart: 11, seqEnd: 15 })).toBe(true);
    expect(sameLines({ seqStart: 10, seqEnd: 11 }, { seqStart: 11, seqEnd: 11 })).toBe(true);
    expect(sameLines({ seqStart: 10, seqEnd: 11 }, { seqStart: 12, seqEnd: 12 })).toBe(false);
  });

  it(`the reader's id names one of the last ${UPDATE_LOOKBACK} plays, never a discarded one`, () => {
    const a = play(10, 11, "FENNIMORE run", [ev("H22-FENNIMORE", "rush", 4)]);
    const b = play(13, 14, "PREWITT catch", [ev("H7-CASTELLANE", "pass_complete", 6), ev("H81-PREWITT", "reception", 6)], { playType: "pass", down: 3 });
    const recap = play(30, 30, "FENNIMORE just ran for 5", [ev("H22-FENNIMORE", "rush", 5)], { updates: "10-11" });
    const plays = (statuses: Array<"pending" | "discarded">) => [a, b].map((p, i) => ({ playId: `${p.seqStart}-${p.seqEnd}`, play: p, status: statuses[i] }));
    expect(findUpdateTarget(recap, plays(["pending", "pending"]))?.playId).toBe("10-11");
    expect(findUpdateTarget(recap, plays(["discarded", "pending"]))).toBeNull();
    expect(findUpdateTarget({ ...recap, updates: "" }, plays(["pending", "pending"]))).toBeNull();
  });

  it("live call, then a recap by id, is one play with the recap's yardage", () => {
    const live = play(10, 11, "FENNIMORE run", [ev("H22-FENNIMORE", "rush")]);
    const recap = play(20, 20, "FENNIMORE just ran for 41", [ev("H22-FENNIMORE", "rush", 41)], { updates: "10-11" });
    const { session } = readAll([[live], [recap]]);
    expect(session.plays).toHaveLength(1);
    expect(eventsOf(session.plays[0].play)).toEqual(["H22-FENNIMORE rush 41"]);
    expect(session.plays[0].updated).toBe(1);
  });
});

describe("what gets past the watermark", () => {
  it("anything after it, a read naming a recent play, or a read that is mostly an applied play's lines", () => {
    const applied = readPlays(EMPTY_SESSION, [play(10, 13, "FENNIMORE run", [ev("H22-FENNIMORE", "rush", 4)])], ROSTER, 1).session;
    const newer = play(14, 15, "x", []);
    const byId = { ...play(8, 9, "x", []), updates: "10-13" };
    const byLines = play(11, 13, "x", []);
    const old = play(5, 6, "x", []);
    expect(freshReads([newer, byId, byLines, old], applied, 13, new Set(["10-13"])).map((p) => `${p.seqStart}-${p.seqEnd}`)).toEqual(["14-15", "8-9", "11-13"]);
  });
});

describe("what an update does", () => {
  it("a touchdown call, then an update whose lines cover it saying no touchdown: no touchdown, the carry kept", () => {
    const call = play(10, 11, "FENNIMORE run, touchdown", [ev("H22-FENNIMORE", "rush", 6)], { touchdown: true });
    const review = play(10, 14, "FENNIMORE short of the goal line, overturned", [ev("H22-FENNIMORE", "rush", 5)]);
    const { session } = readAll([[call], [review]]);
    expect(session.plays).toHaveLength(1);
    expect(session.plays[0].play.touchdown).toBe(false);
    expect(tallyChanges(session.plays[0].changes).get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 5 });
  });

  it("an update that covers only later lines cannot remove a touchdown", () => {
    const call = play(10, 11, "FENNIMORE run, touchdown", [ev("H22-FENNIMORE", "rush", 6)], { touchdown: true });
    const later = play(12, 14, "FENNIMORE run", [ev("H22-FENNIMORE", "rush", 6)], { updates: "10-11" });
    const { session } = readAll([[call], [later]]);
    expect(session.plays[0].play.touchdown).toBe(true);
    expect(tallyChanges(session.plays[0].changes).get("H22-FENNIMORE")?.stats.rush_td).toBe(1);
  });

  it("an update that names a different receiver replaces the receiver and keeps the yards", () => {
    const first = play(10, 11, "CASTELLANE to ASHGROVE for 15", [ev("H7-CASTELLANE", "pass_complete", 15), ev("H81-PREWITT", "reception", 15)], { playType: "pass" });
    const fixed = play(12, 12, "the catch was by FENNIMORE", [ev("H22-FENNIMORE", "reception")], { playType: "pass", updates: "10-11" });
    const { session } = readAll([[first], [fixed]]);
    expect(eventsOf(session.plays[0].play)).toEqual(["H7-CASTELLANE pass_complete 15", "H22-FENNIMORE reception 15"]);
    const tally = tallyChanges(session.plays[0].changes);
    expect(tally.get("H22-FENNIMORE")?.stats).toEqual({ rec: 1, rec_yds: 15 });
    expect(tally.has("H81-PREWITT")).toBe(false);
  });

  it("a play read as a run and then updated as a sack ends with one carry", () => {
    const run = play(10, 11, "CASTELLANE run, DUNMORE tackle", [ev("H7-CASTELLANE", "rush", -6), ev("A17-DUNMORE", "tackle")]);
    const sack = play(12, 12, "CASTELLANE sacked by DUNMORE for 6", [ev("H7-CASTELLANE", "sacked", 6), ev("A17-DUNMORE", "sack", 6)], { playType: "sack", updates: "10-11" });
    const { session } = readAll([[run], [sack]]);
    expect(session.plays).toHaveLength(1);
    expect(session.plays[0].play.playType).toBe("sack");
    const tally = tallyChanges(session.plays[0].changes);
    expect(tally.get("H7-CASTELLANE")?.stats).toEqual({ rush_att: 1, rush_yds: -6 });
    expect(tally.get("A17-DUNMORE")?.stats).toEqual({ sacks: 1, tkl: 1, sack_yds: 6 });
  });

  it("an update with only a tackler adds the tackler and keeps the runner", () => {
    const run = play(10, 11, "FENNIMORE run for 7", [ev("H22-FENNIMORE", "rush", 7)]);
    const tackler = play(12, 12, "DUNMORE made that stop", [ev("A17-DUNMORE", "tackle")], { updates: "10-11" });
    const { session } = readAll([[run], [tackler]]);
    expect(eventsOf(session.plays[0].play)).toEqual(["H22-FENNIMORE rush 7", "A17-DUNMORE tackle ?"]);
  });

  it("sets a kick's result and marks a play wiped out", () => {
    const kick = play(10, 11, "BOOTHBY field goal", [{ ...ev("H3-BOOTHBY", "field_goal", 32), made: null }], { playType: "field_goal", down: 4, distance: 2 });
    const result = play(12, 12, "BOOTHBY field goal is good", [{ ...ev("H3-BOOTHBY", "field_goal", 32), made: true }], { playType: "field_goal", down: 4, distance: 2, updates: "10-11" });
    const { session } = readAll([[kick], [result]]);
    expect(session.plays).toHaveLength(1);
    expect(session.plays[0].play.events[0].made).toBe(true);
    expect(tallyChanges(session.plays[0].changes).get("H3-BOOTHBY")?.stats).toEqual({ fga: 1, fgm: 1, fg_long: 32 });

    const run = play(20, 21, "FENNIMORE run", [ev("H22-FENNIMORE", "rush", 8)]);
    const flag = play(22, 22, "FENNIMORE run, flag, holding, comes back", [ev("H22-FENNIMORE", "rush", 8)], { nullified: true, updates: "20-21" });
    const wiped = readAll([[run], [flag]]).session.plays[0];
    expect(wiped.play.nullified).toBe(true);
    expect(wiped.changes).toEqual([]);
  });

  it("a catch with a code-filled passer takes the passer a later read names", () => {
    const catchOnly = play(10, 11, "PREWITT catch for 9", [ev("H81-PREWITT", "reception", 9)], { playType: "pass" });
    const withPasser = play(12, 12, "BRINDLE to PREWITT for 9", [ev("H12-BRINDLE", "pass_complete", 9), ev("H81-PREWITT", "reception", 9)], { playType: "pass", updates: "10-11" });
    const merged = readAll([[catchOnly], [withPasser]]).session.plays[0];
    const passer = merged.play.events.find((event) => event.action === "pass_complete")!;
    expect(passer.playerId).toBe("H12-BRINDLE");
    expect(passer.estimated).toBeUndefined();
  });

  it("takes a stated yardage over a worked-out one, never the other way, and changes nothing when read the same way again", () => {
    const worked = { ...ev("H22-FENNIMORE", "rush", 6), yardsSource: "spots" as const };
    const first = play(10, 11, "FENNIMORE run", [worked]);
    const stated = mergeUpdate(first, play(12, 12, "FENNIMORE run for 8", [ev("H22-FENNIMORE", "rush", 8)]));
    expect(stated.changed).toBe(true);
    expect(stated.play.events[0]).toMatchObject({ yards: 8, yardsSource: "stated" });
    const back = mergeUpdate(stated.play, play(13, 13, "FENNIMORE run for 8", [worked]));
    expect(back.play.events[0]).toMatchObject({ yards: 8, yardsSource: "stated" });
    const same = mergeUpdate(stated.play, play(10, 12, "FENNIMORE run for 8", [ev("H22-FENNIMORE", "rush", 8)]));
    expect(same.changed).toBe(false);
  });
});

describe("totals and undo", () => {
  it("an update can never count a play twice", () => {
    const run = play(10, 11, "FENNIMORE run for 4", [ev("H22-FENNIMORE", "rush", 4)]);
    let session: StatsSession = readPlays(EMPTY_SESSION, [run], ROSTER, 1000).session;
    session = okPlay(session, 1001).session;
    for (let i = 0; i < 4; i++) {
      const again = play(12 + i, 12 + i, "FENNIMORE run for 4", [ev("H22-FENNIMORE", "rush", 4 + i)], { updates: "10-11" });
      session = readPlays(session, [again], ROSTER, 2000 + i).session;
      session = okPlay(session, 2001 + i).session;
    }
    expect(session.plays).toHaveLength(1);
    expect(talliesOf(session).get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 7 });
  });

  it("undo removes an updated play once", () => {
    const first = play(10, 11, "FENNIMORE run", [ev("H22-FENNIMORE", "rush")]);
    const rest = play(12, 13, "FENNIMORE 8 yd run", [ev("H22-FENNIMORE", "rush", 8)], { updates: "10-11" });
    const { session } = readAll([[first], [rest]]);
    expect(waiting(session)).toHaveLength(1);
    const ok = okPlay(session, 5000).session;
    expect(counted(ok).map((p) => p.playId)).toEqual(["10-11"]);
    expect(talliesOf(ok).get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 8 });
    const back = undoLast(ok, 6000).session;
    expect(counted(back)).toEqual([]);
    expect(waiting(back).map((p) => p.playId)).toEqual(["10-11"]);
    expect(talliesOf(back).size).toBe(0);
  });

  it("an update to a play already counted keeps it counted and changes its lines", () => {
    const first = play(10, 11, "FENNIMORE run", [ev("H22-FENNIMORE", "rush")]);
    const read = readPlays(EMPTY_SESSION, [first], ROSTER, 1000);
    const ok = okPlay(read.session, 2000).session;
    const rest = play(10, 13, "FENNIMORE 8 yd run", [ev("H22-FENNIMORE", "rush", 8)]);
    const after = readPlays(ok, [rest], ROSTER, 3000);
    expect(after.updated[0].status).toBe("applied");
    expect(talliesOf(after.session).get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 8 });
  });
});
