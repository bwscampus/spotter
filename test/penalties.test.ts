import { describe, expect, it } from "vitest";
import { tallyChanges } from "@/lib/cards/tonight";
import { wipedOut } from "@/lib/livestats/penalty";
import { EMPTY_SESSION, okPlay, readPlays, type StatsSession } from "@/lib/livestats/session";
import type { Action, Penalty, StatsEvent, StatsPlay, StatsRosterPlayer, YardsSource } from "@/lib/livestats/types";

// Penalties (readPlays): only the reader wipes a play out, on the play itself
// or by updating it by id, a foul before the snap does not make the play it
// is read on a no-play (Oct 6; R27 is gone), and a play the reader marked
// nullified stays wiped out whatever (L6). A run with a hold behind the ball
// stands with its yards unknown (R28). Made-up names only.

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB" },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
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
    distance: 6,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary,
    evidence: events.map((event) => event.playerId.split("-")[1].toLowerCase()).join(" "),
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: { on: "none", noPlay: false, beforeSnap: false },
    ...extra,
  };
}
const flag = (seq: number, penalty: Penalty, extra: Partial<StatsPlay> = {}) =>
  play(seq, seq, "flag on the play", [], { playType: "penalty_only", penalty, ...extra });
const said = (...lines: Array<[number, string, number]>) => lines.map(([seq, text, offsetMs]) => ({ seq, text, offsetMs }));

function readInTurn(plays: StatsPlay[], utterances = said(), ok = true) {
  let session: StatsSession = EMPTY_SESSION;
  const updated: string[] = [];
  plays.forEach((p, i) => {
    const read = readPlays(session, [p], ROSTER, (i + 1) * 1000, { utterances });
    session = read.session;
    updated.push(...read.updated.map((u) => u.playId));
    if (ok) for (const a of read.added) session = okPlay(session, (i + 1) * 1000 + 1, a.playId).session;
  });
  return { session, updated, first: session.plays[0], tally: tallyChanges(session.plays.filter((p) => p.status === "applied").flatMap((p) => p.changes)) };
}

const RUN = play(10, 11, "FENNIMORE run for 8, DUNMORE tackle", [ev("H22-FENNIMORE", "rush", 8), ev("A17-DUNMORE", "tackle")]);

describe("a flag never reaches back on its own", () => {
  it("a false start read after a run leaves the run alone", () => {
    const { first, updated, tally } = readInTurn(
      [RUN, flag(13, { on: "offense", noPlay: true, beforeSnap: true })],
      said([11, "fennimore for 8", 20_000], [13, "flag, false start", 30_000]),
    );
    expect(updated).toEqual([]);
    expect(first.play.nullified).toBe(false);
    expect(tally.get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 8 });
  });

  it("nor does a no-play flag read as its own play", () => {
    expect(readInTurn([RUN, flag(13, { on: "offense", noPlay: true, beforeSnap: false })]).first.play.nullified).toBe(false);
  });

  it("the reader wipes a play out on the play itself, or by updating it by id", () => {
    const own = readInTurn([{ ...RUN, nullified: true, penalty: { on: "offense", noPlay: true, beforeSnap: false } }]);
    expect(own.tally.size).toBe(0);
    const byId = readInTurn([RUN, flag(14, { on: "offense", noPlay: true, beforeSnap: false }, { updates: "10-11", nullified: true })]);
    expect(byId.first.play.nullified).toBe(true);
    expect(byId.first.changes).toEqual([]);
    expect(byId.tally.size).toBe(0);
  });

  it("a foul before the snap does not wipe out the play it is read on: the down it replays is the one never run", () => {
    const replayed = readInTurn([{ ...RUN, penalty: { on: "offense", noPlay: true, beforeSnap: true } }]);
    expect(replayed.tally.get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 1, rush_yds: 8 });
  });

  it("but a play the reader marked wiped out stays wiped out, whatever it says about the snap (L6)", () => {
    const marked = readInTurn([{ ...RUN, nullified: true, penalty: { on: "offense", noPlay: true, beforeSnap: true } }]);
    expect(marked.tally.size).toBe(0);
    const noReplay = readInTurn([{ ...RUN, nullified: true, penalty: { on: "offense", noPlay: false, beforeSnap: true } }]);
    expect(noReplay.tally.size).toBe(0);
    expect(wipedOut({ nullified: true, penalty: { on: "offense", noPlay: true, beforeSnap: true } })).toBe(true);
    expect(wipedOut({ nullified: false, penalty: { on: "offense", noPlay: true, beforeSnap: true } })).toBe(false);
    expect(wipedOut({ nullified: false, penalty: { on: "defense", noPlay: true, beforeSnap: false } })).toBe(true);
  });
});

describe("a run with a hold behind the ball (R28)", () => {
  it("still counts, with its yards unknown, and is not back-filled", () => {
    const held = play(10, 11, "FENNIMORE run for 12, flag, holding on the offense", [ev("H22-FENNIMORE", "rush", 12)], {
      penalty: { on: "offense", noPlay: false, beforeSnap: false },
    });
    const next = play(13, 14, "FENNIMORE run for 3", [ev("H22-FENNIMORE", "rush", 3)], { down: 2, distance: 4 });
    const { first, tally } = readInTurn([held, next]);
    expect(first.play.nullified).toBe(false);
    expect(first.play.events[0]).toMatchObject({ yards: null, yardsSource: null });
    expect(first.dropped).toEqual([{ playerId: "H22-FENNIMORE", action: "rush", rule: "R28", reason: "yards unknown: a flag on the offense during the play", kind: "changed" }]);
    expect(first.updated).toBe(0);
    expect(tally.get("H22-FENNIMORE")?.stats).toEqual({ rush_att: 2, rush_yds: 3 });
  });
});
