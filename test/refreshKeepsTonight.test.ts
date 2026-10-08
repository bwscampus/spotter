import { describe, expect, it } from "vitest";
import { lineText } from "@/lib/cards/lines";
import { EMPTY_SESSION, linesOf, okPlay, readPlays, remapSession, talliesOf } from "@/lib/livestats/session";
import type { StatsEvent, StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";

// Refresh rosters shouldn't change tonight's stats (Jed, Oct 5). A refresh is
// where a misspelled surname or a wrong number gets fixed, and a player's id is
// their side, number and surname, so a fix changes it: tonight has to follow
// the player to the new id. Made-up names only.

const player = (playerId: string, side: "home" | "away", jersey: string | null, last: string, season?: StatsRosterPlayer["season"]): StatsRosterPlayer => ({
  playerId, side, jersey, first: "Sam", last, position: "RB", season: season ?? null,
});

const BEFORE = [
  player("H22-FENIMORE", "home", "22", "Fenimore", { rush_att: 71, rush_yds: 455 }),
  player("H7-CASTELANE", "home", "7", "Castelane"),
  player("A17-QUILLON", "away", "17", "Quillon"),
];

const ev = (playerId: string, action: StatsEvent["action"], yards: number | null = null): StatsEvent => ({
  playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null,
});

function run(seq: number, events: StatsEvent[]): StatsPlay {
  return {
    seqStart: seq, seqEnd: seq, quarter: 2, clock: "4:10", down: 3, distance: 4, offense: "home", playType: "run",
    nullified: false, touchdown: false, firstDown: false, confidence: 0.9, summary: `play ${seq}`,
    evidence: `${events.map((e) => e.playerId.split("-")[1].toLowerCase()).join(" ")} up the middle`, events,
  };
}

function counted(roster: StatsRosterPlayer[]) {
  let session = readPlays(EMPTY_SESSION, [run(0, [ev("H22-FENIMORE", "rush", 8), ev("A17-QUILLON", "tackle")])], roster, 1).session;
  session = okPlay(session, 2).session;
  return session;
}

const tonight = (session: ReturnType<typeof counted>, roster: StatsRosterPlayer[], id: string) => lineText(linesOf(session, roster).get(id)?.tonight ?? []);

describe("a refresh that fixes a surname", () => {
  const AFTER = [player("H22-FENNIMORE", "home", "22", "Fennimore", { rush_att: 71, rush_yds: 455 }), BEFORE[1], BEFORE[2]];

  it("starts with tonight on the old id, which is the problem", () => {
    const session = counted(BEFORE);
    expect(tonight(session, BEFORE, "H22-FENIMORE")).toBe("1 car · 8 yds");
    expect(tonight(session, AFTER, "H22-FENNIMORE")).toBe("");
  });

  it("moves tonight to the player's new id, by side and number, and leaves everyone else alone", () => {
    const session = remapSession(counted(BEFORE), AFTER, [BEFORE]);
    expect(tonight(session, AFTER, "H22-FENNIMORE")).toBe("1 car · 8 yds");
    expect(tonight(session, AFTER, "H22-FENIMORE")).toBe("");
    expect(tonight(session, AFTER, "A17-QUILLON")).toBe("1 tkl");
    // The season line includes tonight, on the new id.
    expect(lineText(linesOf(session, AFTER).get("H22-FENNIMORE")!.season)).toContain("463 yds");
  });

  it("moves the plays too, so the strip, an undo and a correction all name the new id", () => {
    const session = remapSession(counted(BEFORE), AFTER, [BEFORE]);
    const [play] = session.plays;
    expect(play.changes.map((c) => c.playerId)).toEqual(["H22-FENNIMORE", "H22-FENNIMORE", "A17-QUILLON"]);
    expect(play.original.map((c) => c.playerId)).toContain("H22-FENNIMORE");
    expect(play.play.events.map((e) => e.playerId)).toEqual(["H22-FENNIMORE", "A17-QUILLON"]);
    expect([...talliesOf(session).keys()].sort()).toEqual(["A17-QUILLON", "H22-FENNIMORE"]);
  });
});

describe("a refresh that fixes a number", () => {
  it("follows the player by side and surname", () => {
    const after = [player("H12-FENIMORE", "home", "12", "Fenimore"), BEFORE[1], BEFORE[2]];
    const session = remapSession(counted(BEFORE), after, [BEFORE]);
    expect(tonight(session, after, "H12-FENIMORE")).toBe("1 car · 8 yds");
  });
});

describe("a refresh that changes nothing, or something that cannot be told", () => {
  it("gives back the very same session when every id is still there", () => {
    const session = counted(BEFORE);
    expect(remapSession(session, [...BEFORE], [BEFORE])).toBe(session);
  });

  it("does not guess when two players could be the one, so nobody gets another player's stats", () => {
    const after = [player("H22-ALPHA", "home", "22", "Alpha"), player("H22-BETA", "home", "22", "Beta"), BEFORE[1], BEFORE[2]];
    const session = counted(BEFORE);
    expect(remapSession(session, after, [BEFORE])).toBe(session);
  });

  it("does not move stats onto a player who already has the id's number but a different name and a stat of their own", () => {
    // The old player was removed and a different one wears 22 now with the same side: that is the number's new owner, and
    // it is the only #22, so the move happens. A second #22 on the roster stops it.
    const after = [player("H22-NEWKID", "home", "22", "Newkid"), BEFORE[1], BEFORE[2]];
    expect(tonight(remapSession(counted(BEFORE), after, [BEFORE]), after, "H22-NEWKID")).toBe("1 car · 8 yds");
  });

  it("leaves a player who left the roster entirely where they were", () => {
    const after = [BEFORE[1], BEFORE[2]];
    const session = counted(BEFORE);
    expect(remapSession(session, after, [BEFORE])).toBe(session);
  });

  it("finds the old player through any roster the game has had, which is how a reload does it", () => {
    const middle = [player("H22-FENIMOR", "home", "22", "Fenimor"), BEFORE[1], BEFORE[2]];
    const now = [player("H22-FENNIMORE", "home", "22", "Fennimore"), BEFORE[1], BEFORE[2]];
    const session = remapSession(counted(BEFORE), now, [BEFORE, middle]);
    expect(tonight(session, now, "H22-FENNIMORE")).toBe("1 car · 8 yds");
  });
});
