import readExcelFile from "read-excel-file/node";
import writeExcelFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import type { StatChange } from "@/lib/cards/tonight";
import type { LoggedPlay } from "@/lib/log/statsLog";
import { buildStatsReport, workbookSheets, type ReportSheet } from "@/lib/log/statsReport";

// The live stats report (testrun): play by play, what each player came to, the
// calls and the transcript, in one workbook. Made-up names only.

const ROSTER: KeyedPlayer[] = [
  { playerId: "H22-FENNIMORE", side: "home", jersey: "22", first: "Reed", last: "Fennimore", position: "RB" },
  { playerId: "H7-CASTELLANE", side: "home", jersey: "7", first: "Tobin", last: "Castellane", position: "QB" },
  { playerId: "H81-PREWITT", side: "home", jersey: "81", first: "Calder", last: "Prewitt", position: "WR" },
  { playerId: "A17-QUILLON", side: "away", jersey: "17", first: "Marek", last: "Quillon", position: "LB" },
  { playerId: "A3-ASHGROVE", side: "away", jersey: "3", first: "Penn", last: "Ashgrove", position: "DB" },
];

const START = 1_800_000_000_000;

function play(seqStart: number, seqEnd: number, extra: Partial<LoggedPlay> = {}): LoggedPlay {
  return {
    seqStart,
    seqEnd,
    quarter: 2,
    clock: "4:10",
    down: 3,
    distance: 4,
    offense: "home",
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: `play ${seqStart}-${seqEnd}`,
    evidence: "up the middle",
    events: [],
    ...extra,
  };
}

const change = (playerId: string, key: StatChange["key"], amount: number | null, estimated = false): StatChange => ({
  playerId,
  key,
  amount,
  estimated,
});

const RUN_CHANGES = [change("H22-FENNIMORE", "rush_att", 1), change("H22-FENNIMORE", "rush_yds", 8), change("A17-QUILLON", "tkl", 1)];
const PASS_CHANGES = [
  change("H7-CASTELLANE", "pass_att", 1),
  change("H7-CASTELLANE", "pass_cmp", 1),
  change("H7-CASTELLANE", "pass_yds", 12, true),
  change("H81-PREWITT", "rec", 1),
  change("H81-PREWITT", "rec_yds", 12, true),
  change("A3-ASHGROVE", "tkl", 1),
];

const LOG = [
  {
    kind: "game",
    gameId: "game-1",
    at: START,
    snapshot: { home: { name: "Brentwood" }, away: { name: "Estancia" }, statsRoster: ROSTER },
  },
  { kind: "utterance", gameId: "game-1", at: START + 1_000, connectionId: 1, text: "fennimore up the middle for eight", offsetMs: 0 },
  { kind: "utterance", gameId: "game-1", at: START + 2_000, connectionId: 1, text: "  ", offsetMs: 1_000 },
  { kind: "utterance", gameId: "game-1", at: START + 3_000, connectionId: 1, text: "brought down by quillon", offsetMs: 2_000 },
  { kind: "utterance", gameId: "game-1", at: START + 4_000, connectionId: 1, text: "castellane finds prewitt", offsetMs: 3_000 },
  { kind: "utterance", gameId: "game-1", at: START + 5_000, connectionId: 1, text: "timeout on the field", offsetMs: 4_000 },
  { kind: "utterance", gameId: "game-1", at: START + 6_000, connectionId: 1, text: "fennimore again", offsetMs: 5_000 },
  { kind: "stats_reply", gameId: "game-1", at: START + 7_000, ok: false, code: "claude_timeout", seqFrom: 0, seqTo: 1 },
  {
    kind: "stats_reply",
    gameId: "game-1",
    at: START + 8_000,
    ok: true,
    plays: [play(0, 1), play(2, 2)],
    seqFrom: 0,
    seqTo: 2,
    tokensIn: 1_000,
    tokensOut: 50,
    tokensCached: 900,
  },
  { kind: "stats_play", gameId: "game-1", at: START + 8_000, playId: "0-1", play: play(0, 1), changes: RUN_CHANGES, dropped: [] },
  { kind: "stats_decision", gameId: "game-1", at: START + 8_000, playId: "0-1", decision: "ok" },
  {
    kind: "stats_play",
    gameId: "game-1",
    at: START + 8_000,
    playId: "2-2",
    play: play(2, 2, { playType: "pass", summary: "Castellane to Prewitt", touchdown: true }),
    changes: PASS_CHANGES,
    dropped: [{ playerId: "H81-PREWITT", action: "fumble", rule: "R3", reason: "no recovery said" }],
  },
  { kind: "stats_decision", gameId: "game-1", at: START + 8_000, playId: "2-2", decision: "ok" },
  {
    kind: "stats_play",
    gameId: "game-1",
    at: START + 9_000,
    playId: "4-4",
    play: play(4, 4),
    changes: [change("H22-FENNIMORE", "rush_att", 1), change("H22-FENNIMORE", "rush_yds", null)],
    dropped: [],
  },
  { kind: "stats_decision", gameId: "game-1", at: START + 9_000, playId: "4-4", decision: "discard" },
];

function sheet(name: string): ReportSheet {
  const report = buildStatsReport(LOG);
  const found = report?.sheets.find((each) => each.name === name);
  if (!found) throw new Error(`no ${name} sheet`);
  return found;
}

/** One row as a map from its header, for reading a cell by column name. */
function rowsOf(found: ReportSheet) {
  return found.rows.map((row) => Object.fromEntries(found.header.map((name, index) => [name, row[index]])));
}

describe("the report", () => {
  it("is named for the game and has the four sheets", () => {
    const report = buildStatsReport(LOG)!;
    expect(report.title).toBe("Estancia at Brentwood");
    expect(report.sheets.map((each) => each.name)).toEqual(["Totals", "Play by play", "Calls", "Events", "Transcript"]);
  });

  it("has nothing to say about a game that read nothing and heard nothing", () => {
    expect(buildStatsReport([{ kind: "game" }, { kind: "result" }])).toBeNull();
  });
});

describe("Totals", () => {
  it("adds up counted plays only, a column per stat anybody has, away team first", () => {
    const totals = sheet("Totals");
    expect(totals.header).toEqual([
      "Team",
      "#",
      "Player",
      "Pos",
      "Car",
      "Rush yds",
      "Cmp",
      "Att",
      "Pass yds",
      "Rec",
      "Rec yds",
      "Tkl",
      "Worked out",
    ]);
    const rows = rowsOf(totals);
    // Away first, then by jersey; the two team totals have no player.
    expect(rows.map((row) => row.Player)).toEqual([
      "Penn Ashgrove",
      "Marek Quillon",
      "Tobin Castellane",
      "Reed Fennimore",
      "Calder Prewitt",
      "",
      "",
    ]);
    const fennimore = rows.find((row) => row.Player === "Reed Fennimore")!;
    // The discarded run counts nothing.
    expect(fennimore).toMatchObject({ Team: "Brentwood", "#": "22", Pos: "RB", Car: 1, "Rush yds": 8, Tkl: null });
    const castellane = rows.find((row) => row.Player === "Tobin Castellane")!;
    expect(castellane).toMatchObject({ Cmp: 1, Att: 1, "Pass yds": 12, "Worked out": "Pass yds" });
  });

  it("ends with each team's total", () => {
    const rows = rowsOf(sheet("Totals"));
    expect(rows.at(-2)).toMatchObject({ Team: "Estancia total", Tkl: 2, Car: null });
    expect(rows.at(-1)).toMatchObject({ Team: "Brentwood total", Car: 1, "Rush yds": 8, "Pass yds": 12, Rec: 1, Tkl: null });
  });

  it("says how many plays it counted of how many it read", () => {
    expect(sheet("Totals").intro[1]).toBe("Counted plays only: 2 counted, 1 discarded, 0 waiting, of 3 read.");
  });
});

describe("Play by play", () => {
  it("is every play read, in order, with where, what Spotter thinks happened, its stats and the words", () => {
    const rows = rowsOf(sheet("Play by play"));
    expect(rows.map((row) => [row["#"], row.Status, row.Lines])).toEqual([
      [1, "counted", "1-2"],
      [2, "counted", "3"],
      [3, "discarded", "5"],
    ]);
    expect(rows[0]).toMatchObject({
      Q: 2,
      Clock: "4:10",
      Down: 3,
      "To go": 4,
      Offense: "Brentwood",
      Play: "run",
      Stats: "FENNIMORE #22 +1 Car, FENNIMORE #22 +8 Rush yds, QUILLON #17 +1 Tkl",
      Heard: "up the middle",
      Confidence: 0.9,
    });
    expect(rows[1]).toMatchObject({
      "What it thinks happened": "Castellane to Prewitt",
      Flags: "TD",
      "Dropped by a rule": "R3 fumble by PREWITT #81: no recovery said",
    });
    expect(rows[1].Stats).toContain("CASTELLANE #7 ~12 Pass yds");
    expect(rows[2].Stats).toBe("FENNIMORE #22 +1 Car, FENNIMORE #22 ? Rush yds");
  });
});

describe("Calls", () => {
  it("is every call, with the lines it read and what came back", () => {
    expect(rowsOf(sheet("Calls")).map((row) => [row.Result, row.Lines, row["Plays returned"], row["Tokens in"]])).toEqual([
      ["claude_timeout", "1-2", null, null],
      ["ok", "1-3", 2, 1_000],
    ]);
  });
});

describe("Transcript", () => {
  it("numbers every non-blank line the way the live loop does, with the play each went into", () => {
    const rows = rowsOf(sheet("Transcript"));
    expect(rows.map((row) => [row.Line, row.Said, row.Play])).toEqual([
      [1, "fennimore up the middle for eight", "1"],
      [2, "brought down by quillon", "1"],
      [3, "castellane finds prewitt", "2"],
      // Nothing came from this line: where to look for a miss.
      [4, "timeout on the field", ""],
      [5, "fennimore again", "3"],
    ]);
  });
});

describe("the .xlsx", () => {
  it("opens as a workbook with the five sheets, the header in place and numbers as numbers", async () => {
    const buffer = await writeExcelFile(workbookSheets(buildStatsReport(LOG)!)).toBuffer();
    const sheets = await readExcelFile(buffer);
    expect(sheets.map((each) => each.sheet)).toEqual(["Totals", "Play by play", "Calls", "Events", "Transcript"]);
    const totals = sheets[0].data;
    expect(totals[0][0]).toBe("Estancia at Brentwood");
    const headerAt = totals.findIndex((row) => row[0] === "Team");
    expect(headerAt).toBe(4);
    const fennimore = totals.find((row) => row[2] === "Reed Fennimore")!;
    expect(fennimore[4]).toBe(1);
    expect(fennimore[5]).toBe(8);
    const transcript = sheets[4].data;
    expect(transcript.at(-1)).toEqual([5, expect.any(String), "fennimore again", "3"]);
  });
});
