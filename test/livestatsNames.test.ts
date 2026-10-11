import { describe, expect, it } from "vitest";
import { closeLimit, closeSpelling, editDistance, nameIndex, namedIn, squeeze, wordList } from "@/lib/livestats/names";
import { correctPlay, EMPTY_SESSION, LATE_NAME_LINES, okPlay, readPlays, talliesOf, undoLast, type StatsSession } from "@/lib/livestats/session";
import type { Action, StatsEvent, StatsPlay, StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// The name check (Oct 10): a close spelling of the surname names the player,
// a name said a few lines after the play counts, and a credit the check took
// away only because the name had not been said yet comes back when it is.
// Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-ALDERWICK", side: "home", jersey: "7", first: "Tam", last: "Alderwick", position: "QB", season: { pass_att: 140 } },
  { playerId: "H12-QUINTERO", side: "home", jersey: "12", first: "Rafe", last: "Quintero", position: "QB", season: { pass_att: 6 } },
  { playerId: "H81-HARLOW", side: "home", jersey: "81", first: "Joss", last: "Harlow", position: "WR" },
  { playerId: "H22-WEXCOMBE", side: "home", jersey: "22", first: "Bram", last: "Wexcombe", position: "RB" },
  { playerId: "H30-VENRO", side: "home", jersey: "30", first: "Ike", last: "Venro", position: "RB" },
  { playerId: "H40-HOLLINGWADE", side: "home", jersey: "40", first: "Ned", last: "Hollingwade", position: "TE" },
  { playerId: "A5-MARDEN", side: "away", jersey: "5", first: "Cy", last: "Marden", position: "LB" },
  { playerId: "A6-MORDEN", side: "away", jersey: "6", first: "Eli", last: "Morden", position: "LB" },
  { playerId: "A9-PAK", side: "away", jersey: "9", first: "Lou", last: "Pak", position: "DB" },
];
const INDEX = nameIndex(ROSTER);
const who = (playerId: string) => ROSTER.find((player) => player.playerId === playerId)!;
const named = (playerId: string, text: string) => namedIn(who(playerId), text, INDEX);

describe("close spellings", () => {
  it("counts edits, a swap of neighbours as one", () => {
    expect(editDistance("harlow", "harlew", 1)).toBe(1);
    expect(editDistance("harlow", "hralow", 1)).toBe(1);
    expect(editDistance("harlow", "harlo", 1)).toBe(1);
    expect(editDistance("harlow", "barlew", 1)).toBe(2); // past the limit: limit + 1
    expect(squeeze("hollingwade")).toBe("holingwade");
  });

  it("allows nothing at 3 letters, one at 4 to 6, two at 7 or more", () => {
    expect([3, 4, 6, 7, 12].map(closeLimit)).toEqual([0, 1, 1, 2, 2]);
  });

  it("passes a 6-letter surname with one letter changed, or two neighbours swapped", () => {
    expect(named("H81-HARLOW", "complete to harlew at the 30")).toBe(true);
    expect(named("H81-HARLOW", "complete to hralow at the 30")).toBe(true);
    expect(named("H81-HARLOW", "complete to barlew at the 30")).toBe(false);
  });

  it("passes two letters changed in an 8-letter surname, not in a 5-letter one", () => {
    expect(named("H22-WEXCOMBE", "wexkomba up the middle")).toBe(true);
    expect(named("H30-VENRO", "vanra up the middle")).toBe(false);
    expect(named("H30-VENRO", "vanro up the middle")).toBe(true);
  });

  it("passes a doubled letter written single", () => {
    expect(named("H40-HOLLINGWADE", "holingwade hauls it in")).toBe(true);
  });

  it("never passes a word that is exactly another player's surname", () => {
    expect(named("A6-MORDEN", "stopped by morden")).toBe(true);
    expect(named("A5-MARDEN", "stopped by morden")).toBe(false);
    expect(closeSpelling(who("A5-MARDEN"), "morden", INDEX)).toBe(false);
  });

  it("needs a 3-letter surname exactly", () => {
    expect(named("A9-PAK", "broken up by pak")).toBe(true);
    expect(named("A9-PAK", "broken up by pek")).toBe(false);
  });

  it("reads a possessive as the surname", () => {
    expect(wordList("that's harlow's third catch")).toContain("harlow");
    expect(named("H81-HARLOW", "that's harlow's third catch")).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// A few lines late, and checked again as they arrive.
// -----------------------------------------------------------------------------

function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}
function pass(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
    quarter: 3,
    clock: null,
    down: 1,
    distance: 10,
    offense: "home",
    playType: "pass",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: "pass complete",
    evidence: "",
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    ...extra,
  };
}
const lines = (...said: Array<[number, string]>) => said.map(([seq, text]) => ({ seq, text }));
/** The backup's completion: the lines of the play name the catcher, never the passer. */
const BACKUP_PASS = pass(10, 11, [ev("H12-QUINTERO", "pass_complete", 9), ev("H81-HARLOW", "reception", 9)]);
const PLAY_LINES: Array<[number, string]> = [
  [10, "out of the shotgun, the throw"],
  [11, "caught by harlow for 9"],
];
const passer = (session: StatsSession) => session.plays[0].play.events.find((event) => event.action === "pass_complete");

describe("a name said a few lines after the play", () => {
  it("keeps a passer named 2 lines after the play's last line, with no fill", () => {
    const { added } = readPlays(EMPTY_SESSION, [BACKUP_PASS], ROSTER, 1000, {
      utterances: lines(...PLAY_LINES, [12, "what a grab"], [13, "quintero reading the field beautifully"]),
      readThrough: 13,
    });
    expect(added[0].play.events.find((event) => event.action === "pass_complete")).toMatchObject({ playerId: "H12-QUINTERO" });
    expect(added[0].dropped.map((note) => note.rule)).not.toContain("R14");
  });

  it("does not count a name 6 lines late", () => {
    expect(LATE_NAME_LINES).toBe(5);
    const { added } = readPlays(EMPTY_SESSION, [BACKUP_PASS], ROSTER, 1000, {
      utterances: lines(...PLAY_LINES, [12, "a"], [13, "b"], [14, "c"], [15, "d"], [16, "e"], [17, "quintero reading the field"]),
      readThrough: 17,
    });
    expect(added[0].play.events.find((event) => event.action === "pass_complete")).toMatchObject({ playerId: "H7-ALDERWICK", estimated: true });
    expect(added[0].dropped).toContainEqual(expect.objectContaining({ rule: "R14", kind: "filled", to: "H7-ALDERWICK" }));
  });

  it("does not count a name said once the next play has started", () => {
    const next = pass(13, 14, [ev("H22-WEXCOMBE", "rush", 3)], { playType: "run", down: 2, distance: 1, summary: "WEXCOMBE run" });
    const { session } = readPlays(EMPTY_SESSION, [BACKUP_PASS, next], ROSTER, 1000, {
      utterances: lines(...PLAY_LINES, [12, "second and one"], [13, "wexcombe on the carry"], [14, "quintero stays in at quarterback"]),
      readThrough: 14,
    });
    expect(passer(session)).toMatchObject({ playerId: "H7-ALDERWICK", estimated: true });
  });

  it("gives the pass back to the named backup when the late line arrives, and undo stays exact", () => {
    // Read before its next lines exist: the passer is filled to the starter.
    let session = readPlays(EMPTY_SESSION, [BACKUP_PASS], ROSTER, 1000, { utterances: lines(...PLAY_LINES), readThrough: 11 }).session;
    session = okPlay(session, 1001).session;
    expect(talliesOf(session).get("H7-ALDERWICK")?.stats).toMatchObject({ pass_cmp: 1, pass_att: 1, pass_yds: 9 });
    expect(talliesOf(session).has("H12-QUINTERO")).toBe(false);

    // The next reply: the line naming him is in, and nothing new was read.
    const later = readPlays(session, [], ROSTER, 2000, {
      utterances: lines(...PLAY_LINES, [12, "nice throw"], [13, "quintero reading the field beautifully"]),
      readThrough: 13,
    });
    expect(later.updated.map((play) => play.playId)).toEqual(["10-11"]);
    session = later.session;
    expect(passer(session)).toMatchObject({ playerId: "H12-QUINTERO" });
    expect(passer(session)?.estimated).toBeUndefined();
    expect(session.plays[0].status).toBe("applied");
    expect(session.plays[0].dropped).toContainEqual(
      expect.objectContaining({ rule: "R14", kind: "restored", playerId: "H12-QUINTERO", reason: "named 2 lines after the play: the reader's credit stands" }),
    );
    expect(talliesOf(session).get("H12-QUINTERO")?.stats).toEqual({ pass_cmp: 1, pass_att: 1, pass_yds: 9 });
    expect(talliesOf(session).has("H7-ALDERWICK")).toBe(false);

    // Undo and OK again: exact both ways.
    session = undoLast(session, 3000).session;
    expect(talliesOf(session).size).toBe(0);
    session = okPlay(session, 3001).session;
    expect(talliesOf(session).get("H12-QUINTERO")?.stats).toEqual({ pass_cmp: 1, pass_att: 1, pass_yds: 9 });
    expect(talliesOf(session).get("H81-HARLOW")?.stats).toEqual({ rec: 1, rec_yds: 9 });

    // Once its lines are all in, nothing more happens.
    const again = readPlays(session, [], ROSTER, 4000, { utterances: lines(...PLAY_LINES, [12, "x"], [13, "quintero"], [20, "y"]), readThrough: 20 });
    expect(again.updated).toEqual([]);
  });

  it("brings back a tackle dropped for a name not yet said", () => {
    const run = pass(10, 11, [ev("H22-WEXCOMBE", "rush", 4), ev("A5-MARDEN", "tackle")], { playType: "run", summary: "WEXCOMBE 4 yd run" });
    let session = readPlays(EMPTY_SESSION, [run], ROSTER, 1000, { utterances: lines([10, "wexcombe up the gut"], [11, "for 4"]), readThrough: 11 }).session;
    expect(session.plays[0].dropped).toContainEqual(expect.objectContaining({ rule: "R18", kind: "dropped", playerId: "A5-MARDEN" }));
    session = readPlays(session, [], ROSTER, 2000, { utterances: lines([10, "wexcombe up the gut"], [11, "for 4"], [12, "marden with the stop"]), readThrough: 12 }).session;
    expect(session.plays[0].changes).toContainEqual(expect.objectContaining({ playerId: "A5-MARDEN", key: "tkl", amount: 1 }));
    expect(session.plays[0].dropped).toContainEqual(expect.objectContaining({ rule: "R18", kind: "restored", playerId: "A5-MARDEN" }));
  });

  it("leaves a play the announcer corrected alone", () => {
    let session = readPlays(EMPTY_SESSION, [BACKUP_PASS], ROSTER, 1000, { utterances: lines(...PLAY_LINES), readThrough: 11 }).session;
    const yards = session.plays[0].changes.findIndex((change) => change.key === "pass_yds");
    session = correctPlay(session, "10-11", { type: "amount", index: yards, amount: 11 }).session;
    const later = readPlays(session, [], ROSTER, 2000, { utterances: lines(...PLAY_LINES, [12, "nice"], [13, "quintero reading the field"]), readThrough: 13 });
    expect(later.updated).toEqual([]);
    expect(passer(later.session)).toMatchObject({ playerId: "H7-ALDERWICK", estimated: true });
  });
});
