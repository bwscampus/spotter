import type { DeepgramWord } from "@/lib/deepgram/config";
import { jerseyAsSpoken } from "@/lib/rosters/jerseyForms";
import type { Sport } from "@/lib/rosters/types";
import { MAX_JERSEY_WORDS } from "./jerseySound";

// =============================================================================
// TUNING: every word list and window that decides whether a spoken number is a
// jersey number.
//
// A bare number never fires. Announcers say numbers constantly for other
// reasons, so a number reaches the screen only when something next to it says
// it is a player: the word "number", a surname, or a team. Everything else in
// here is the other half of that bargain, the contexts that say a number is a
// score, a clock, a down, a count or a stat, and those veto a number even when
// a cue is sitting next to it.
//
// Before changing a list, export the CSV and read the near_miss rows: their
// reason column says which rule turned a number away.
// =============================================================================

/**
 * How far from a surname a number can sit and still be that player's.
 *
 * 1 means immediately next to it, counting neither the word "number" nor
 * punctuation. "Smith 23", "Smith, number 23" and "23 Smith" all qualify.
 * Widening this looks tempting and is wrong: at 2, "Smith finds number 23"
 * reads as a Smith/23 conflict and hides the real number 23.
 */
export const NUMBER_SURNAME_WINDOW = 1;

/** Deepgram confidence a number token needs. Numbers are short, so this sits above the matcher's floor for names. */
export const NUMBER_MIN_CONFIDENCE = 0.6;

/** Words that say the next number is a jersey, whatever else is around it. "#5" reads as "number 5" (see tokensFor). */
const EXPLICIT_CUES = new Set(["number", "numero", "wearing", "jersey"]);

/**
 * A jersey with fewer digits than this never fires on a team cue alone. With 2,
 * jerseys 0 to 9 need "number" (or another explicit cue) or a surname right beside
 * them; a team name in front is not enough, and the number is logged as a near
 * miss with the reason "single_digit_team_cue". Two-digit jerseys are unchanged.
 *
 * Why: on Sept 25 "Estancia 0" put up Wright #0 five times, and four were wrong.
 * Announcers say a school name and then a one-digit number for the score, the
 * down, the quarter and the count far more often than for a player. Set it to 1
 * to turn the rule off.
 */
export const TEAM_CUE_MIN_DIGITS = 2;

/** Longest jersey Spotter will build out of separate spoken digits ("one two" is 12, never 1-2-?). */
const MAX_JOINED_DIGITS = 2;

// -----------------------------------------------------------------------------
// Vetoes. Each returns a reason that reaches the log as "veto:<reason>".
// -----------------------------------------------------------------------------

/** A number followed by one of these is a quantity, not a player. */
const STAT_UNITS = new Set([
  "points", "point", "pts", "rebounds", "rebound", "boards", "assists", "assist",
  "yards", "yard", "yds", "seconds", "second", "minutes", "minute", "percent",
  "feet", "foot", "inches", "inch", "times", "steals", "blocks", "turnovers",
]);

/** Per sport, on top of STAT_UNITS. Keyed by the sport values the rosters already use. */
const SPORT_UNITS: Partial<Record<Sport, string[]>> = {
  basketball: ["fouls", "foul", "timeouts", "timeout", "pointer", "pointers", "threes", "twos"],
  football: ["touchdowns", "touchdown", "carries", "catches", "receptions", "tackles", "sacks", "interceptions"],
  volleyball: ["kills", "kill", "aces", "ace", "digs", "dig", "errors"],
  baseball: ["outs", "innings", "inning", "rbi", "rbis", "strikeouts", "strikes", "balls", "pitches", "walks", "runs"],
  softball: ["outs", "innings", "inning", "rbi", "rbis", "strikeouts", "strikes", "balls", "pitches", "walks", "runs"],
};

/** A number just after one of these is half of a score. */
const SCORE_WORDS = new Set(["lead", "leads", "leading", "led", "trail", "trails", "trailing", "score", "scores", "tied", "tie", "ties", "win", "wins", "won", "beat"]);

/** Skipped when looking back for a score word: "the score is 14 12", "tied at 20". */
const SCORE_FILLERS = new Set(["is", "at", "it", "now", "still", "the", "by"]);

/** A number just after one of these is a margin. */
const MARGIN_WORDS = new Set(["up", "down", "by", "ahead", "behind"]);

/** A number just before one of these is a clock. */
const CLOCK_AFTER = new Set(["left", "remaining"]);

/** Words that turn "the number" into a ranking rather than a jersey. */
const RANK_WORDS = new Set(["team", "seed", "seeded", "ranked", "ranking", "pick", "option", "priority", "choice", "overall", "spot"]);
const RANK_PLACES = new Set(["state", "country", "nation", "league", "conference", "division", "region", "section", "county", "world"]);

/** Football: "at the 35", "own 40", "their 30". */
const FIELD_OWNERS = new Set(["own", "their", "our", "opponents", "opponent"]);
const FIELD_PREPOSITIONS = new Set(["at", "to", "inside", "from", "on", "past", "near", "across", "beyond", "around", "reaches", "reached"]);

/** Football: "a gain of 6", "a loss of 3". */
const GAIN_LOSS_WORDS = new Set(["gain", "gains", "gained", "loss", "lose", "loses", "lost"]);

/** Basketball: "for 3", "from 3" are what a shot is worth. Only the shot values, so "from 23" stays a player. */
const SHOT_VALUE_WORDS = new Set(["for", "from"]);
const SHOT_VALUES = new Set(["1", "2", "3"]);

/** Volleyball: "set 2", "serving at 20". */
const SET_WORDS = new Set(["set", "sets", "game", "match"]);
const SERVE_WORDS = new Set(["serve", "serves", "serving", "server"]);

/** Baseball and softball: "2 and 1", "full count", "2 outs", "runners on". */
const COUNT_MAX = 4;
const RUNNER_WORDS = new Set(["runners", "runner", "men", "aboard", "on"]);

/** Ordinals are never jerseys: "3rd and 7", "third quarter". */
const ORDINAL_WORDS = new Set(["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"]);

/**
 * Words that can begin a veto. A team-cued number sitting in front of one at
 * the end of an interim waits for the next word, because "Eagles 12 to..." is
 * very often "Eagles 12 to 10". Only team cues wait: they are the weakest of
 * the three, and waiting costs about a second, measured against the live socket.
 */
const INTERIM_HOLD_WORDS = new Set(["to", "and", "of", "for", "from", "with", "point", "the"]);

// -----------------------------------------------------------------------------
// Spoken numbers. Deepgram's numerals option returns "23" for "twenty three",
// but the words below still arrive when it splits a number across results, and
// "oh" and "double" are never numerals.
// -----------------------------------------------------------------------------

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Said for zero, and only a zero directly after a cue: "number oh two". */
const OH_WORDS = new Set(["oh", "o"]);

/** "double zero" is 00. */
const DOUBLE_WORDS = new Set(["double"]);

// =============================================================================

/** What a number token looks like. Only "integer" can ever be a jersey. */
export type NumberShape = "integer" | "decimal" | "clock" | "pair";

/** Why a number reached the screen. */
export type NumberCue = "explicit" | "surname" | "team";

export interface Token {
  kind: "word" | "number";
  /** A word, lowercased and stripped to letters. A number's digits, as spoken: "0" and "00" differ. */
  text: string;
  shape?: NumberShape;
  /** Index range in the Deepgram words this came from, so a log row points at the right words. */
  firstIndex: number;
  lastIndex: number;
  start: number;
  confidence: number;
}

/** One team's cue phrases, already normalized and split into words. */
export interface TeamCue {
  words: string[];
  side: "H" | "A";
}

/** Where a surname matched, in Deepgram word indices. */
export interface SurnameSpan {
  /** The watchlist entry's name, which is how the engine identifies it. */
  name: string;
  firstIndex: number;
  lastIndex: number;
}

export interface JerseyMention {
  /** The jersey as spoken. A string: "0" and "00" are different players. */
  number: string;
  cue: NumberCue;
  /**
   * Set when the number was heard as words rather than read as digits, with the
   * words that scored and how well. "number twenty free" is 23 at 0.94.
   */
  heard?: { word: string; score: number };
  /** The word that cued it: "number", a team name, or the surname. */
  cueWord: string;
  /** Set when a team cue named a side. */
  side: "H" | "A" | null;
  /** Set when a surname sat next to the number. The watchlist entry's name. */
  surname: string | null;
  firstIndex: number;
  lastIndex: number;
  start: number;
  confidence: number;
}

export interface VetoedNumber {
  number: string;
  /** "veto:score", "no_cue", "low_confidence". */
  reason: string;
  cueWord: string | null;
  firstIndex: number;
  lastIndex: number;
  start: number;
  confidence: number;
}

export interface NumberScan {
  mentions: JerseyMention[];
  vetoed: VetoedNumber[];
}

export interface NumberContext {
  sport: Sport | null;
  teamCues: TeamCue[];
  /**
   * Every jersey on tonight's two rosters. Used only to decide whether a number
   * at the end of an interim result might still be growing into a different
   * one, which is the only reason to make an announcer wait.
   */
  jerseys?: Set<string>;
  /**
   * Scores a run of words against how tonight's numbers are said, for the times
   * Deepgram never turned them into a number: "number twenty free". Supplied by
   * the engine, so this file stays pure and knows nothing about rosters.
   */
  hearJersey?: (text: string) => { jersey: string; score: number } | null;
}

/**
 * Could this number still turn into a different jersey if another syllable
 * arrives?
 *
 * Interim results arrive a word at a time, so "twenty" lands as "20" a beat
 * before "twenty three" lands as "23". That is the one case worth waiting for,
 * and it is worth waiting for only when the longer number is on a roster:
 * holding every number instead costs a second on the common case, and with a
 * pause after the number it costs until Deepgram ends the utterance. Both were
 * measured against the live socket, 2026-09-17.
 */
export function couldGrow(value: string, jerseys: Set<string> | undefined): boolean {
  if (!jerseys) return true;
  // "2" is still on its way to "23"; "0" to "00".
  for (const jersey of jerseys) {
    if (jersey.length > value.length && jersey.startsWith(value)) return true;
  }
  // "twenty" is "20" until the "three" lands.
  if (/^[2-9]0$/.test(value)) {
    const tens = Number(value);
    for (let ones = 1; ones <= 9; ones++) if (jerseys.has(String(tens + ones))) return true;
  }
  return false;
}

/** Letters only, lowercased, accents folded, possessive dropped: "Eagles'" is "eagles". */
function plain(word: string): string {
  return word
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]s$/, "")
    .replace(/[^a-z]/g, "");
}

function digitsOf(value: number): string {
  return String(value);
}

/**
 * Turns one Deepgram result's words into words and numbers.
 *
 * Deepgram is asked for numerals, so "twenty three" normally arrives as one
 * "23" token. This still handles the spoken forms, because a number split
 * across two results comes back as words, and because "oh" and "double" are
 * never numerals. Token indices point back at the Deepgram words they came
 * from, so a log row and a near miss name the right words.
 */
export function normalizeNumbers(words: DeepgramWord[]): Token[] {
  const raw: Token[] = [];

  words.forEach((word, index) => {
    const base = { firstIndex: index, lastIndex: index, start: word.start, confidence: word.confidence };
    // "No. 23" only reads as a cue when Deepgram punctuated it; with punctuation
    // off, "no" stays the ordinary word.
    if (word.punctuated_word === "No." || word.punctuated_word === "no.") {
      raw.push({ kind: "word", text: "number", ...base });
      return;
    }

    // A hyphen joins either a score ("14-12") or a spoken number ("twenty-three").
    const pieces = word.word.split(/[-–]/).filter((piece) => piece.trim().length > 0);
    if (pieces.length === 2 && pieces.every((piece) => /^\d+$/.test(piece.trim()))) {
      raw.push({ kind: "number", text: pieces.map((piece) => piece.trim()).join("-"), shape: "pair", ...base });
      return;
    }
    for (const piece of pieces) raw.push(...tokensFor(piece.trim(), base));
  });

  return join(raw);
}

function tokensFor(text: string, base: Omit<Token, "kind" | "text">): Token[] {
  const lower = text.toLowerCase();
  const number = (value: string, shape: NumberShape): Token[] => [{ kind: "number", text: value, shape, ...base }];

  // "#23" carries its own cue, so it reads exactly like "number 23".
  const hashed = /^#(\d+)$/.exec(lower);
  if (hashed) return [{ kind: "word", text: "number", ...base }, ...number(hashed[1], "integer")];

  if (/^\d+$/.test(lower)) return number(lower, "integer");
  if (/^\d*\.\d+$/.test(lower)) return number(lower, "decimal");
  if (/^\d{1,2}:\d{2}$/.test(lower)) return number(lower, "clock");

  // Ordinals stay words. "3rd" is a down, never a jersey.
  if (/^\d+(st|nd|rd|th)$/.test(lower)) return [{ kind: "word", text: lower, ...base }];

  const word = plain(text);
  if (!word) return [];
  if (word in TEENS) return number(digitsOf(TEENS[word]), "integer");
  if (word in ONES) return number(digitsOf(ONES[word]), "integer");
  if (word in TENS) return number(digitsOf(TENS[word]), "integer");
  return [{ kind: "word", text: word, ...base }];
}

/** True for a token that came from a spelled tens word, which is what "twenty three" joins from. */
const isTensValue = (token: Token) => token.kind === "number" && /^[2-9]0$/.test(token.text);
const isSingleDigit = (token: Token) => token.kind === "number" && /^\d$/.test(token.text);

function merge(a: Token, b: Token, text: string): Token {
  return {
    kind: "number",
    text,
    shape: "integer",
    firstIndex: a.firstIndex,
    lastIndex: b.lastIndex,
    start: a.start,
    confidence: Math.min(a.confidence, b.confidence),
  };
}

/**
 * Joins the runs that make one number out of several tokens.
 *
 * "twenty three" joins anywhere, because it is one number however it is said.
 * Everything else joins only after a cue, so "a one two punch" stays three
 * words while "number one two" is 12.
 */
function join(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let cued = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    if (token.kind === "word" && EXPLICIT_CUES.has(token.text)) {
      cued = true;
      out.push(token);
      continue;
    }

    // "double zero" is 00 wherever it is said; "double one" needs a cue, because
    // basketball has double doubles and doubles down the line.
    if (token.kind === "word" && DOUBLE_WORDS.has(token.text) && next) {
      const digit = isSingleDigit(next) ? next.text : OH_WORDS.has(next.text) ? "0" : null;
      if (digit !== null && (digit === "0" || cued)) {
        out.push(merge(token, next, digit + digit));
        i++;
        cued = false;
        continue;
      }
    }

    if (token.kind === "word" && OH_WORDS.has(token.text) && cued) {
      // "oh" is a zero only right after a cue: "number oh two".
      out.push({ ...token, kind: "number", text: "0", shape: "integer" });
      continue;
    }

    if (token.kind === "number" && token.shape === "integer" && next) {
      // "twenty three", however Deepgram split it.
      if (isTensValue(token) && isSingleDigit(next) && next.text !== "0") {
        out.push(merge(token, next, digitsOf(Number(token.text) + Number(next.text))));
        i++;
        cued = false;
        continue;
      }
      // "number one two" and "number zero zero", up to two digits.
      if (cued && isSingleDigit(token) && isSingleDigit(next)) {
        out.push(merge(token, next, (token.text + next.text).slice(0, MAX_JOINED_DIGITS)));
        i++;
        cued = false;
        continue;
      }
    }

    out.push(token);
    cued = false;
  }

  return out;
}

const isOrdinal = (text: string | null) =>
  text !== null && (ORDINAL_WORDS.has(text) || /^\d+(st|nd|rd|th)$/.test(text));

/**
 * Why this number is not a jersey, or null when nothing says so.
 *
 * A cue does not rescue a number from a veto: "number 12 with 20 points" fires
 * 12 and turns 20 away. Rules are checked cheapest first.
 */
export function vetoFor(tokens: Token[], at: number, sport: Sport | null): string | null {
  const token = tokens[at];
  if (token.kind !== "number") return null;
  if (token.shape === "decimal") return "decimal";
  if (token.shape === "clock") return "clock";

  const word = (offset: number): string | null => {
    const other = tokens[at + offset];
    return other && other.kind === "word" ? other.text : null;
  };
  const number = (offset: number): Token | null => {
    const other = tokens[at + offset];
    return other && other.kind === "number" && other.shape === "integer" ? other : null;
  };
  const value = Number(token.text);
  const followedBy = (set: Set<string>) => {
    const next = word(1);
    return next !== null && set.has(next);
  };

  const baseball = sport === "baseball" || sport === "softball";
  if (token.shape === "pair") return baseball ? "count" : "score";

  // Stats and quantities.
  if (followedBy(STAT_UNITS)) return "stat";
  const units = sport ? SPORT_UNITS[sport] : undefined;
  if (units && followedBy(new Set(units))) return "stat";

  // Clocks. "2 30 left in the half", "with 30 to go", "on the clock".
  const pairAfter = number(1);
  const pairBefore = number(-1);
  const clockish = (other: Token | null) => other !== null && /^\d{2}$/.test(other.text) && Number(other.text) < 60;
  if (pairAfter && clockish(pairAfter) && word(2) !== null && CLOCK_AFTER.has(word(2)!)) return "clock";
  if (pairBefore && clockish(token) && followedBy(CLOCK_AFTER)) return "clock";
  if (word(-1) === "with" && (followedBy(CLOCK_AFTER) || (word(1) === "to" && word(2) === "go"))) return "clock";
  if (word(1) === "on" && word(2) === "the" && word(3) === "clock") return "clock";

  // Scores. "14 to 12", "the score is 14 12", "they lead 14".
  if (word(1) === "to" && number(2)) return "score";
  if (word(-1) === "to" && number(-2)) return "score";
  for (let back = 1; back <= 3; back++) {
    const previous = word(-back);
    if (previous === null) break;
    if (SCORE_WORDS.has(previous)) return "score";
    if (!SCORE_FILLERS.has(previous)) break;
  }

  // Margins. "up 7", "down 3", "lead by 3".
  const before = word(-1);
  if (before !== null && MARGIN_WORDS.has(before)) return "margin";

  // "the number one team in the state".
  if (followedBy(RANK_WORDS)) return "rank";
  if (word(1) === "in" && word(2) === "the" && word(3) !== null && RANK_PLACES.has(word(3)!)) return "rank";

  const sportVeto = sportVetoFor(tokens, at, sport, { word, number, value, baseball });
  if (sportVeto) return sportVeto;

  // Two bare numbers in a row are a score anywhere else.
  if (pairAfter || pairBefore) return baseball ? "count" : "score";

  return null;
}

interface VetoHelpers {
  word: (offset: number) => string | null;
  number: (offset: number) => Token | null;
  value: number;
  baseball: boolean;
}

/**
 * The vetoes that only make sense in one sport. Sports without their own rules
 * (soccer, water polo, lacrosse, other) keep the generic ones.
 *
 * TODO: soccer, water polo and lacrosse have their own number habits (a scoreline
 * read as "nil nil", "in the 35th minute"). Add them when a game turns one up.
 */
function sportVetoFor(
  tokens: Token[],
  at: number,
  sport: Sport | null,
  { word, number, value, baseball }: VetoHelpers,
): string | null {
  const token = tokens[at];

  if (sport === "football") {
    // "third and 7", "4th and 2".
    if (word(-1) === "and" && (isOrdinal(word(-2)) || word(-2) === "down")) return "down_distance";
    // "at the 35", "own 40", "their 30".
    const owner = word(-1);
    if (owner !== null && FIELD_OWNERS.has(owner)) return "field_position";
    if (owner === "the" && word(-2) !== null && FIELD_PREPOSITIONS.has(word(-2)!)) return "field_position";
    // "a gain of 6", "a loss of 3".
    if (word(-1) === "of" && word(-2) !== null && GAIN_LOSS_WORDS.has(word(-2)!)) return "gain_loss";
    if (word(-1) !== null && GAIN_LOSS_WORDS.has(word(-1)!)) return "gain_loss";
  }

  if (sport === "basketball") {
    // "shot clock" on either side of the number.
    for (let offset = -3; offset <= 3; offset++) {
      const here = tokens[at + offset];
      const after = tokens[at + offset + 1];
      if (here?.kind === "word" && here.text === "shot" && after?.kind === "word" && after.text === "clock") {
        return "shot_clock";
      }
    }
    // "for 3", "from 3": what the shot is worth, not who took it.
    const before = word(-1);
    if (before !== null && SHOT_VALUE_WORDS.has(before) && SHOT_VALUES.has(token.text)) return "shot_value";
    // "and 1", and the one-and-one.
    if (before === "and" && token.text === "1") return "and_one";
    if (token.text === "1" && word(1) === "and" && number(2)?.text === "1") return "bonus";
    if (word(1) === "bonus") return "bonus";
  }

  if (sport === "volleyball") {
    const before = word(-1);
    if (before !== null && SET_WORDS.has(before)) return "set";
    if (before !== null && SERVE_WORDS.has(before)) return "score";
    // Deepgram hears "serving at 20" as "serving a 20".
    if ((before === "at" || before === "a") && word(-2) !== null && SERVE_WORDS.has(word(-2)!)) return "score";
  }

  if (baseball) {
    // Counts: "2 and 1", "3 2", "full count".
    const after = number(2);
    const previous = number(-2);
    if (word(1) === "and" && after && value <= COUNT_MAX && Number(after.text) <= COUNT_MAX) return "count";
    if (word(-1) === "and" && previous && value <= COUNT_MAX && Number(previous.text) <= COUNT_MAX) return "count";
    for (let offset = -3; offset <= 1; offset++) {
      const here = tokens[at + offset];
      const next = tokens[at + offset + 1];
      if (here?.kind === "word" && here.text === "full" && next?.kind === "word" && next.text === "count") {
        return "count";
      }
    }
    if (word(1) === "out" && value <= 2) return "count";
    const next = word(1);
    if (next !== null && RUNNER_WORDS.has(next) && value <= 3) return "runners";
  }

  return null;
}

/** Tokens that do not count towards the distance between a surname and its number. */
const isSkippable = (token: Token) => token.kind === "word" && EXPLICIT_CUES.has(token.text);

/**
 * Reads one result's tokens and returns the jersey numbers someone actually
 * said, plus the numbers that were turned away and why.
 *
 * Pure, and the heart of number spotting: every rule about what a number means
 * lives here or in the TUNING block above. The engine only resolves the answers
 * against the rosters.
 */
export function parseJerseyMentions(
  tokens: Token[],
  { sport, teamCues, jerseys, hearJersey }: NumberContext,
  surnames: SurnameSpan[],
  isInterim: boolean,
): NumberScan {
  const mentions: JerseyMention[] = [];
  const vetoed: VetoedNumber[] = [];

  // Surname spans, in token positions rather than Deepgram word indices.
  //
  // Number tokens are left out of the span. The matcher joins short adjacent
  // words and scores them as one, and a number normalizes away to nothing, so
  // "12 Chen" reaches here as a single Chen candidate covering both words. Left
  // in, the surname would swallow its own number and never sit beside it.
  const spans = surnames.map((span) => {
    let first = -1;
    let last = -1;
    tokens.forEach((token, position) => {
      if (token.kind === "number") return;
      if (token.lastIndex < span.firstIndex || token.firstIndex > span.lastIndex) return;
      if (first === -1) first = position;
      last = position;
    });
    return { name: span.name, first, last };
  });
  const takenSurnames = new Set<string>();

  for (let at = 0; at < tokens.length; at++) {
    const token = tokens[at];
    if (token.kind !== "number") continue;

    const record = (reason: string, cueWord: string | null) => {
      vetoed.push({
        number: token.text,
        reason,
        cueWord,
        firstIndex: token.firstIndex,
        lastIndex: token.lastIndex,
        start: token.start,
        confidence: token.confidence,
      });
    };

    const team = teamCueBefore(tokens, at, teamCues);
    const surname = surnameFor(spans, tokens, at, takenSurnames, teamCues);
    const explicit = explicitCueBefore(tokens, at);
    const cueWord = explicit ?? surname?.name ?? team?.words.join(" ") ?? null;

    const veto = vetoFor(tokens, at, sport);
    if (veto) {
      record(`veto:${veto}`, cueWord);
      continue;
    }
    if (!explicit && !surname && !team) {
      record("no_cue", null);
      continue;
    }
    // Only a team is left as the cue, and a team alone never fires a single digit.
    if (!explicit && !surname && token.text.length < TEAM_CUE_MIN_DIGITS) {
      record("single_digit_team_cue", cueWord);
      continue;
    }

    // Interim results grow a word at a time. A number waits only when the wait
    // buys something: it could still be half a different jersey, or a team cue
    // (the weakest of the three) is sitting in front of a word that often
    // begins a score. Everything else fires now; the final retracts it if the
    // rest of the sentence disagrees.
    if (isInterim) {
      const next = tokens[at + 1];
      if (!next && couldGrow(token.text, jerseys)) continue;
      const teamOnly = !explicit && !surname;
      if (teamOnly && next && !tokens[at + 2] && next.kind === "word" && INTERIM_HOLD_WORDS.has(next.text)) continue;
    }
    if (token.confidence < NUMBER_MIN_CONFIDENCE) {
      record("low_confidence", cueWord);
      continue;
    }

    if (surname) takenSurnames.add(surname.name);
    mentions.push({
      number: token.text,
      cue: explicit ? "explicit" : surname ? "surname" : "team",
      cueWord: cueWord ?? "",
      side: team?.side ?? null,
      surname: surname?.name ?? null,
      firstIndex: token.firstIndex,
      lastIndex: token.lastIndex,
      start: token.start,
      confidence: token.confidence,
    });
  }

  let heard: JerseyMention[] = [];
  if (hearJersey) heard = soundedMentions(tokens, mentions, { hearJersey, jerseys, isInterim });

  // A number heard as words replaces the digits it was read as: "number twenty
  // free" is one mention of 23, not a 23 and a 20 nobody is wearing.
  const kept = mentions.filter(
    (mention) => !heard.some((sound) => mention.firstIndex <= sound.lastIndex && sound.firstIndex <= mention.lastIndex),
  );

  return { mentions: [...kept, ...heard].sort((a, b) => a.firstIndex - b.firstIndex), vetoed };
}

/**
 * Numbers that were said but never came back as numbers.
 *
 * Only behind an explicit cue. "Number" says a jersey is coming, which is what
 * makes it safe to read the next word or two as one; a surname or a team next
 * to an ordinary word is not evidence of anything.
 */
function soundedMentions(
  tokens: Token[],
  found: JerseyMention[],
  {
    hearJersey,
    jerseys,
    isInterim,
  }: {
    hearJersey: NonNullable<NumberContext["hearJersey"]>;
    jerseys: Set<string> | undefined;
    isInterim: boolean;
  },
): JerseyMention[] {
  const mentions: JerseyMention[] = [];
  // Without the rosters there is nothing to say the digits were wrong, so the
  // digits stand.
  const onRoster = (number: string) => jerseys?.has(number) ?? true;

  for (let at = 0; at < tokens.length; at++) {
    const cue = tokens[at];
    if (cue.kind !== "word" || !EXPLICIT_CUES.has(cue.text)) continue;
    // The digits already answered this cue with somebody who is playing.
    const answered = found.find(
      (mention) => mention.firstIndex > cue.lastIndex && mention.firstIndex <= cue.lastIndex + 3,
    );
    if (answered && onRoster(answered.number)) continue;

    const run = tokens.slice(at + 1, at + 1 + MAX_JERSEY_WORDS);
    if (run.length === 0) continue;

    // Longest run first: "twenty free" before "twenty".
    for (let length = run.length; length >= 1; length--) {
      const part = run.slice(0, length);
      // An interim can still be growing a word, so its last token is not read.
      if (isInterim && at + length >= tokens.length) continue;
      // Read any digits back as words, so "number 20 free" is scored as it was said.
      const text = part.map((token) => (token.kind === "number" ? jerseyAsSpoken(token.text) : token.text)).join(" ");
      const heard = hearJersey(text);
      // Only worth replacing the digits with a number somebody is wearing.
      if (!heard || !onRoster(heard.jersey)) continue;
      mentions.push({
        number: heard.jersey,
        cue: "explicit",
        cueWord: cue.text,
        heard: { word: text, score: heard.score },
        side: null,
        surname: null,
        firstIndex: part[0].firstIndex,
        lastIndex: part[part.length - 1].lastIndex,
        start: part[0].start,
        confidence: Math.min(...part.map((token) => token.confidence)),
      });
      break;
    }
  }

  return mentions;
}

/** The cue word directly before a number, skipping nothing: "number 23", "wearing 23". */
function explicitCueBefore(tokens: Token[], at: number): string | null {
  const before = tokens[at - 1];
  if (before && before.kind === "word" && EXPLICIT_CUES.has(before.text)) return before.text;
  return null;
}

/**
 * The team named just before a number: "Eagles 5", "Eagles' number 5", "white 5".
 * Cue phrases are matched longest first, so a school name beats a word inside it.
 */
function teamCueBefore(tokens: Token[], at: number, cues: TeamCue[]): TeamCue | null {
  let end = at - 1;
  if (tokens[end]?.kind === "word" && EXPLICIT_CUES.has(tokens[end].text)) end--;
  if (end < 0) return null;

  let best: TeamCue | null = null;
  for (const cue of cues) {
    if (best && cue.words.length <= best.words.length) continue;
    const start = end - cue.words.length + 1;
    if (start < 0) continue;
    const matches = cue.words.every((word, offset) => {
      const token = tokens[start + offset];
      return token?.kind === "word" && token.text === word;
    });
    if (matches) best = cue;
  }
  return best;
}

/**
 * The surname sitting next to a number, if there is one.
 *
 * A surname claims at most one number and a number at most one surname, so
 * "number 12 with 20 points" cannot spend Williams twice. A word that is also a
 * team cue is left to the team rule: a school called after its mascot must not
 * read as a player.
 */
function surnameFor(
  spans: Array<{ name: string; first: number; last: number }>,
  tokens: Token[],
  at: number,
  taken: Set<string>,
  cues: TeamCue[],
): { name: string } | null {
  const cueWords = new Set(cues.flatMap((cue) => cue.words));
  let best: { name: string; distance: number; after: boolean } | null = null;

  for (const span of spans) {
    if (span.first === -1 || taken.has(span.name)) continue;
    if (tokens.slice(span.first, span.last + 1).every((token) => cueWords.has(token.text))) continue;

    const [from, to] = span.last < at ? [span.last, at] : [at, span.first];
    if (from >= to) continue;
    let distance = 1;
    for (let position = from + 1; position < to; position++) {
      if (!isSkippable(tokens[position])) distance++;
    }
    if (distance > NUMBER_SURNAME_WINDOW) continue;

    const after = span.first > at;
    // Nearest wins; a tie goes to the surname before the number, which is how
    // "Williams, number 23" is said.
    if (!best || distance < best.distance || (distance === best.distance && best.after && !after)) {
      best = { name: span.name, distance, after };
    }
  }

  return best ? { name: best.name } : null;
}
