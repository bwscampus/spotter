import { describe, expect, it } from "vitest";
import { checkPlay, confirmedQbs } from "@/lib/livestats/check";
import { EMPTY_SESSION, okPlay, readPlays, talliesOf } from "@/lib/livestats/session";
import { NO_PENALTY, type Action, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";

// =============================================================================
// The quarterback the reader names beats an unconfirmed default (fix 6, Part
// 4c). With no season stats the roster's default starter is just the first
// quarterback listed; until one is named on a play that counts, the reader's
// passer stands, and when the first named one arrives the passes filled with
// the default go to him. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H12-BRINDLE", side: "home", jersey: "12", first: "Ash", last: "Brindle", position: "QB" },
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Dax", last: "Prewitt", position: "WR" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "QB" },
];
function ev(playerId: string, action: Action, yards: number | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made: null };
}
function pass(seqStart: number, passer: string, yards: number, extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd: seqStart,
    quarter: 1,
    clock: null,
    down: 1,
    distance: 10,
    offense: "home",
    playType: "pass",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: "a pass",
    evidence: "prewitt",
    events: [ev(passer, "pass_complete", yards), ev("H81-PREWITT", "reception", yards)],
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: NO_PENALTY,
    ...extra,
  };
}

describe("an unconfirmed default", () => {
  it("the reader's quarterback keeps the pass before any quarterback on the side is confirmed, not after", () => {
    const unnamed = checkPlay(pass(1, "H7-CASTELLANE", 9), ROSTER, { qbs: { home: "H12-BRINDLE", away: "A17-QUILLON" }, confirmed: { home: false, away: false }, lines: "complete to prewitt for 9" });
    expect(unnamed.play.events[0]).toMatchObject({ playerId: "H7-CASTELLANE" });
    expect(unnamed.notes).toEqual([expect.objectContaining({ rule: "R14", kind: "noted" })]);
    const confirmed = checkPlay(pass(1, "H7-CASTELLANE", 9), ROSTER, { qbs: { home: "H12-BRINDLE", away: "A17-QUILLON" }, confirmed: { home: true, away: false }, lines: "complete to prewitt for 9" });
    expect(confirmed.play.events[0]).toMatchObject({ playerId: "H12-BRINDLE", estimated: true });
    expect(confirmed.notes).toEqual([expect.objectContaining({ rule: "R14", kind: "filled", to: "H12-BRINDLE" })]);
    // A receiver the reader called the passer is not a quarterback: filled as before.
    const receiver = checkPlay(pass(1, "H81-PREWITT", 9), ROSTER, { qbs: { home: "H12-BRINDLE", away: "A17-QUILLON" }, confirmed: { home: false, away: false }, lines: "complete to prewitt for 9" });
    expect(receiver.play.events.find((event) => event.action === "pass_complete")).toMatchObject({ playerId: "H12-BRINDLE", estimated: true });
    expect(confirmedQbs(ROSTER, [])).toEqual({ home: false, away: false });
    expect(confirmedQbs(ROSTER, [pass(1, "H7-CASTELLANE", 9)])).toEqual({ home: true, away: false });
  });

  it("the first quarterback named takes the earlier passes filled with the default, each noted R14", () => {
    // Two completions nobody named the passer of: filled with the default (Brindle, listed first); then one that names Castellane.
    let session = EMPTY_SESSION;
    const utterances = [{ seq: 1, text: "complete to prewitt for 9" }, { seq: 3, text: "prewitt again for 6" }, { seq: 5, text: "castellane to prewitt for 12" }];
    for (const play of [pass(1, "", 9), pass(3, "", 6)]) {
      const read = readPlays(session, [play], ROSTER, 1000, { utterances });
      session = read.session;
      for (const added of read.added) session = okPlay(session, 1001, added.playId).session;
    }
    expect(talliesOf(session).get("H12-BRINDLE")?.stats).toMatchObject({ pass_cmp: 2, pass_yds: 15 });
    const read = readPlays(session, [pass(5, "H7-CASTELLANE", 12)], ROSTER, 2000, { utterances });
    session = read.session;
    for (const added of read.added) session = okPlay(session, 2001, added.playId).session;
    expect(read.updated.map((play) => play.playId).sort()).toEqual(["1-1", "3-3"]);
    expect(read.updated[0].dropped).toContainEqual(expect.objectContaining({ rule: "R14", kind: "changed", to: "H7-CASTELLANE" }));
    expect(talliesOf(session).has("H12-BRINDLE")).toBe(false);
    expect(talliesOf(session).get("H7-CASTELLANE")?.stats).toMatchObject({ pass_cmp: 3, pass_yds: 27 });
    // The moved passes are still estimates; the named one is not.
    expect(session.plays[0].changes.find((change) => change.key === "pass_yds")?.estimated).toBe(true);
    expect(session.plays[2].changes.find((change) => change.key === "pass_yds")?.estimated).toBe(false);
    // A later unnamed pass is filled with him, the confirmed one.
    const later = readPlays(session, [pass(7, "", 4)], ROSTER, 3000, { utterances: [...utterances, { seq: 7, text: "prewitt for 4" }] });
    expect(later.added[0].play.events[0]).toMatchObject({ playerId: "H7-CASTELLANE", estimated: true });
  });
});
