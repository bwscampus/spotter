import { describe, expect, it } from "vitest";
import { tallyChanges } from "@/lib/cards/tonight";
import { kickerFor, scoreDecisions, touchdownChecks } from "@/lib/livestats/scoreboard";
import { EMPTY_SESSION, okPlay, readPlays, type StatsSession } from "@/lib/livestats/session";
import type { Action, Score, StatsEvent, StatsPlay, StatsRosterPlayer, YardsSource } from "@/lib/livestats/types";

// =============================================================================
// Keeping the score (lib/livestats/scoreboard.ts through readPlays): a
// touchdown is confirmed by the next stated score and never taken away by it
// (Oct 6, R24 is gone), an extra point nobody called or nobody gave a result
// for is made on a rise of 7, a field goal's result comes from the score.
// Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB", season: { pass_att: 120 } },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR" },
  { playerId: "H3-BOOTHBY", side: "home", jersey: "3", first: "Kit", last: "Boothby", position: "K" },
  { playerId: "A5-QUILLON", side: "away", jersey: "5", first: "Marek", last: "Quillon", position: "QB" },
  { playerId: "A31-RENNICK", side: "away", jersey: "31", first: "Tad", last: "Rennick", position: "RB" },
  { playerId: "A17-DUNMORE", side: "away", jersey: "17", first: "Lio", last: "Dunmore", position: "LB" },
  { playerId: "A9-VASKO", side: "away", jersey: "9", first: "Olen", last: "Vasko", position: "P" },
];

function ev(playerId: string, action: Action, yards: number | null = null, yardsSource: YardsSource | null = yards === null ? null : "stated", made: boolean | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource, made };
}
let seq = 0;
function play(summary: string, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  seq += 3;
  return {
    seqStart: seq,
    seqEnd: seq + 1,
    quarter: 2,
    clock: null,
    down: 1,
    distance: 10,
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
const scoreSaid = (home: number, away: number): Score => ({ home, away });
const run = (yards: number, extra: Partial<StatsPlay> = {}) => play(`FENNIMORE run for ${yards}`, [ev("H22-FENNIMORE", "rush", yards)], extra);
const td = (extra: Partial<StatsPlay> = {}) => play("FENNIMORE run, touchdown", [ev("H22-FENNIMORE", "rush", 8)], { touchdown: true, ...extra });

/** Reads each play in its own batch, OK'd as it comes, the way testrun counts. */
function game(...plays: StatsPlay[]) {
  let session: StatsSession = EMPTY_SESSION;
  const added: string[] = [];
  plays.forEach((p, i) => {
    const read = readPlays(session, [p], ROSTER, (i + 1) * 1000);
    session = read.session;
    for (const a of read.added) {
      added.push(a.playId);
      session = okPlay(session, (i + 1) * 1000 + 1, a.playId).session;
    }
  });
  const byId = (playId: string) => session.plays.find((p) => p.playId === playId)!;
  return { session, added, byId, tally: (playerId: string) => tallyChanges(session.plays.filter((p) => p.status === "applied").flatMap((p) => p.changes)).get(playerId) };
}

describe("a touchdown waits on the score", () => {
  it("is applied as read, and confirmed when that side's score goes up 6, 7 or 8", () => {
    const first = td();
    const g = game(run(4, { score: scoreSaid(7, 7) }), first, run(2, { score: scoreSaid(13, 7) }));
    expect(g.tally("H22-FENNIMORE")?.stats.rush_td).toBe(1);
    expect(touchdownChecks(g.session.plays, ROSTER).get(`${first.seqStart}-${first.seqEnd}`)).toBe("confirmed");
    expect(g.byId(`${first.seqStart}-${first.seqEnd}`).play.touchdown).toBe(true);
  });

  it("is never removed, even when the next stated score shows no change", () => {
    const first = td();
    const g = game(run(4, { score: scoreSaid(7, 7) }), first, run(2, { score: scoreSaid(7, 7) }));
    const kept = g.byId(`${first.seqStart}-${first.seqEnd}`);
    expect(kept.play.touchdown).toBe(true);
    expect(kept.updated).toBe(0);
    expect(g.tally("H22-FENNIMORE")?.stats).toEqual({ rush_att: 3, rush_yds: 14, rush_td: 1 });
    expect(touchdownChecks(g.session.plays, ROSTER).get(`${first.seqStart}-${first.seqEnd}`)).toBe("unconfirmed");
  });

  it("stays unconfirmed, and is never removed, when no score was stated before it", () => {
    const first = td();
    const g = game(first, run(2, { score: scoreSaid(0, 0) }));
    expect(g.byId(`${first.seqStart}-${first.seqEnd}`).play.touchdown).toBe(true);
    expect(touchdownChecks(g.session.plays, ROSTER).get(`${first.seqStart}-${first.seqEnd}`)).toBe("unconfirmed");
  });

  it("counts the other side's touchdown against the other side's score", () => {
    const theirs = play("RENNICK run, touchdown", [ev("A31-RENNICK", "rush", 3)], { offense: "away", touchdown: true });
    const g = game(run(4, { score: scoreSaid(7, 7) }), theirs, run(2, { score: scoreSaid(7, 14) }));
    expect(touchdownChecks(g.session.plays, ROSTER).get(`${theirs.seqStart}-${theirs.seqEnd}`)).toBe("confirmed");
    const other = game(run(4, { score: scoreSaid(7, 7) }), theirs, run(2, { score: scoreSaid(14, 7) }));
    expect(touchdownChecks(other.session.plays, ROSTER).get(`${theirs.seqStart}-${theirs.seqEnd}`)).toBe("unconfirmed");
    expect(other.byId(`${theirs.seqStart}-${theirs.seqEnd}`).play.touchdown).toBe(true);
  });

  it("with two touchdowns and a rise of 12 confirms both; with a rise of 6 confirms the first and keeps the second", () => {
    const a = td();
    const b = td();
    const both = game(run(4, { score: scoreSaid(0, 0) }), a, b, run(2, { score: scoreSaid(12, 0) }));
    expect(touchdownChecks(both.session.plays, ROSTER).get(`${b.seqStart}-${b.seqEnd}`)).toBe("confirmed");
    const one = game(run(4, { score: scoreSaid(0, 0) }), a, b, run(2, { score: scoreSaid(6, 0) }));
    expect(one.byId(`${a.seqStart}-${a.seqEnd}`).play.touchdown).toBe(true);
    expect(one.byId(`${b.seqStart}-${b.seqEnd}`).play.touchdown).toBe(true);
  });
});

describe("the extra point nobody called", () => {
  it("is credited to that side's kicker when the score went up 7 and no extra point was read (R25)", () => {
    const first = td();
    const g = game(run(4, { score: scoreSaid(7, 7) }), first, run(2, { score: scoreSaid(14, 7) }));
    const id = `xp-${first.seqStart}-${first.seqEnd}`;
    expect(g.added).toContain(id);
    const xp = g.byId(id);
    expect(xp.play.playType).toBe("extra_point");
    expect(xp.status).toBe("applied");
    expect(xp.changes).toEqual([
      { playerId: "H3-BOOTHBY", key: "xpm", amount: 1, estimated: true },
      { playerId: "H3-BOOTHBY", key: "xpa", amount: 1, estimated: true },
    ]);
    expect(xp.dropped[0]).toMatchObject({ rule: "R25", kind: "filled", to: "H3-BOOTHBY" });
    expect(g.tally("H3-BOOTHBY")?.stats).toEqual({ xpm: 1, xpa: 1 });
    // Only once, however many score mentions follow.
    const again = readPlays(g.session, [run(1, { score: scoreSaid(14, 7) })], ROSTER, 9000);
    expect(again.added.map((p) => p.playId)).not.toContain(id);
  });

  it("is not credited on a rise of 8 or 6, or when an extra point was read", () => {
    const first = td();
    expect(game(run(4, { score: scoreSaid(7, 7) }), first, run(2, { score: scoreSaid(15, 7) })).added.some((id) => id.startsWith("xp-"))).toBe(false);
    expect(game(run(4, { score: scoreSaid(7, 7) }), first, run(2, { score: scoreSaid(13, 7) })).added.some((id) => id.startsWith("xp-"))).toBe(false);
    const kicked = play("BOOTHBY extra point good", [ev("H3-BOOTHBY", "extra_point", null, null, true)], { playType: "extra_point", down: null, distance: null });
    const g = game(run(4, { score: scoreSaid(7, 7) }), first, kicked, run(2, { score: scoreSaid(14, 7) }));
    expect(g.added.some((id) => id.startsWith("xp-"))).toBe(false);
    expect(g.tally("H3-BOOTHBY")?.stats).toEqual({ xpm: 1, xpa: 1 });
  });

  it("an extra point read with no result is made when the score goes up 7 (R25)", () => {
    const first = td();
    const open = play("BOOTHBY on for the extra point", [ev("H3-BOOTHBY", "extra_point")], { playType: "extra_point", down: null, distance: null });
    const g = game(run(4, { score: scoreSaid(7, 7) }), first, open, run(2, { score: scoreSaid(14, 7) }));
    const xp = g.byId(`${open.seqStart}-${open.seqEnd}`);
    expect(xp.play.events[0].made).toBe(true);
    expect(xp.dropped.map((drop) => `${drop.rule} ${drop.kind}`)).toContain("R25 changed");
    expect(g.added.some((id) => id.startsWith("xp-"))).toBe(false);
    expect(g.tally("H3-BOOTHBY")?.stats).toEqual({ xpa: 1, xpm: 1 });
    // Up 6: the try stays an attempt with no result.
    const missed = game(run(4, { score: scoreSaid(7, 7) }), first, open, run(2, { score: scoreSaid(13, 7) }));
    expect(missed.tally("H3-BOOTHBY")?.stats).toEqual({ xpa: 1 });
  });

  it("goes to the kicker already credited with a kick, else the only kicker, else the only punter, else nobody", () => {
    const sideOf = new Map(ROSTER.map((player) => [player.playerId, player.side]));
    expect(kickerFor("home", [], ROSTER, sideOf)).toBe("H3-BOOTHBY");
    expect(kickerFor("away", [], ROSTER, sideOf)).toBe("A9-VASKO");
    const twoKickers = [...ROSTER, { ...ROSTER[3], playerId: "H4-OTHER", jersey: "4", last: "Other" }];
    expect(kickerFor("home", [], twoKickers, new Map(twoKickers.map((player) => [player.playerId, player.side])))).toBeNull();
    const kicked = { playId: "k", status: "applied", changes: [], play: play("OTHER field goal", [ev("H4-OTHER", "field_goal", 30, "stated", true)], { playType: "field_goal" }) };
    expect(kickerFor("home", [kicked], twoKickers, new Map(twoKickers.map((player) => [player.playerId, player.side])))).toBe("H4-OTHER");
    const nobody = ROSTER.filter((player) => player.position !== "K" && player.position !== "P");
    expect(kickerFor("home", [], nobody, sideOf)).toBeNull();
  });
});

describe("a field goal try with no result heard", () => {
  const kick = () => play("BOOTHBY field goal from 32", [ev("H3-BOOTHBY", "field_goal", 32)], { playType: "field_goal", down: 4, distance: 3 });

  it("is good when that side goes up 3 (R26)", () => {
    const first = kick();
    const g = game(run(4, { score: scoreSaid(7, 7) }), first, run(2, { score: scoreSaid(10, 7) }));
    const settled = g.byId(`${first.seqStart}-${first.seqEnd}`);
    expect(settled.play.events[0].made).toBe(true);
    expect(settled.dropped.map((drop) => `${drop.rule} ${drop.kind}`)).toEqual(["R26 changed"]);
    expect(g.tally("H3-BOOTHBY")?.stats).toEqual({ fga: 1, fgm: 1, fg_long: 32 });
    expect(g.tally("H3-BOOTHBY")?.estimated.sort()).toEqual(["fg_long", "fga", "fgm"]);
  });

  it("missed when the next stated score shows no change", () => {
    const first = kick();
    const g = game(run(4, { score: scoreSaid(7, 7) }), first, run(2, { score: scoreSaid(7, 7) }));
    expect(g.byId(`${first.seqStart}-${first.seqEnd}`).play.events[0].made).toBe(false);
    expect(g.tally("H3-BOOTHBY")?.stats).toEqual({ fga: 1 });
  });

  it("waits when no score was known before it", () => {
    const first = kick();
    const g = game(first, run(2, { score: scoreSaid(10, 7) }));
    expect(g.byId(`${first.seqStart}-${first.seqEnd}`).play.events[0].made).toBeNull();
  });
});

describe("the decisions themselves", () => {
  it("are nothing without a stated score, and ignore a score that went down", () => {
    const entry = (p: StatsPlay, changes = tallyChanges([]).size === 0 ? [] : []) => ({ playId: `${p.seqStart}-${p.seqEnd}`, play: p, status: "applied", changes });
    const tdPlay = td();
    expect(scoreDecisions([entry(run(4)), entry(tdPlay)], ROSTER)).toEqual([]);
    const base = entry(run(4, { score: scoreSaid(7, 7) }));
    const scored = { ...entry(tdPlay), changes: [{ playerId: "H22-FENNIMORE", key: "rush_td" as const, amount: 1, estimated: false }] };
    expect(scoreDecisions([base, scored, entry(run(1, { score: scoreSaid(0, 7) }))], ROSTER)).toEqual([]);
    expect(scoreDecisions([base, scored, entry(run(1, { score: scoreSaid(13, 7) }))], ROSTER)).toEqual([{ kind: "confirm", playId: scored.playId }]);
  });
});
