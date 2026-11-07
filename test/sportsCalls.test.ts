import { describe, expect, it } from "vitest";
import type { DeepgramResults, DeepgramWord } from "@/lib/deepgram/config";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import type { NumberContext } from "@/lib/matching/numbers";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";
import type { Sport } from "@/lib/rosters/types";

// =============================================================================
// Basketball and volleyball calls through the real engine (Nov 1, when the
// first outside announcer asked for both alongside football). A name or a cued
// number puts the right card up; a score, a clock, a stat count, a set, a
// rotation or a shot's value does not. Made-up names only.
// =============================================================================

const player = (jersey: string, last_name: string): GamePlayer => ({ jersey, last_name, spoken_forms: spokenForms(last_name) });
const HOME = [player("22", "Quintero"), player("11", "Okafor"), player("7", "Halvorsen"), player("4", "Brannigan"), player("14", "Tillman"), player("2", "Prewitt")];
const AWAY = [player("3", "Ferreira"), player("24", "Mbeki"), player("10", "Dunleavy"), player("12", "Saldana"), player("1", "Ashby"), player("5", "Pruitt")];
const watchlist = buildGameWatchlist(HOME, AWAY).entries;
const CUES: NumberContext["teamCues"] = [
  { words: ["eagles"], side: "H" },
  { words: ["lakeview"], side: "H" },
  { words: ["rams"], side: "A" },
  { words: ["ridgecrest"], side: "A" },
];

function results(transcript: string): DeepgramResults {
  const words: DeepgramWord[] = transcript.split(/\s+/).map((word, i) => ({ word, start: 10 + i * 0.3, end: 10 + i * 0.3 + 0.25, confidence: 0.99 }));
  return {
    type: "Results",
    is_final: true,
    speech_final: true,
    start: 10,
    duration: words.length * 0.3,
    channel: { alternatives: [{ transcript, confidence: 0.99, words }] },
  };
}

/** The cards one utterance puts up, as "Surname#jersey", on a fresh engine. */
function cards(transcript: string, sport: Sport): string[] {
  const outcome = new SpotterEngine(watchlist, { sport, teamCues: CUES }).process(results(transcript), 1, 1000, 1_700_000_000_000);
  return (outcome.display?.players ?? []).map((shown) => `${shown.last_name}#${shown.jersey}`);
}

describe("basketball", () => {
  it.each([
    ["quintero drives and scores", ["Quintero#22"]],
    ["number 24 for the rams", ["Mbeki#24"]],
    ["foul on number 11", ["Okafor#11"]],
    ["okafor at the line for 2", ["Okafor#11"]],
    ["halvorsen from 3", ["Halvorsen#7"]],
    ["mbeki with 14 points", ["Mbeki#24"]],
    ["ferreira knocks down a 3 pointer", ["Ferreira#3"]],
    ["and 1 for quintero", ["Quintero#22"]],
    ["rams 24 with the steal", ["Mbeki#24"]],
    ["tillman 2 of 2 at the line", ["Tillman#14"]],
    ["brannigan with the block", ["Brannigan#4"]],
  ])("%s", (said, expected) => {
    expect(cards(said, "basketball")).toEqual(expected);
  });

  it.each([
    "eagles lead 54 52",
    "14 seconds on the shot clock",
    "eagles have 2 timeouts left",
    "4 minutes left in the 2nd quarter",
    "lakeview up 10",
    "12 to 10 rams",
    "he has 12 rebounds",
  ])("puts nothing up for: %s", (said) => {
    expect(cards(said, "basketball")).toEqual([]);
  });
});

describe("volleyball", () => {
  it.each([
    ["kill by halvorsen", ["Halvorsen#7"]],
    ["number 7 serving", ["Halvorsen#7"]],
    ["ace for number 22", ["Quintero#22"]],
    ["dig by mbeki", ["Mbeki#24"]],
    ["okafor with 12 kills", ["Okafor#11"]],
    ["saldana in the back row", ["Saldana#12"]],
    ["number 10 dunleavy serving", ["Dunleavy#10"]],
  ])("%s", (said, expected) => {
    expect(cards(said, "volleyball")).toEqual(expected);
  });

  it.each([
    "15 13 eagles",
    "set 2 underway",
    "side out serving at 20 18",
    "rams lead the set 2 to 1",
    "eagles win set 1 25 to 21",
    "match point lakeview 24 23",
    "rotation 3 for the rams",
    "10 serves it up",
    "timeout rams down 18 12",
  ])("puts nothing up for: %s", (said) => {
    expect(cards(said, "volleyball")).toEqual([]);
  });
});

// Ice hockey (Nov 6), sport "ice_hockey": a name or cued number puts the card up, and a score,
// a manpower count ("5 on 3"), a period clock or a stat line after a team name
// ("Rams 24 shots", "Eagles 12 saves") does not.
describe("ice hockey", () => {
  it.each([
    ["quintero scores", ["Quintero#22"]],
    ["goal by number 22", ["Quintero#22"]],
    ["number 22 goal", ["Quintero#22"]],
    ["shot by mbeki", ["Mbeki#24"]],
    ["save by okafor", ["Okafor#11"]],
    ["number 22 saves it", ["Quintero#22"]],
    ["number 11 to the box for tripping", ["Okafor#11"]],
    ["penalty on number 7 for the eagles", ["Halvorsen#7"]],
    ["rams 24 with the shot", ["Mbeki#24"]],
    ["rams 24 shoots", ["Mbeki#24"]],
    ["rams 24 wins the faceoff", ["Mbeki#24"]],
    ["rams 12 hits the post", ["Saldana#12"]],
    ["number 22 power play goal", ["Quintero#22"]],
    ["dunleavy wins the faceoff", ["Dunleavy#10"]],
    ["saldana on the breakaway", ["Saldana#12"]],
    ["tillman 14 slaps it home", ["Tillman#14"]],
  ])("%s", (said, expected) => {
    expect(cards(said, "ice_hockey")).toEqual(expected);
  });

  it.each([
    "eagles lead 2 1",
    "it is 3 1 rams",
    "eagles 3 rams 1",
    "power play 5 on 4",
    "eagles on a 5 on 3",
    "a 2 on 1 the other way",
    "12 minutes left in the 2nd period",
    "with 30 seconds left",
    "shots 14 to 9",
    "2 minutes for tripping",
    "a 5 minute major",
    "the 3rd period",
    "rams 0 for 3 on the power play",
    "rams 24 shots",
    "eagles 22 shots on goal",
    "rams 12 saves",
    "eagles 22 saves on 24 shots",
    "eagles 11 goals this season",
    "rams 12 faceoffs",
    "eagles 14 blocked shots",
    "rams 24 power plays",
    "eagles 10 penalty minutes",
    "rams 12 for the season",
    "eagles 22 on the year",
    "rams 12 wins",
    "eagles 14 hits",
    "rams 24 skaters",
    "rams 10 games",
  ])("puts nothing up for: %s", (said) => {
    expect(cards(said, "ice_hockey")).toEqual([]);
  });
});

// Soccer (Nov 7): a name or cued number puts the card up; a score ("2 nil"),
// a minute, a formation, a distance and a stat line after a team name
// ("Rams 24 shots", "Eagles 11 yellow cards") do not.
describe("soccer", () => {
  it.each([
    ["quintero scores", ["Quintero#22"]],
    ["goal by number 22", ["Quintero#22"]],
    ["number 22 goal", ["Quintero#22"]],
    ["save by okafor", ["Okafor#11"]],
    ["number 11 saves it", ["Okafor#11"]],
    ["yellow card for number 7", ["Halvorsen#7"]],
    ["number 7 yellow card", ["Halvorsen#7"]],
    ["rams 24 with the shot", ["Mbeki#24"]],
    ["rams 24 wins the ball", ["Mbeki#24"]],
    ["corner kick taken by dunleavy", ["Dunleavy#10"]],
    ["tillman 14 heads it in", ["Tillman#14"]],
    ["eagles 22 on the ball", ["Quintero#22"]],
  ])("%s", (said, expected) => {
    expect(cards(said, "soccer")).toEqual(expected);
  });

  it.each([
    "eagles lead 2 1",
    "it is 3 nil rams",
    "2 nil eagles",
    "nil nil at the half",
    "in the 35th minute",
    "12 minutes left in the half",
    "4 minutes of stoppage time",
    "playing a 4 3 3",
    "from 25 yards out",
    "down to 10 men",
    "rams 24 shots",
    "rams 12 saves",
    "eagles 11 goals this season",
    "rams 12 corners",
    "rams 12 corner kicks",
    "eagles 22 on the year",
    "rams 12 for the season",
    "eagles 11 yellow cards",
    "rams 10 games",
    "rams 24 offsides",
    "rams 12 wins",
    "rams 12 clean sheets",
    "eagles 22 fouls",
  ])("puts nothing up for: %s", (said) => {
    expect(cards(said, "soccer")).toEqual([]);
  });
});

// The hockey and soccer rules are theirs alone: a football game reads these exactly as
// it did before Nov 6 (a team cue and a two-digit number fire), so a football
// game running beside a hockey one is unchanged.
describe("hockey and soccer rules never reach football", () => {
  it.each([
    ["rams 12 saves", ["Saldana#12"]],
    ["rams 24 shots", ["Mbeki#24"]],
    ["eagles 22 for the season", ["Quintero#22"]],
    ["rams 12 wins", ["Saldana#12"]],
    ["rams 12 corners", ["Saldana#12"]],
    ["eagles 11 yellow cards", ["Okafor#11"]],
    ["rams 24 offsides", ["Mbeki#24"]],
  ])("%s", (said, expected) => {
    expect(cards(said, "football")).toEqual(expected);
  });
});

