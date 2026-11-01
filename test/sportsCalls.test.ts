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
