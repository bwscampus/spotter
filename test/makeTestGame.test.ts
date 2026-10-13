import os from "node:os";
import { describe, expect, it } from "vitest";
import { readReplayLog } from "@/lib/livestats/replayLog";
import { parseTruthFile } from "@/lib/livestats/truth";
import { cleanDraggedPath, MakeArgsError, parseMakeArgs } from "@/lib/testGames/args";
import { buildTestLog, RosterFileError, rosterFromCsv, testGameName } from "@/lib/testGames/buildLog";
import { EspnError, espnTeamIds, gameFromEspn, parseEspnLink } from "@/lib/testGames/espn";
import { clockMs, normalizeLine, numberWords, readTranscript, TranscriptError } from "@/lib/testGames/transcript";

// `npm run make:game` (scripts/make-test-game.ts): a transcript and two rosters
// into a log the replay and the scorer read. Every name here is made up.

const word = (text: string, start: number, end = start + 0.3) => ({ word: text, punctuated_word: text, start, end, confidence: 0.9 });

describe("readTranscript: Deepgram's JSON", () => {
  it("cuts the words into lines at pauses, using the unpunctuated word and its time", () => {
    const json = {
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "Castellane keeps it. Gain of 4.",
                words: [word("castellane", 10), word("keeps", 10.4), word("it", 10.8), word("gain", 13), word("of", 13.3), word("4", 13.6)],
              },
            ],
          },
        ],
      },
    };
    const transcript = readTranscript(JSON.stringify(json));
    expect(transcript.format).toBe("deepgram");
    expect(transcript.timed).toBe(true);
    expect(transcript.lines).toEqual([
      { startMs: 10_000, text: "castellane keeps it" },
      { startMs: 13_000, text: "gain of 4" },
    ]);
    expect(transcript.numbersConverted).toBe(false);
  });

  it("reads utterances=true, and cuts a long utterance into final-sized lines", () => {
    const words = Array.from({ length: 70 }, (_, i) => word(`w${i}`, 100 + i * 0.25));
    const json = { results: { utterances: [{ start: 100, end: 120, transcript: "", words }] } };
    const { lines } = readTranscript(JSON.stringify(json));
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((line) => line.text.split(" ").length <= 30)).toBe(true);
    expect(lines[0].startMs).toBe(100_000);
    expect(lines.map((line) => line.text).join(" ").split(" ")).toHaveLength(70);
  });

  it("falls back to an utterance's transcript when it carries no words", () => {
    const json = { results: { utterances: [{ start: 2, end: 4, transcript: "Fennimore up the middle" }] } };
    expect(readTranscript(JSON.stringify(json)).lines).toEqual([{ startMs: 2_000, text: "fennimore up the middle" }]);
  });

  it("refuses JSON that is not a transcript, and a broken JSON file", () => {
    expect(() => readTranscript(JSON.stringify({ hello: "there" }))).toThrow(TranscriptError);
    expect(() => readTranscript('{"results": ')).toThrow(/does not read as JSON/);
  });
});

describe("readTranscript: captions and text", () => {
  it("reads an .srt at each caption's start", () => {
    const srt = "1\n00:00:01,500 --> 00:00:03,000\nCastellane under center.\n\n2\n00:00:04,000 --> 00:00:06,000\nHands off to Fennimore.\n";
    const transcript = readTranscript(srt);
    expect(transcript.format).toBe("captions");
    expect(transcript.lines).toEqual([
      { startMs: 1_500, text: "castellane under center" },
      { startMs: 4_000, text: "hands off to fennimore" },
    ]);
  });

  it("reads a .vtt, skipping the header and tags", () => {
    const vtt = "WEBVTT\n\n00:01.000 --> 00:02.000\n<v Speaker 0>Flag on the play</v>\n";
    expect(readTranscript(vtt).lines).toEqual([{ startMs: 1_000, text: "flag on the play" }]);
  });

  it("reads times at the start of text lines, bracketed or not, with speaker labels taken off", () => {
    const text = "[00:00:05] Speaker 0: Kickoff is away.\nSpeaker 1: 00:01:10 Prewitt makes the catch.\n1:02:03.5 - Third quarter.";
    const transcript = readTranscript(text);
    expect(transcript.timed).toBe(true);
    expect(transcript.lines).toEqual([
      { startMs: 5_000, text: "kickoff is away" },
      { startMs: 70_000, text: "prewitt makes the catch" },
      { startMs: 3_723_500, text: "3rd quarter" },
    ]);
  });

  it("a text with a time on only a stray line is untimed: the time is just a word", () => {
    const transcript = readTranscript("Here we go.\n3:15 left in the half and Harborview has it.\nCastellane drops back.\nIncomplete.");
    expect(transcript.timed).toBe(false);
    expect(transcript.lines.map((line) => line.text)).toContain("3 15 left in the half and harborview has it");
  });

  it("spaces untimed text at a talking pace, in order", () => {
    const transcript = readTranscript("Castellane takes the snap and looks deep down the field.\nIncomplete.\n\nPunt team comes on.");
    expect(transcript.timed).toBe(false);
    const starts = transcript.lines.map((line) => line.startMs);
    expect(starts[0]).toBe(0);
    expect(starts.every((start, i) => i === 0 || start > starts[i - 1])).toBe(true);
    // Ten words at 2.6 a second plus the pause.
    expect(starts[1]).toBeCloseTo((10 / 2.6 + 0.6) * 1000, -1);
  });

  it("cuts a paragraph with no line breaks into sentences and short lines", () => {
    const paragraph = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is said here with several more words in it.`).join(" ");
    const { lines } = readTranscript(paragraph);
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.every((line) => line.text.split(" ").length <= 30)).toBe(true);
  });

  it("refuses an empty file", () => {
    expect(() => readTranscript("  \n ")).toThrow(TranscriptError);
  });
});

describe("normalizeLine: what the live socket writes", () => {
  it("lowercases and drops punctuation, keeping apostrophes and decimals", () => {
    expect(normalizeLine("O'Neil's catch! Ball at the 35, Harborview leads 14-7.", false)).toBe("o'neil's catch ball at the 35 harborview leads 14 7");
    expect(normalizeLine("2:30 left, 0.5 seconds, a 23-yard gain, #22 on the tackle.", false)).toBe("2 30 left 0.5 seconds a 23 yard gain number 22 on the tackle");
  });

  it("writes number words as digits only for a file with no digits at all", () => {
    expect(readTranscript("Third and eight from the forty-two.\nTwenty three yards on the play.").lines.map((line) => line.text)).toEqual([
      "3rd and 8 from the 42",
      "23 yards on the play",
    ]);
    // A file that already has digits was transcribed with numerals on: leave its words alone.
    expect(readTranscript("Third and 8.\nNo one open.").lines.map((line) => line.text)).toEqual(["third and 8", "no one open"]);
  });

  it("numberWords leaves a pronoun one alone and reads hundreds", () => {
    expect(numberWords("no one open on that one")).toBe("no one open on that one");
    expect(numberWords("one hundred yards")).toBe("100 yards");
    expect(numberWords("first and ten")).toBe("1st and 10");
  });

  it("clockMs reads hours, minutes and fractions", () => {
    expect(clockMs("1:02:03.5")).toBe(3_723_500);
    expect(clockMs("00:00:01,250")).toBe(1_250);
    expect(clockMs("12:34")).toBe(754_000);
  });
});

// A made-up game the way ESPN's summary and roster JSON lay it out.
const summary = {
  header: {
    competitions: [
      {
        date: "2026-10-10T19:30Z",
        competitors: [
          { homeAway: "home", team: { id: "11", location: "Harborview", name: "Gulls", displayName: "Harborview Gulls" } },
          { homeAway: "away", team: { id: "22", location: "Millbrook", name: "Millers", displayName: "Millbrook Millers" } },
        ],
      },
    ],
  },
  boxscore: {
    players: [
      {
        team: { id: "11" },
        statistics: [
          {
            name: "passing",
            athletes: [
              { athlete: { id: "1", firstName: "Tobin", lastName: "Castellane", displayName: "Tobin Castellane", jersey: "7" } },
              // Left the team's page since the game: the box score still has him.
              { athlete: { id: "9", firstName: "Ned", lastName: "Halloway", displayName: "Ned Halloway", jersey: "12" } },
            ],
          },
        ],
      },
      { team: { id: "22" }, statistics: [{ name: "rushing", athletes: [{ athlete: { id: "5", displayName: "Lyle Thistlewood Jr.", jersey: "9" } }, { athlete: { displayName: "TEAM" } }] }] },
    ],
  },
};
const homeRoster = {
  athletes: [
    { position: "offense", items: [{ id: "1", firstName: "Tobin", lastName: "Castellane", jersey: "7", position: { abbreviation: "QB" } }] },
    { position: "specialTeam", items: [{ id: "3", firstName: "Amos", lastName: "Dunmore III", jersey: "39", position: { abbreviation: "PK" } }] },
  ],
};

describe("ESPN", () => {
  it("parses a game page's link, and a bare game number", () => {
    expect(parseEspnLink("https://www.espn.com/college-football/game/_/gameId/401856712/georgia-alabama")).toEqual({ gameId: "401856712", league: "college-football" });
    expect(parseEspnLink("https://www.espn.com/nfl/boxscore/_/gameId/401772998")).toEqual({ gameId: "401772998", league: "nfl" });
    expect(parseEspnLink(" 401856712 ")).toEqual({ gameId: "401856712", league: null });
    expect(parseEspnLink("georgia alabama")).toBeNull();
  });

  it("reads both teams, merges the roster with the box score, and takes suffixes off", () => {
    expect(espnTeamIds(summary)).toEqual({ home: "11", away: "22" });
    const game = gameFromEspn(summary, "college-football", "401", new Map([["11", homeRoster]]));
    expect(game.date).toBe(Date.parse("2026-10-10T19:30Z"));
    expect(game.home).toMatchObject({ teamId: "11", school: "Harborview", mascot: "Gulls" });
    expect(game.home.players).toEqual([
      { jersey: "7", first_name: "Tobin", last_name: "Castellane", position: "QB" },
      { jersey: "39", first_name: "Amos", last_name: "Dunmore", position: "PK" },
      { jersey: "12", first_name: "Ned", last_name: "Halloway", position: null },
    ]);
    // No roster fetched for the away team: the box score's players, and never its TEAM row.
    expect(game.away.players).toEqual([{ jersey: "9", first_name: "Lyle", last_name: "Thistlewood", position: null }]);
  });

  it("reads the summary's own rosters when ESPN includes them", () => {
    const withRosters = { ...summary, rosters: [{ homeAway: "away", roster: [{ jersey: "24", position: { abbreviation: "LB" }, athlete: { id: "8", firstName: "Penn", lastName: "Ashgrove" } }] }] };
    const game = gameFromEspn(withRosters, "nfl", "401", new Map());
    expect(game.away.players).toContainEqual({ jersey: "24", first_name: "Penn", last_name: "Ashgrove", position: "LB" });
  });

  it("refuses a summary that does not say which team is home", () => {
    expect(() => espnTeamIds({ header: { competitions: [{ competitors: [] }] } })).toThrow(EspnError);
  });
});

describe("rosterFromCsv", () => {
  it("reads first and last name columns", () => {
    expect(rosterFromCsv("Number,First name,Last name,Position\n7,Tobin,Castellane,qb\n,,,\n")).toEqual([
      { jersey: "7", first_name: "Tobin", last_name: "Castellane", position: "QB" },
    ]);
  });

  it("reads one name column, either way round, with suffixes taken off", () => {
    expect(rosterFromCsv('#,Name,Pos\n#9,Lyle Thistlewood,QB\n24,"Ashgrove, Penn",DB\n5,Jo Bates III,K\n')).toEqual([
      { jersey: "9", first_name: "Lyle", last_name: "Thistlewood", position: "QB" },
      { jersey: "24", first_name: "Penn", last_name: "Ashgrove", position: "DB" },
      { jersey: "5", first_name: "Jo", last_name: "Bates", position: "K" },
    ]);
  });

  it("refuses a file with no name column", () => {
    expect(() => rosterFromCsv("7,Tobin,Castellane\n9,Lyle,Thistlewood\n")).toThrow(RosterFileError);
  });
});

describe("buildTestLog", () => {
  it("makes a log the replay reads: both full rosters, the team cues, every line in order on the wall clock", () => {
    const transcript = readTranscript("[00:00:05] Castellane keeps it.\n[00:00:12] Gulls ball, 2nd and 6.");
    const game = gameFromEspn(summary, "college-football", "401", new Map([["11", homeRoster]]));
    const log = buildTestLog({ gameId: "g1", startAt: 1_000_000, home: game.home, away: game.away, lines: transcript.lines, source: "transcript:text" });
    const replay = readReplayLog(JSON.parse(JSON.stringify(log)));
    expect(replay.home).toBe("Harborview");
    expect(replay.away).toBe("Millbrook");
    expect(replay.sport).toBe("football");
    expect(replay.rosters).toHaveLength(1);
    expect(replay.rosters[0].fullRoster).toBe(true);
    expect(replay.rosters[0].players.map((player) => player.playerId)).toEqual(["H7-CASTELLANE", "H39-DUNMORE", "H12-HALLOWAY", "A9-THISTLEWOOD"]);
    expect(replay.teams?.home.phrases).toContain("gulls");
    expect(replay.utterances.map((u) => [u.seq, u.text, u.at])).toEqual([
      [0, "castellane keeps it", 1_005_000],
      [1, "gulls ball 2nd and 6", 1_012_000],
    ]);
  });

  it("names the files so .gitignore keeps them out of git, and the truth file is one the scorer takes", () => {
    const name = testGameName("Millbrook", "Harborview High School", "401856712");
    expect(name).toBe("spotter-log-millbrook-at-harborview-high-school-401856712");
    expect(() => parseTruthFile({ source: "espn", league: "college-football", gameId: "401856712" })).not.toThrow();
  });
});

describe("make:game's arguments", () => {
  it("reads the transcript and every option", () => {
    expect(parseMakeArgs(["game.json", "--espn", "401856712", "--out", "~/Set", "--force"])).toMatchObject({
      transcript: "game.json",
      espn: "401856712",
      out: "~/Set",
      force: true,
    });
    expect(parseMakeArgs([])).toMatchObject({ transcript: null, espn: null });
  });

  it("refuses an unknown option or one with no value", () => {
    expect(() => parseMakeArgs(["--espn"])).toThrow(MakeArgsError);
    expect(() => parseMakeArgs(["--colour", "red"])).toThrow(MakeArgsError);
  });

  it("cleans a path dragged into the terminal", () => {
    expect(cleanDraggedPath("/Users/jed/My\\ Games/ga\\ bama.json ")).toBe("/Users/jed/My Games/ga bama.json");
    expect(cleanDraggedPath("'/Users/jed/My Games/x.txt'")).toBe("/Users/jed/My Games/x.txt");
    expect(cleanDraggedPath("~/SpotterTestSet")).toBe(`${os.homedir()}/SpotterTestSet`);
  });
});
