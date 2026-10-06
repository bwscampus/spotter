import { describe, expect, it } from "vitest";
import type { DeepgramResults, DeepgramWord } from "@/lib/deepgram/config";
import type { LogRow } from "@/lib/matching/matchLog";
import { normalizeNumbers, parseJerseyMentions, type NumberContext } from "@/lib/matching/numbers";
import { resolveJersey } from "@/lib/matching/resolveJersey";
import { MAX_NAMES_ON_SCREEN, SpotterEngine } from "@/lib/matching/SpotterEngine";
import { buildTeamCues } from "@/lib/game/teamCues";
import { buildGameWatchlist, buildJerseyIndex, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";
import type { Sport } from "@/lib/rosters/types";

// =============================================================================
// One game, both rosters, with everything that makes numbers hard on it: a 12
// on each side, two Williamses, a Smith who does not wear the number he gets
// said next to, a 0 and a 00, and the 15/50 pair.
// =============================================================================

const player = (jersey: string | null, last_name: string): GamePlayer => ({
  jersey,
  last_name,
  spoken_forms: spokenForms(last_name),
});

const HOME = [
  player("12", "Chen"),
  player("10", "Williams"),
  player("23", "Williams"),
  player("32", "Smith"),
  player("00", "Nakamura"),
  player("0", "Ruiz"),
  player("15", "Torres"),
  player("50", "Delgado"),
  player("7", "Brooks"),
  player("9", "Ortiz"),
];
const AWAY = [player("12", "Patel"), player("5", "Hayes"), player("3", "Okafor")];

const watchlist = buildGameWatchlist(HOME, AWAY).entries;
const index = buildJerseyIndex(watchlist);

const CUES: NumberContext["teamCues"] = [
  { words: ["eagles"], side: "H" },
  { words: ["white"], side: "H" },
  { words: ["crossroads"], side: "A" },
];

const context = (sport: Sport | null): NumberContext => ({ sport, teamCues: CUES });

function words(transcript: string, from: number): DeepgramWord[] {
  return transcript.split(/\s+/).map((word, i) => ({
    word,
    start: from + i * 0.3,
    end: from + i * 0.3 + 0.25,
    confidence: 0.99,
  }));
}

function results(transcript: string, from: number, isFinal: boolean): DeepgramResults {
  const spoken = words(transcript, from);
  return {
    type: "Results",
    is_final: isFinal,
    speech_final: isFinal,
    start: from,
    duration: spoken.length * 0.3,
    channel: { alternatives: [{ transcript, confidence: 0.99, words: spoken }] },
  };
}

/** "Williams #23 H", which is how these tests read a card off the screen. */
const shown = (outcome: { display?: { players: Array<{ last_name: string; jersey: string | null; side: string }> } }) =>
  (outcome.display?.players ?? []).map((p) => `${p.last_name} #${p.jersey} ${p.side}`);

/** Feeds one utterance to a fresh engine and reads back the cards and the rows. */
function say(transcript: string, sport: Sport | null = "basketball") {
  const engine = new SpotterEngine(watchlist, context(sport));
  const outcome = engine.process(results(transcript, 10, true), 1, 1000, 1_700_000_000_000);
  return { cards: shown(outcome), rows: outcome.rows, outcome };
}

const reasons = (rows: LogRow[], type: LogRow["type"]) =>
  rows.filter((row) => row.type === type).map((row) => row.reason ?? null);

describe("what reaches the screen", () => {
  it("number 23 drives baseline: the Williams wearing 23, not both", () => {
    expect(say("number 23 drives baseline").cards).toEqual(["Williams #23 H"]);
  });

  it("Williams, number 23, for three: the number narrows the surname, and three does nothing", () => {
    const { cards, rows } = say("williams number 23 for three");
    expect(cards).toEqual(["Williams #23 H"]);
    expect(rows.filter((row) => row.type === "match")).toHaveLength(1);
    expect(rows.find((row) => row.type === "match")).toMatchObject({ cue: "explicit", name: "Williams #23" });
  });

  it("number 12 with 20 points: both twelves, labelled by side, and 20 turned away", () => {
    const { cards, rows } = say("number 12 with 20 points");
    expect(cards).toEqual(["Chen #12 H", "Patel #12 A"]);
    // One trigger, not two: the 20 never became a card.
    expect(rows.filter((row) => row.type === "match")).toHaveLength(1);
  });

  it("number 12, Chen: the surname settles which twelve", () => {
    expect(say("number 12 chen").cards).toEqual(["Chen #12 H"]);
  });

  it("Eagles 12 at the line: the team cue settles which twelve", () => {
    expect(say("eagles 12 at the line").cards).toEqual(["Chen #12 H"]);
  });

  it("number double zero: the 00 player, never the 0 player", () => {
    expect(say("number double zero").cards).toEqual(["Nakamura #00 H"]);
  });

  it("number one two: both twelves", () => {
    expect(say("number one two").cards).toEqual(["Chen #12 H", "Patel #12 A"]);
  });

  it("number 15: the 50 as well, because a booth mic loses that consonant", () => {
    expect(say("number 15").cards).toEqual(["Torres #15 H", "Delgado #50 H"]);
  });

  it("Smith 23: the surname wins and the disagreement is logged", () => {
    const { cards, rows } = say("smith 23");
    expect(cards).toEqual(["Smith #32 H"]);
    expect(rows.find((row) => row.type === "conflict")).toMatchObject({
      word: "smith 23",
      reason: "surname_disagrees",
    });
  });

  it("number 45: nobody, and a near miss that says why", () => {
    const { cards, rows } = say("number 45");
    expect(cards).toEqual([]);
    expect(reasons(rows, "near_miss")).toContain("not_on_roster");
  });

  const quiet: Array<[string, Sport | null]> = [
    ["they lead 14 to 12", "basketball"],
    ["2 30 left in the 0.5", "basketball"],
    ["up 7 with a minute to go", "basketball"],
    ["and 1", "basketball"],
    ["3rd and 7 at the 35", "football"],
    ["a gain of 12", "football"],
    ["serving a 20 to 18", "volleyball"],
  ];

  for (const [transcript, sport] of quiet) {
    it(`"${transcript}" shows nobody`, () => {
      const { cards, rows } = say(transcript, sport);
      expect(cards).toEqual([]);
      expect(rows.filter((row) => row.type === "match")).toEqual([]);
    });
  }

  it("number 7 to the 20 yard line: the 7 only", () => {
    const { cards, rows } = say("number 7 to the 20 yard line", "football");
    expect(cards).toEqual(["Brooks #7 H"]);
    expect(rows.filter((row) => row.type === "match")).toHaveLength(1);
  });

  it("logs why a number that is on a roster was turned away", () => {
    // 12 is worn by two players tonight, so why it did not fire is worth a row.
    expect(reasons(say("they lead 14 to 12").rows, "near_miss")).toContain("veto:score");
  });

  it("keeps the log clear of numbers nobody wears and nobody cued", () => {
    // Play-by-play is full of these. A row each would push the rows that matter
    // out of the log within a game or two.
    expect(reasons(say("2 30 left in the 0.5").rows, "near_miss")).toEqual([]);
  });

  it("2 and 1 count to number 9: the 9 only", () => {
    expect(say("2 and 1 count to number 9", "baseball").cards).toEqual(["Ortiz #9 H"]);
  });

  it("keeps the newest three and drops the rest", () => {
    // Three, because the two cards behind the newest one are compact and a
    // fourth would leave all of them too small to read from across a booth.
    expect(MAX_NAMES_ON_SCREEN).toBe(3);
    const engine = new SpotterEngine(watchlist, context("basketball"));
    const spoken = ["chen", "ortiz", "brooks", "hayes"];
    let last = engine.process(results(spoken[0], 10, true), 1, 1000, 1);
    spoken.slice(1).forEach((word, i) => {
      last = engine.process(results(word, 20 + i * 10, true), 1, 20_000 + i * 20_000, 2 + i);
    });
    expect(shown(last)).toEqual(["Hayes #5 A", "Brooks #7 H", "Ortiz #9 H"]);
  });
});

describe("interim results", () => {
  it("does not fire on a number that may still grow, then fires on the final", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    // "twenty" is a prefix of "twenty three", and Deepgram's numerals hands
    // over the prefix as "20".
    const interim = engine.process(results("number 20", 10, false), 1, 1000, 1);
    expect(shown(interim)).toEqual([]);
    const final = engine.process(results("number 23", 10, true), 1, 1100, 2);
    expect(shown(final)).toEqual(["Williams #23 H"]);
  });

  it("does not fire on a cue that is the last word of an interim", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    const interim = engine.process(results("number", 10, false), 1, 1000, 1);
    expect(interim.rows.filter((row) => row.type === "match")).toEqual([]);
    const next = engine.process(results("number 23 drives", 10, false), 1, 1100, 2);
    expect(shown(next)).toEqual(["Williams #23 H"]);
  });

  it("narrows a surname already on screen instead of triggering again", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    const first = engine.process(results("williams", 10, false), 1, 1000, 1);
    expect(shown(first)).toEqual(["Williams #10 H", "Williams #23 H"]);
    const second = engine.process(results("williams number 23", 10, true), 1, 1100, 2);
    expect(shown(second)).toEqual(["Williams #23 H"]);
  });
});

describe("repeat suppression keys on the player", () => {
  it("counts a surname and then its number as one trigger", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    const first = engine.process(results("smith", 10, true), 1, 1000, 1);
    expect(shown(first)).toEqual(["Smith #32 H"]);
    const second = engine.process(results("number 32", 20, true), 1, 2000, 2);
    expect(second.rows.filter((row) => row.type === "match")).toEqual([]);
    expect(second.rows.some((row) => row.type === "repeat")).toBe(true);
  });

  it("triggers again once the window has passed", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    engine.process(results("smith", 10, true), 1, 1000, 1);
    const later = engine.process(results("number 32", 20, true), 1, 20_000, 2);
    expect(later.rows.some((row) => row.type === "match")).toBe(true);
  });
});

describe("resolveJersey", () => {
  const mention = (number: string, over: Partial<Parameters<typeof resolveJersey>[0]> = {}) => ({
    number,
    cue: "explicit" as const,
    cueWord: "number",
    side: null,
    surname: null,
    firstIndex: 0,
    lastIndex: 0,
    start: 0,
    confidence: 0.99,
    ...over,
  });

  const names = (number: string, over = {}, options = {}) => {
    const resolved = resolveJersey(mention(number, over), index, options);
    return resolved.kind === "show" ? resolved.slots.map((slot) => slot.player.last_name) : resolved.kind;
  };

  it("shows everyone wearing the number when nothing narrows it", () => {
    expect(names("12")).toEqual(["Chen", "Patel"]);
  });

  it("narrows to a side on a team cue", () => {
    expect(names("12", { side: "A" })).toEqual(["Patel"]);
  });

  it("narrows a shared surname to the one wearing the number", () => {
    expect(names("23", { surname: "Williams", cue: "surname" })).toEqual(["Williams"]);
    expect(resolveJersey(mention("23", { surname: "Williams" }), index)).toMatchObject({
      slots: [{ player: { jersey: "23" } }],
    });
  });

  it("calls a surname and a number that disagree a conflict", () => {
    expect(names("23", { surname: "Smith", cue: "surname" })).toBe("conflict");
  });

  it("keeps 0 and 00 apart", () => {
    expect(names("0")).toEqual(["Ruiz"]);
    expect(names("00")).toEqual(["Nakamura"]);
  });

  it("shows the teen/ty partner, and only the number heard with the toggle off", () => {
    expect(names("15")).toEqual(["Torres", "Delgado"]);
    expect(names("15", {}, { teenTy: false })).toEqual(["Torres"]);
    expect(names("50", {}, { teenTy: false })).toEqual(["Delgado"]);
  });

  it("says when a number is on the other team", () => {
    expect(names("5", { side: "H" })).toBe("not_on_roster");
  });

  it("says when nobody wears it", () => {
    expect(names("45")).toBe("not_on_roster");
  });
});

describe("the parser and the rosters together", () => {
  it("leaves a lineman's number doing nothing, because linemen never reach the watchlist", () => {
    // Football rosters drop linemen before they are saved, so their numbers are
    // not in the index at all.
    const thin = buildGameWatchlist([player("55", "Bauer")], []).entries;
    const withoutLinemen = buildGameWatchlist([], []).entries;
    expect(buildJerseyIndex(thin).byJersey.has("55")).toBe(true);
    expect(buildJerseyIndex(withoutLinemen).byJersey.size).toBe(0);
  });

  it("puts the number and the cue word in the log, and nothing of the sentence", () => {
    const { rows } = say("eagles 12 at the line");
    const match = rows.find((row) => row.type === "match")!;
    expect(match.word).toBe("12");
    expect(match.cueWord).toBe("eagles");
    expect(match.cue).toBe("team");
    expect(JSON.stringify(rows)).not.toContain("line");
  });

  it("scores a number by what cued it", () => {
    expect(say("number 23").rows.find((row) => row.type === "match")?.score).toBe(1);
    expect(say("eagles 12").rows.find((row) => row.type === "match")?.score).toBe(0.9);
  });
});

describe("normalizeNumbers and parseJerseyMentions on this game", () => {
  it("reads a surname and a number said together", () => {
    const tokens = normalizeNumbers(words("chen number 12", 0));
    const { mentions } = parseJerseyMentions(tokens, context("basketball"), [
      { name: "Chen", firstIndex: 0, lastIndex: 0 },
    ], false);
    expect(mentions[0]).toMatchObject({ number: "12", surname: "Chen", cue: "explicit" });
  });
});

describe("the announcer says the card is wrong", () => {
  it("takes it down, puts back what it pushed off, and logs a row", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    engine.process(results("chen", 10, true), 1, 1000, 1);
    const second = engine.process(results("ortiz", 20, true), 1, 2000, 2);
    expect(shown(second)).toEqual(["Ortiz #9 H", "Chen #12 H"]);

    const wrong = engine.markNewestWrong(3);
    expect(shown(wrong)).toEqual(["Chen #12 H"]);
    expect(wrong.rows[0]).toMatchObject({ type: "wrong", name: "Ortiz", reason: "announcer_said_wrong" });
  });

  it("does nothing when the screen is empty", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    expect(engine.markNewestWrong(1)).toEqual({ rows: [] });
  });

  it("names what came off, for the flash on screen", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    engine.process(results("chen", 10, true), 1, 1000, 1);
    expect(engine.markNewestWrong(2).removed).toBe("Chen");
  });

  it("takes down the card in the slot a number key named, not the newest", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    engine.process(results("chen", 10, true), 1, 1000, 1);
    engine.process(results("ortiz", 20, true), 1, 20_000, 2);
    const third = engine.process(results("brooks", 30, true), 1, 40_000, 3);
    expect(shown(third)).toEqual(["Brooks #7 H", "Ortiz #9 H", "Chen #12 H"]);

    // 2 is the middle card. The newest stays where it is.
    const wrong = engine.markSlotWrong(1, 4);
    expect(shown(wrong)).toEqual(["Brooks #7 H", "Chen #12 H"]);
    expect(wrong.rows[0]).toMatchObject({ type: "wrong", name: "Ortiz", reason: "announcer_said_wrong" });
    expect(wrong.removed).toBe("Ortiz");
  });

  it("takes down both cards when one trigger put up two", () => {
    // "number 12" shows both twelves. Either of them being wrong means the
    // trigger was wrong, so both come off.
    const engine = new SpotterEngine(watchlist, context("basketball"));
    const both = engine.process(results("number 12", 10, true), 1, 1000, 1);
    expect(shown(both)).toEqual(["Chen #12 H", "Patel #12 A"]);
    expect(shown(engine.markSlotWrong(1, 2))).toEqual([]);
  });

  it("does nothing for a slot with no card in it", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    engine.process(results("chen", 10, true), 1, 1000, 1);
    expect(engine.markSlotWrong(2, 2)).toEqual({ rows: [] });
  });

  it("keeps the wrong card off screen when the same name is said again later", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    engine.process(results("chen", 10, true), 1, 1000, 1);
    engine.markNewestWrong(2);
    // Saying it again is a fresh match: the announcer marked one sighting wrong,
    // not the player.
    const again = engine.process(results("chen", 40, true), 1, 30_000, 3);
    expect(shown(again)).toEqual(["Chen #12 H"]);
  });
});

describe("a team name and a number, end to end", () => {
  // The cues the game menu would build for this game, not hand-written ones.
  const cues = buildTeamCues(
    { school: "Brentwood School", mascot: "Eagles", wearing: "white" },
    { school: "Crossroads", mascot: "Roadrunners", wearing: null },
  );
  const game = (transcript: string) => {
    const engine = new SpotterEngine(watchlist, { sport: "basketball", teamCues: cues });
    return shown(engine.process(results(transcript, 10, true), 1, 1000, 1));
  };

  it("takes the school name as the cue", () => {
    // Home is Brentwood in this fixture, so their 12 is Chen.
    expect(game("brentwood 12")).toEqual(["Chen #12 H"]);
    expect(game("brentwood school 12")).toEqual(["Chen #12 H"]);
  });

  it("takes the mascot, the possessive and the colour too", () => {
    expect(game("eagles 12")).toEqual(["Chen #12 H"]);
    expect(game("eagles' 12")).toEqual(["Chen #12 H"]);
    expect(game("white 12")).toEqual(["Chen #12 H"]);
  });

  it("puts the other team's number on the other side", () => {
    expect(game("crossroads 12")).toEqual(["Patel #12 A"]);
    expect(game("roadrunners 12")).toEqual(["Patel #12 A"]);
  });

  it("still shows both when nobody said which team", () => {
    expect(game("number 12")).toEqual(["Chen #12 H", "Patel #12 A"]);
  });

  it("works for a number only one side has", () => {
    expect(game("brentwood 23")).toEqual(["Williams #23 H"]);
  });
});

describe("what a correction says about itself", () => {
  const wrongOf = (transcript: string) => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    engine.process(results(transcript, 10, true), 1, 1000, 1);
    return engine.markNewestWrong(2).wrong;
  };

  it("describes a wrong number without naming the player or the number", () => {
    const wrong = wrongOf("number 23");
    expect(wrong).toMatchObject({ kind: "number", cue: "explicit", cards: 1, digits: 2, sound: false });
    // The shape, and nothing that says who: no surname, no jersey.
    expect(JSON.stringify(wrong)).not.toContain("Williams");
    expect(JSON.stringify(wrong)).not.toContain("23");
  });

  it("tells a wrong name from a wrong number", () => {
    expect(wrongOf("chen")).toMatchObject({ kind: "name", cue: null, digits: null });
  });

  it("counts the cards a bad trigger put up, which is how ambiguous it was", () => {
    expect(wrongOf("number 12")).toMatchObject({ cards: 2 });
  });

  it("carries a denominator, so corrections can be read as a rate", () => {
    const engine = new SpotterEngine(watchlist, context("basketball"));
    engine.process(results("chen", 10, true), 1, 1000, 1);
    engine.process(results("ortiz", 20, true), 1, 20_000, 2);
    expect(engine.markNewestWrong(3).wrong).toMatchObject({ matchesBefore: 1 });
  });
});
