import { describe, expect, it } from "vitest";
import { readerGameState, renderGameState } from "@/lib/livestats/gameStateBlock";
import { volatileContent } from "@/lib/livestats/extract";
import { statsChatRequest } from "@/lib/livestats/openrouter";
import { STATS_SYSTEM_PROMPT } from "@/lib/livestats/prompt";
import { readGameState, readRequest } from "@/lib/livestats/request";
import { readReplayLog } from "@/lib/livestats/replayLog";
import { EMPTY_SESSION, okPlay, readPlays, type SessionPlay } from "@/lib/livestats/session";
import { NO_PENALTY, type Action, type ExtractStatsRequest, type ReaderGameState, type StatsEvent, type StatsPlay, type StatsRosterPlayer, type TeamWords } from "@/lib/livestats/types";

// =============================================================================
// The game state block (lib/livestats/gameStateBlock.ts, Part 2): built from
// the plays already counted, rendered in the volatile part of the call, never
// the cached prefix. Made-up names only.
// =============================================================================

const ROSTER: StatsRosterPlayer[] = [
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Ivo", last: "Castellane", position: "QB", season: { pass_att: 90 } },
  { playerId: "H14-ORMSBY", side: "home", jersey: "14", first: "Gil", last: "Ormsby", position: "QB", season: { pass_att: 3 } },
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H3-BOOTHBY", side: "home", jersey: "3", first: "Lane", last: "Boothby", position: "K" },
  { playerId: "H5-DRAKE", side: "home", jersey: "5", first: "Wes", last: "Drake", position: "P" },
  { playerId: "A12-VANTREE", side: "away", jersey: "12", first: "Cole", last: "Vantree", position: "QB" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
];

const TEAMS: TeamWords = { home: { name: "Northfield", phrases: ["northfield", "bears"] }, away: { name: "Southpoint", phrases: ["southpoint", "hawks"] } };

function ev(playerId: string, action: Action, yards: number | null = null, made: boolean | null = null): StatsEvent {
  return { playerId, action, yards, yardsSource: yards === null ? null : "stated", made };
}

function play(seqStart: number, seqEnd: number, events: StatsEvent[], extra: Partial<StatsPlay> = {}): StatsPlay {
  return {
    seqStart,
    seqEnd,
    quarter: null,
    clock: null,
    down: null,
    distance: null,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: "a play",
    evidence: events.map((e) => e.playerId.split("-")[1].toLowerCase()).join(" "),
    events,
    updates: "",
    startSpot: null,
    endSpot: null,
    shortBy: null,
    score: null,
    penalty: NO_PENALTY,
    ...extra,
  };
}

/** Plays read in and counted, as the loop leaves them. */
function countedPlays(plays: StatsPlay[]): SessionPlay[] {
  let session = readPlays(EMPTY_SESSION, plays, ROSTER, 0).session;
  for (const each of session.plays) session = okPlay(session, 1, each.playId).session;
  return session.plays;
}

describe("readerGameState", () => {
  it("knows nothing but the teams and the starting quarterbacks before the first play", () => {
    const state = readerGameState([], ROSTER, { teams: TEAMS });
    expect(state).toEqual({ teams: { home: "Northfield", away: "Southpoint" }, qbs: { home: "H7-CASTELLANE", away: "A12-VANTREE" } });
    expect(readerGameState([], ROSTER)).toEqual({ qbs: { home: "H7-CASTELLANE", away: "A12-VANTREE" } });
  });

  it("carries the quarter, the score, the ball, the quarterback and the kickers the plays settle", () => {
    const plays = countedPlays([
      // A field goal by Boothby, and a punt by Drake, with the score and quarter said.
      play(1, 2, [ev("H3-BOOTHBY", "field_goal", 32, true)], { playType: "field_goal", quarter: 1, score: { home: 3, away: 0 } }),
      play(5, 6, [ev("H5-DRAKE", "punt", 40)], { playType: "punt", quarter: 2 }),
      // The backup throws: he is now the quarterback on the field.
      play(10, 11, [ev("H14-ORMSBY", "pass_complete", 12), ev("H22-FENNIMORE", "reception", 12)], {
        playType: "pass",
        down: 1,
        distance: 10,
        startSpot: { yardLine: 30, territory: "home" },
        firstDown: true,
      }),
    ]);
    const state = readerGameState(plays, ROSTER, { teams: TEAMS, out: ["A17-QUILLON", "NOBODY"] });
    expect(state.quarter).toBe(2);
    expect(state.score).toEqual({ home: 3, away: 0 });
    expect(state.possession).toBe("home");
    expect(state.down).toBe(1);
    // The 12-yard completion from the home 30 puts the ball at the home 42.
    expect(state.spot).toEqual({ yardLine: 42, territory: "home" });
    expect(state.qbs).toEqual({ home: "H14-ORMSBY", away: "A12-VANTREE" });
    expect(state.kickers).toEqual({ home: "H3-BOOTHBY" });
    expect(state.punters).toEqual({ home: "H5-DRAKE" });
    // Only ids on a roster are listed as out.
    expect(state.out).toEqual(["A17-QUILLON"]);
    expect(state.distance).toBeUndefined();
  });

  it("leaves the ball spot out when the code does not trust it", () => {
    const plays = countedPlays([play(1, 2, [ev("H22-FENNIMORE", "rush", 8)], { down: 1, distance: 10 })]);
    const state = readerGameState(plays, ROSTER);
    expect(state.possession).toBe("home");
    expect(state.down).toBe(2);
    expect(state.distance).toBe(2);
    expect(state.spot).toBeUndefined();
    expect(state.kickers).toBeUndefined();
  });
});

describe("renderGameState", () => {
  it("is one line per known thing, and nothing for nothing", () => {
    expect(renderGameState({})).toBe("");
    const text = renderGameState({
      teams: { home: "Northfield", away: "Southpoint" },
      quarter: 3,
      score: { home: 14, away: 10 },
      possession: "away",
      down: 3,
      distance: 4,
      spot: { yardLine: 42, territory: "home" },
      qbs: { home: "H7-CASTELLANE" },
      punters: { away: "A9-PELLAM" },
      out: ["H22-FENNIMORE"],
    });
    expect(text).toContain("GAME STATE");
    expect(text).toContain("The transcript wins when they disagree.");
    expect(text).toContain("Home: Northfield. Away: Southpoint.");
    expect(text).toContain("Quarter: 3.");
    expect(text).toContain("Score: Northfield (home) 14, Southpoint (away) 10.");
    expect(text).toContain("Ball: Southpoint (away) has the ball, 3rd and 4, at the Northfield 42.");
    expect(text).toContain("Quarterback on the field: home H7-CASTELLANE.");
    expect(text).toContain("Last punter used: away A9-PELLAM.");
    expect(text).toContain("Out tonight, not playing, never credited: H22-FENNIMORE.");
    expect(text).not.toContain("kicker");
    expect(renderGameState({ possession: "home", spot: { yardLine: 50, territory: "midfield" } })).toContain("the home team (home) has the ball, at midfield.");
  });
});

describe("where the block goes", () => {
  const base: ExtractStatsRequest = {
    utterances: [{ seq: 10, text: "first and ten", offsetMs: 0 }],
    rosters: ROSTER,
    recentPlays: [],
  };
  const state: ReaderGameState = { teams: { home: "Northfield", away: "Southpoint" }, quarter: 2, possession: "home" };

  it("is in the user message, after the applied plays and before the transcript, and never in the cached prefix", () => {
    const without = statsChatRequest(base);
    const withState = statsChatRequest({ ...base, gameState: state });
    expect(withState.system).toEqual(without.system);
    // The prefix names the block in one static sentence; the block itself is never in it.
    expect(JSON.stringify(withState.system)).not.toContain("What the code believes so far");
    expect(withState.content).toContain("GAME STATE\nWhat the code believes so far");
    expect(without.content).not.toContain("GAME STATE");
    const content = volatileContent({ ...base, gameState: state });
    expect(content.indexOf("PLAYS ALREADY APPLIED")).toBeLessThan(content.indexOf("GAME STATE"));
    expect(content.indexOf("GAME STATE")).toBeLessThan(content.indexOf("THE TRANSCRIPT"));
  });

  it("the system prompt says what the block is and that the transcript wins", () => {
    expect(STATS_SYSTEM_PROMPT).toContain("GAME STATE, when the request carries one");
    expect(STATS_SYSTEM_PROMPT).toContain("The transcript wins whenever they disagree.");
  });

  it("the route reads the block field by field and drops what is malformed", () => {
    expect(readGameState(undefined)).toBeNull();
    expect(readGameState({})).toBeNull();
    expect(
      readGameState({
        teams: { home: "Northfield", away: "Southpoint" },
        quarter: 9,
        score: { home: 14, away: -1 },
        possession: "north",
        down: 3,
        distance: 4.4,
        spot: { yardLine: 42, territory: "home" },
        qbs: { home: "H7-CASTELLANE", away: 12 },
        kickers: {},
        out: ["H22-FENNIMORE", 5, ""],
      }),
    ).toEqual({ teams: { home: "Northfield", away: "Southpoint" }, down: 3, distance: 4, spot: { yardLine: 42, territory: "home" }, qbs: { home: "H7-CASTELLANE" }, out: ["H22-FENNIMORE"] });
    const parsed = readRequest({ utterances: [{ seq: 1, text: "x" }], rosters: [{ playerId: "H7-CASTELLANE", side: "home", last: "Castellane" }], gameState: state });
    expect(parsed).not.toBeNull();
    expect((parsed as ExtractStatsRequest).gameState).toEqual(state);
    const bare = readRequest({ utterances: [{ seq: 1, text: "x" }], rosters: [] });
    expect(typeof bare === "object" && bare !== null && "gameState" in bare).toBe(false);
  });
});

describe("the replay log's teams", () => {
  it("come from the game record's names and cues", () => {
    const game = readReplayLog({
      format: "spotter-v3-log",
      version: 1,
      records: [
        {
          kind: "game",
          gameId: "g1",
          at: 1,
          snapshot: {
            home: { id: "h", name: "Northfield", wearing: null },
            away: { id: "a", name: "Southpoint", wearing: null },
            sport: "football",
            watchlist: [],
            keyterms: [],
            teamCues: [
              { words: ["Northfield"], side: "H" },
              { words: ["bears"], side: "H" },
              { words: ["south", "point"], side: "A" },
            ],
            statsEnabled: true,
            statsRoster: ROSTER,
          },
        },
        { kind: "utterance", gameId: "g1", at: 2, connectionId: 1, text: "first and ten", offsetMs: 0 },
      ],
    });
    expect(game.teams).toEqual({ home: { name: "Northfield", phrases: ["northfield", "bears"] }, away: { name: "Southpoint", phrases: ["south point"] } });
  });
});
