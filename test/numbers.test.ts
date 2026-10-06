import { describe, expect, it } from "vitest";
import type { DeepgramWord } from "@/lib/deepgram/config";
import { compileJerseySounds, jerseyFromSound } from "@/lib/matching/jerseySound";
import { normalizeNumbers, parseJerseyMentions, type NumberContext, type SurnameSpan } from "@/lib/matching/numbers";
import type { Sport } from "@/lib/rosters/types";

// Token shapes are what Deepgram really returns for this request: nova-3 with
// numerals on, smart_format and punctuate off. Checked against both the live
// socket and the pre-recorded endpoint on 2026-09-17, which is why "half" is
// "0.5", "third" is "3rd", and a score arrives as two plain numbers rather than
// as "14-12".
function words(transcript: string, confidence = 0.99): DeepgramWord[] {
  return transcript.split(/\s+/).map((word, index) => ({
    word,
    start: index * 0.3,
    end: index * 0.3 + 0.25,
    confidence,
  }));
}

const texts = (transcript: string) => normalizeNumbers(words(transcript)).map((token) => token.text);

describe("normalizeNumbers", () => {
  const cases: Array<[string, string[]]> = [
    // Deepgram's numerals already did the work.
    ["number 23 drives baseline", ["number", "23", "drives", "baseline"]],
    // Split across results, which is how it comes back when numerals does not.
    ["number twenty three", ["number", "23"]],
    ["number twenty-three", ["number", "23"]],
    // Digits joined only behind a cue.
    ["number one two", ["number", "12"]],
    ["number 1 2", ["number", "12"]],
    ["number one-two", ["number", "12"]],
    ["a one two punch", ["a", "1", "2", "punch"]],
    // Zeroes.
    ["number double zero", ["number", "00"]],
    ["number double 0", ["number", "00"]],
    ["number zero zero", ["number", "00"]],
    ["number oh", ["number", "0"]],
    ["oh no", ["oh", "no"]],
    // Shapes that are never a jersey.
    ["2 30 left in the 0.5", ["2", "30", "left", "in", "the", "0.5"]],
    ["late in the 3rd 0.25", ["late", "in", "the", "3rd", "0.25"]],
    ["they lead 14-12", ["they", "lead", "14-12"]],
    // "#23" carries its own cue.
    ["#23 shoots", ["number", "23", "shoots"]],
  ];

  for (const [transcript, expected] of cases) {
    it(`reads "${transcript}"`, () => {
      expect(texts(transcript)).toEqual(expected);
    });
  }

  it("keeps the Deepgram word a token came from, so a log row points at the right words", () => {
    const tokens = normalizeNumbers(words("williams number twenty three shoots"));
    const number = tokens.find((token) => token.text === "23")!;
    expect([number.firstIndex, number.lastIndex]).toEqual([2, 3]);
    expect(tokens[tokens.length - 1].firstIndex).toBe(4);
  });
});

// -----------------------------------------------------------------------------

const EAGLES: NumberContext = {
  sport: "basketball",
  teamCues: [
    { words: ["eagles"], side: "H" },
    { words: ["eagle"], side: "H" },
    { words: ["white"], side: "H" },
    { words: ["crossroads"], side: "A" },
  ],
};

const context = (sport: Sport | null): NumberContext => ({ ...EAGLES, sport });

function parse(transcript: string, sport: Sport | null = "basketball", surnames: SurnameSpan[] = []) {
  return parseJerseyMentions(normalizeNumbers(words(transcript)), context(sport), surnames, false);
}

/** A surname match, as the matcher reports it: an index into the Deepgram words. */
const span = (name: string, index: number): SurnameSpan => ({ name, firstIndex: index, lastIndex: index });

describe("parseJerseyMentions: what cues a number", () => {
  it("fires on an explicit cue", () => {
    const { mentions } = parse("number 23 drives baseline");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ number: "23", cue: "explicit", cueWord: "number", side: null });
  });

  it("fires on a surname beside the number, either side of it", () => {
    expect(parse("23 smith", null, [span("Smith", 1)]).mentions[0]).toMatchObject({
      number: "23",
      cue: "surname",
      surname: "Smith",
    });
    expect(parse("smith number 23", null, [span("Smith", 0)]).mentions[0]).toMatchObject({
      number: "23",
      cue: "explicit",
      surname: "Smith",
    });
  });

  it("fires on a team name and takes the side from it", () => {
    expect(parse("eagles 12 at the line").mentions[0]).toMatchObject({ number: "12", cue: "team", side: "H" });
    expect(parse("crossroads 12").mentions[0]).toMatchObject({ number: "12", cue: "team", side: "A" });
    expect(parse("white 25").mentions[0]).toMatchObject({ number: "25", cue: "team", side: "H" });
  });

  // docs/V3_DEFINITION.md 7.3. Sept 25: "Estancia 0" was the score, and put up Wright #0.
  it("never fires a single digit on a team name alone, and says why", () => {
    for (const transcript of ["white 5", "eagles 0", "crossroads 9 at the line"]) {
      const { mentions, vetoed } = parse(transcript);
      expect(mentions, transcript).toEqual([]);
      expect(vetoed[0], transcript).toMatchObject({ reason: "single_digit_team_cue" });
    }
    expect(parse("white 5").vetoed[0]).toMatchObject({ number: "5", cueWord: "white" });
  });

  it("still fires a single digit with an explicit cue, with or without a team", () => {
    for (const transcript of ["number 5", "white number 5", "eagles jersey 0", "wearing 7", "#5", "numero 3"]) {
      expect(parse(transcript).mentions[0], transcript).toMatchObject({ cue: "explicit" });
    }
    expect(parse("white number 5").mentions[0]).toMatchObject({ number: "5", side: "H" });
  });

  it("still fires a single digit with a surname right beside it", () => {
    expect(parse("smith 5", null, [span("Smith", 0)]).mentions[0]).toMatchObject({ number: "5", cue: "surname" });
    // A team in front as well does not take the surname's cue away.
    expect(parse("white smith 5", null, [span("Smith", 1)]).mentions[0]).toMatchObject({ number: "5", cue: "surname" });
  });

  it("leaves two-digit numbers alone: a team name is still enough", () => {
    expect(parse("white 21").mentions[0]).toMatchObject({ number: "21", cue: "team" });
    expect(parse("white 00").mentions[0]).toMatchObject({ number: "00", cue: "team" });
  });

  it("a bare single digit is still just no_cue, not the team reason", () => {
    expect(parse("5 shoots").vetoed[0]).toMatchObject({ reason: "no_cue" });
  });

  it("never fires on a bare number", () => {
    const { mentions, vetoed } = parse("12 shoots");
    expect(mentions).toEqual([]);
    expect(vetoed[0]).toMatchObject({ number: "12", reason: "no_cue" });
  });

  it("spends a cue on one number only", () => {
    const { mentions, vetoed } = parse("number 12 with 20 points");
    expect(mentions.map((m) => m.number)).toEqual(["12"]);
    expect(vetoed.map((v) => [v.number, v.reason])).toEqual([["20", "veto:stat"]]);
  });

  it("spends a surname on one number only", () => {
    const { mentions } = parse("smith 23 and 41", null, [span("Smith", 0)]);
    expect(mentions.filter((m) => m.surname === "Smith")).toHaveLength(1);
  });

  it("does not read a team name as a surname standing next to a number", () => {
    // A school called after a bird, and a player called Eagle.
    const { mentions } = parse("eagles 12", "basketball", [span("Eagles", 0)]);
    expect(mentions[0]).toMatchObject({ cue: "team", side: "H", surname: null });
  });

  it("holds a number below the confidence floor", () => {
    const tokens = normalizeNumbers(words("number 23", 0.4));
    const { mentions, vetoed } = parseJerseyMentions(tokens, EAGLES, [], false);
    expect(mentions).toEqual([]);
    expect(vetoed[0].reason).toBe("low_confidence");
  });
});

describe("parseJerseyMentions: vetoes", () => {
  const cases: Array<[Sport | null, string, string[], string[]]> = [
    // [sport, transcript, numbers that fire, reasons for the rest]
    [null, "they lead 14 to 12", [], ["veto:score", "veto:score"]],
    [null, "the score is 14 12", [], ["veto:score", "veto:score"]],
    [null, "they lead 14-12", [], ["veto:score"]],
    [null, "up 7 with a minute to go", [], ["veto:margin"]],
    [null, "number 23 by 3", ["23"], ["veto:margin"]],
    [null, "2 30 left in the 0.5", [], ["veto:clock", "veto:clock", "veto:decimal"]],
    [null, "with 30 to go", [], ["veto:clock"]],
    [null, "number 12 for 20 seconds", ["12"], ["veto:stat"]],
    [null, "the number 1 team in the state", [], ["veto:rank"]],
    ["basketball", "and 1", [], ["veto:and_one"]],
    ["basketball", "number 23 for 3", ["23"], ["veto:shot_value"]],
    ["basketball", "number 23 from 3", ["23"], ["veto:shot_value"]],
    ["basketball", "12 on the shot clock", [], ["veto:shot_clock"]],
    ["basketball", "number 12 with 7 fouls", ["12"], ["veto:stat"]],
    ["football", "3rd and 7 at the 35", [], ["veto:down_distance", "veto:field_position"]],
    ["football", "number 7 to the 20 yard line", ["7"], ["veto:stat"]],
    ["football", "a gain of 12", [], ["veto:gain_loss"]],
    ["football", "on their own 40", [], ["veto:field_position"]],
    ["volleyball", "serving a 20 to 18", [], ["veto:score", "veto:score"]],
    ["volleyball", "set 2 is under way", [], ["veto:set"]],
    ["baseball", "2 and 1 count to number 9", ["9"], ["veto:count", "veto:count"]],
    ["baseball", "full count 3 2", [], ["veto:count", "veto:count"]],
    ["baseball", "2 outs in the 7th", [], ["veto:stat"]],
    ["softball", "runners on with 2 out", [], ["veto:count"]],
  ];

  for (const [sport, transcript, fires, reasons] of cases) {
    it(`${sport ?? "any sport"}: "${transcript}"`, () => {
      const { mentions, vetoed } = parse(transcript, sport);
      expect(mentions.map((m) => m.number)).toEqual(fires);
      expect(vetoed.map((v) => v.reason)).toEqual(reasons);
    });
  }

  it("vetoes a number even when it is cued", () => {
    const { mentions, vetoed } = parse("number 14 to 12", null);
    expect(mentions).toEqual([]);
    expect(vetoed[0]).toMatchObject({ reason: "veto:score", cueWord: "number" });
  });
});

describe("parseJerseyMentions: interim results", () => {
  // Tonight: a 23 and a 5, so "20" could still be on its way to "23" and "5"
  // could still be on its way to nothing.
  const JERSEYS = new Set(["23", "5", "12"]);
  const interim = (transcript: string, jerseys: Set<string> | null = JERSEYS) =>
    parseJerseyMentions(normalizeNumbers(words(transcript)), { ...EAGLES, jerseys: jerseys ?? undefined }, [], true);

  it("waits on a number that could still grow into one of tonight's jerseys", () => {
    // "twenty" lands as "20" a beat before "twenty three" lands as "23".
    expect(interim("number 20").mentions).toEqual([]);
    expect(interim("number 20 drives").mentions.map((m) => m.number)).toEqual(["20"]);
  });

  it("fires at once on a number that cannot grow, rather than making the announcer wait", () => {
    // Nothing on either roster starts with 23 and is longer, so waiting for the
    // next word would buy nothing and cost about a second.
    expect(interim("number 23").mentions.map((m) => m.number)).toEqual(["23"]);
    expect(interim("number 5").mentions.map((m) => m.number)).toEqual(["5"]);
  });

  it("waits on a single digit while a longer jersey starts with it", () => {
    expect(interim("number 1", new Set(["12"])).mentions).toEqual([]);
    expect(interim("number 1", new Set(["23"])).mentions.map((m) => m.number)).toEqual(["1"]);
  });

  it("waits on everything when it does not know the rosters", () => {
    expect(interim("number 23", null).mentions).toEqual([]);
  });

  it("does not fire on a cue that is the last word of an interim", () => {
    expect(interim("williams number").mentions).toEqual([]);
  });

  it("makes only a team cue wait in front of a word that could begin a score", () => {
    expect(interim("eagles 12 to").mentions).toEqual([]);
    expect(interim("number 12 to").mentions.map((m) => m.number)).toEqual(["12"]);
    expect(interim("eagles 12 at the line").mentions.map((m) => m.number)).toEqual(["12"]);
  });

  it("holds a number back rather than turning it away, so the final still sees it", () => {
    expect(interim("number 20").vetoed).toEqual([]);
  });
});

// -----------------------------------------------------------------------------

describe("numbers heard as words", () => {
  // Tonight: 23, 32, 15 and 7. Scored the way the engine scores them.
  const sounds = compileJerseySounds(["23", "32", "15", "7"]);
  const heard = (transcript: string) =>
    parseJerseyMentions(
      normalizeNumbers(words(transcript)),
      { ...EAGLES, jerseys: new Set(["23", "32", "15", "7"]), hearJersey: (text) => jerseyFromSound(text, sounds) },
      [],
      false,
    ).mentions;

  it("hears a number Deepgram never turned into one", () => {
    // "twenty three" misheard as "twenty tree" arrives as a 20 and a word.
    expect(heard("number twenty tree")[0]).toMatchObject({ number: "23", cue: "explicit" });
    expect(heard("number thurty two")[0]).toMatchObject({ number: "32" });
    expect(heard("number sevin")[0]).toMatchObject({ number: "7" });
  });

  it("logs the words that scored, so the row says why it fired", () => {
    expect(heard("number twenty tree")[0].heard).toMatchObject({ word: "twenty tree" });
  });

  it("leaves ordinary words alone", () => {
    expect(heard("number twenty feet")).toEqual([]);
    expect(heard("number of times")).toEqual([]);
    expect(heard("number to the line")).toEqual([]);
    // Measured at 0.82 against 14, the closest any ordinary phrase came.
    expect(heard("number for the win")).toEqual([]);
  });

  it("does not second-guess a number that already read cleanly", () => {
    const mentions = heard("number 23");
    expect(mentions).toHaveLength(1);
    expect(mentions[0].heard).toBeUndefined();
  });

  it("needs the word number: a surname next to an ordinary word is not a jersey", () => {
    expect(heard("williams twenty free")).toEqual([]);
  });
});
