import type { Side, TeamWords } from "../types";
import { parseNumbers, type NumberToken } from "./numbers";
import { tokenize } from "./tokens";

// =============================================================================
// Where the ball is, as the booth says it (v7, Part 2): "at the 35", "own 20",
// "bulldogs 40", "midfield", "the 50", "inside the 5", "goal line", "end
// zone", "from the 28 to the 41". Each mention comes back with its yard line,
// whose half it is in when the words say (a team word, "own", "opponent's",
// "midfield"), which end of a play it marks (from = start, to = end, at =
// where the ball sits), and whether it was said approximately ("past the
// 30"). Pure and synchronous.
//
// Territory is "own" (the offense's half), "opp" (the defense's), "mid" (the
// 50) or "unknown"; with `team` set to the side a team word named, so a
// caller that knows who has the ball can turn it into a half.
// =============================================================================

export type SpotTerritory = "own" | "opp" | "mid" | "unknown";

export interface SpotMention {
  yardLine: number;
  territory: SpotTerritory;
  /** The side whose word was said before the number ("bulldogs 40"), when one was. */
  team?: Side;
  /** "from the N" starts a play, "to the N" ends it, "at the N" is where the ball sits. */
  kind: "start" | "end" | "at";
  approximate: boolean;
  /** Token indexes, inclusive. */
  span: [number, number];
}

export interface SpotContext {
  teams?: TeamWords | null;
  /** Who has the ball, when known, so a team word can be read as own or opp. */
  offense?: Side | null;
}

/** How many words before a yard line a team word may sit. */
export const QUALIFIER_SPAN = 3;

/** How many words before a yard line "own", "opponent's" or "enemy territory" may sit. */
export const HALF_WORD_SPAN = 4;

const START_LEADS = new Set(["from"]);
const END_LEADS = new Set(["to", "into", "down", "out", "past", "across", "inside", "near", "reaches", "reach", "beyond"]);
const AT_LEADS = new Set(["at", "on"]);
const OWN = new Set(["own", "their", "his", "his own"]);
const THEIRS = new Set(["opponent", "opponents", "opposing", "enemy", "plus"]);
const APPROX = new Set(["past", "near", "around", "about", "almost", "roughly", "shy", "inside", "beyond", "nearly", "approaching", "close"]);
/** A number right after one of these is not a yard line. */
const NOT_A_SPOT_BEFORE = new Set(["and", "an", "&", "number", "numero", "jersey", "for", "of", "gain", "loss", "picks", "pickup", "up", "lost", "loses", "gains", "by", "quarter", "minute", "minutes", "second", "seconds", "point", "points", "leads", "lead", "trail", "trails", "with", "has", "had", "age", "down"]);
/** A number followed by one of these is a gain, a count or a score, not a yard line. */
const NOT_A_SPOT_AFTER = new Set(["yards", "yard", "yarder", "carries", "catches", "receptions", "completions", "attempts", "touchdowns", "touchdown", "tackles", "sacks", "points", "point", "seconds", "minutes", "of", "for", "yarder"]);

function teamBefore(words: readonly string[], at: number, teams: TeamWords | null | undefined): Side | null {
  if (!teams) return null;
  const from = Math.max(0, at - QUALIFIER_SPAN);
  for (const side of ["home", "away"] as const) {
    for (const phrase of teams[side].phrases) {
      const parts = phrase.split(" ");
      for (let end = at; end >= at - 1 && end > 0; end--) {
        const start = end - parts.length;
        if (start < from) continue;
        if (end < at && words[end] !== "the") continue;
        if (parts.every((part, index) => words[start + index] === part)) return side;
      }
    }
  }
  return null;
}

/**
 * Every yard line said in the words, in order. A number that follows a down
 * ("3rd and 4"), "number", "for" or "of", or precedes "yards" or "to go", is
 * not a spot.
 */
export function parseSpots(text: string, context: SpotContext = {}): SpotMention[] {
  const words = tokenize(text);
  return parseSpotsWords(words, context, parseNumbers(words));
}

export function parseSpotsWords(words: readonly string[], context: SpotContext = {}, numbers: readonly NumberToken[] = parseNumbers(words)): SpotMention[] {
  const found: SpotMention[] = [];
  const offense = context.offense ?? null;

  const territoryOf = (at: number): { territory: SpotTerritory; team?: Side } => {
    const from = Math.max(0, at - HALF_WORD_SPAN);
    const before = words.slice(from, at);
    for (let i = before.length - 1; i >= 0; i--) {
      if (OWN.has(before[i])) return { territory: "own" };
      if (THEIRS.has(before[i])) return { territory: "opp" };
    }
    const team = teamBefore(words, at, context.teams);
    if (team) return { territory: offense ? (team === offense ? "own" : "opp") : "unknown", team };
    const wider = words.slice(Math.max(0, at - QUALIFIER_SPAN - 2), at);
    if (wider.includes("across") && wider.includes("midfield")) return { territory: "opp" };
    return { territory: "unknown" };
  };

  const kindOf = (at: number): SpotMention["kind"] => {
    for (let back = at - 1; back >= Math.max(0, at - QUALIFIER_SPAN - 1); back--) {
      const word = words[back];
      if (START_LEADS.has(word)) return "start";
      if (END_LEADS.has(word)) return "end";
      if (AT_LEADS.has(word)) return "at";
    }
    return "at";
  };

  const approximateAt = (at: number) => words.slice(Math.max(0, at - QUALIFIER_SPAN - 1), at).some((word) => APPROX.has(word));

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === "midfield") {
      found.push({ yardLine: 50, territory: "mid", kind: kindOf(i), approximate: false, span: [i, i] });
      continue;
    }
    if ((word === "goal" && words[i + 1] === "line") || (word === "end" && words[i + 1] === "zone")) {
      // The goal line is the defense's 0 when a play ends there, the offense's own when it starts there.
      const kind = kindOf(i);
      found.push({ yardLine: 0, territory: kind === "start" ? "own" : "opp", kind, approximate: false, span: [i, i + 1] });
      i += 1;
      continue;
    }
    const number = numbers.find((entry) => entry.start === i && !entry.fuzzy);
    if (!number || number.value > 50 || !Number.isInteger(number.value)) continue;
    const before = words[i - 1];
    const after = words[number.end + 1];
    if (before !== undefined && NOT_A_SPOT_BEFORE.has(before)) continue;
    if (after !== undefined && NOT_A_SPOT_AFTER.has(after)) continue;
    // "7 to go" and "22 to 7" are a distance and a score; "from the 28 to the 41" is two spots.
    const after2 = words[number.end + 2];
    if (after === "to" && (after2 === "go" || (after2 !== undefined && /^\d/.test(after2)))) continue;
    // "the 35", "own 35", "bulldogs 35", "midfield at the 50": a yard line wants "the", a qualifier or a team word before it.
    const window = words.slice(Math.max(0, i - QUALIFIER_SPAN), i);
    const led = window.includes("the") || window.some((part) => OWN.has(part) || THEIRS.has(part)) || teamBefore(words, i, context.teams) !== null;
    if (!led) continue;
    if (number.value === 50) {
      found.push({ yardLine: 50, territory: "mid", kind: kindOf(i), approximate: approximateAt(i), span: [i, number.end] });
      continue;
    }
    const half = territoryOf(i);
    found.push({ yardLine: number.value, territory: half.territory, ...(half.team ? { team: half.team } : {}), kind: kindOf(i), approximate: approximateAt(i), span: [i, number.end] });
  }
  return found;
}

/** A spot as yards from the offense's own goal line (0 to 100), when its half is known; null otherwise. */
export function spotProgress(spot: SpotMention, offense: Side | null = null): number | null {
  if (spot.territory === "mid") return 50;
  if (spot.territory === "own") return spot.yardLine;
  if (spot.territory === "opp") return 100 - spot.yardLine;
  if (spot.team && offense) return spot.team === offense ? spot.yardLine : 100 - spot.yardLine;
  return null;
}
