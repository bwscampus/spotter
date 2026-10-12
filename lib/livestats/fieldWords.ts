import type { LoggedDrop } from "@/lib/log/statsLog";
import type { FieldSpot, Side, StatsPlay, TeamWords } from "./types";

// =============================================================================
// Field-position words (Oct 11, Part 4, rule R37). The booth gives the gain
// as a spot more often than as a number ("to the 29", "Bama 20", "across
// midfield to the 40", "inside the 10"), and the reader returns the yard line
// but, more often than not, cannot say whose half it is in. The words beside
// the number usually can:
//   - a team's name, nickname or cue word just before the yard line puts it
//     in that team's half ("Tigers 30" is the Tigers' 30, whichever side has
//     the ball);
//   - "own" is the offense's half; "opponent's", "enemy", "plus territory",
//     "across midfield" are the defense's;
//   - "midfield" and "the 50" are the 50.
// A half the reader stated is never overridden; only an unknown one is filled
// in. When the reader gave no end spot at all, "to the N", "at the N",
// "inside the N" and "near the N" supply one, and "from the N" a start spot,
// at N; whatever yards follow are worked out (R23) and so marked estimated.
// Pure, and every change is a note with its rule.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** How many words before a yard line a qualifier ("own", "opponent's", a team word) may sit. */
export const SPOT_QUALIFIER_SPAN = 3;

// =============================================================================

/** Words that put a yard line in the offense's own half. */
const OWN = new Set(["own"]);

/** Words that put a yard line in the defense's half. */
const THEIRS = new Set(["opponent", "opponents", "opposing", "enemy", "plus"]);

/** Verbs and prepositions that say where a play ended, when they come right before "the N". */
const END_WORDS = new Set(["to", "at", "inside", "near", "down", "out", "past", "reaches", "reach", "into"]);

/** Says where a play began. */
const START_WORDS = new Set(["from"]);

/** What may sit between "to" and the yard line, besides a team word. */
const BETWEEN = new Set(["the", "own", "their", "his", "opponent", "opponents", "opposing", "enemy", "plus", "midfield", "across"]);

export interface ResolvedSpots {
  play: StatsPlay;
  notes: LoggedDrop[];
}

/** The lines as words: lowercase letters, digits and apostrophes kept; "opponent's" is "opponent". */
export function spotWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0);
}

/** The half the words just before index `at` put a yard line in, or null. */
function halfBefore(words: readonly string[], at: number, teams: TeamWords | null, offense: Side | null): { territory: Side | "midfield"; why: string } | null {
  const from = Math.max(0, at - SPOT_QUALIFIER_SPAN);
  const before = words.slice(from, at);
  if (words[at] === "50") return { territory: "midfield", why: "the 50" };
  const defense: Side | null = offense === null ? null : offense === "home" ? "away" : "home";
  for (let i = before.length - 1; i >= 0; i--) {
    const word = before[i];
    if (OWN.has(word) && offense) return { territory: offense, why: `"own ${words[at]}" is the ${offense} side's` };
    if (THEIRS.has(word) && defense) return { territory: defense, why: `"${word} ${words[at]}" is the ${defense} side's` };
  }
  if (teams) {
    for (const side of ["home", "away"] as const) {
      for (const phrase of teams[side].phrases) {
        const parts = phrase.split(" ");
        // The phrase must end within the span, right before the number or with "the" between.
        for (let end = at; end >= at - 1 && end > 0; end--) {
          const start = end - parts.length;
          if (start < from) continue;
          if (end < at && words[end] !== "the") continue;
          if (parts.every((part, index) => words[start + index] === part)) return { territory: side, why: `"${phrase} ${words[at]}" is the ${side} side's` };
        }
      }
    }
  }
  // "across midfield to the 40": two words of phrase, so it may start a little further back.
  const wider = words.slice(Math.max(0, at - SPOT_QUALIFIER_SPAN - 2), at);
  if (wider.includes("across") && wider.includes("midfield") && defense) return { territory: defense, why: `"across midfield" puts the ${words[at]} in the ${defense} side's half` };
  return null;
}

/** Each place a yard line is said as a number, with its index in the words. */
function mentions(words: readonly string[], yardLine: number): number[] {
  const text = String(yardLine);
  const found: number[] = [];
  words.forEach((word, index) => {
    if (word !== text) return;
    // "3rd and 4": a down and distance, not a yard line.
    if (index > 0 && (words[index - 1] === "and" || words[index - 1] === "an")) return;
    found.push(index);
  });
  return found;
}

/**
 * A spot with an unknown half placed by the words beside its number, when
 * every mention of that number agrees. Null when nothing says, or the words disagree.
 */
function placeByWords(spot: FieldSpot, words: readonly string[], teams: TeamWords | null, offense: Side | null): { spot: FieldSpot; why: string } | null {
  if (spot.territory !== "unknown") return null;
  if (spot.yardLine === 50) return { spot: { yardLine: 50, territory: "midfield" }, why: "the 50 is midfield" };
  const halves = mentions(words, spot.yardLine)
    .map((at) => halfBefore(words, at, teams, offense))
    .filter((half): half is NonNullable<typeof half> => half !== null);
  if (halves.length === 0) return null;
  if (!halves.every((half) => half.territory === halves[0].territory)) return null;
  return { spot: { yardLine: halves[0].territory === "midfield" ? 50 : spot.yardLine, territory: halves[0].territory }, why: halves[0].why };
}

/** The last "to the N", "inside the N" (an end) or the first "from the N" (a start) in the words, as a spot. */
function spotFromWords(words: readonly string[], kind: "start" | "end", teams: TeamWords | null, offense: Side | null): { spot: FieldSpot; why: string } | null {
  const lead = kind === "start" ? START_WORDS : END_WORDS;
  const candidates: Array<{ spot: FieldSpot; why: string }> = [];
  for (let at = 1; at < words.length; at++) {
    const number = Number(words[at]);
    if (!/^\d{1,2}$/.test(words[at]) || number > 50) continue;
    if (at > 0 && (words[at - 1] === "and" || words[at - 1] === "an")) continue;
    // "the N", with up to SPOT_QUALIFIER_SPAN words of qualifier between the lead word and the number.
    let lead_ = -1;
    for (let back = at - 1; back >= Math.max(0, at - SPOT_QUALIFIER_SPAN - 1); back--) {
      if (lead.has(words[back])) {
        lead_ = back;
        break;
      }
    }
    if (lead_ === -1) continue;
    // "the" must come between, and nothing but a qualifier or a team word beside it: "to number 22" is a jersey, not a yard line.
    const between = words.slice(lead_ + 1, at);
    if (!between.includes("the")) continue;
    const teamWords = new Set((teams ? [...teams.home.phrases, ...teams.away.phrases] : []).flatMap((phrase) => phrase.split(" ")));
    if (!between.every((word) => BETWEEN.has(word) || teamWords.has(word))) continue;
    const half = halfBefore(words, at, teams, offense);
    const territory = half?.territory ?? "unknown";
    candidates.push({
      spot: { yardLine: territory === "midfield" ? 50 : number, territory },
      why: `"${words.slice(lead_, at + 1).join(" ")}"${half ? `: ${half.why}` : ""}`,
    });
  }
  if (candidates.length === 0) return null;
  return kind === "start" ? candidates[0] : candidates[candidates.length - 1];
}

/**
 * The play with its spots placed by the words it was read from. A half the
 * reader gave stays; an unknown one is filled in from the words beside the
 * number; a missing end spot (or start spot) is supplied from "to the N" (or
 * "from the N") when the words say it plainly.
 */
export function resolveSpots(play: StatsPlay, lines: string | undefined, teams: TeamWords | null, offense: Side | null = play.offense): ResolvedSpots {
  if (!lines || lines.trim().length === 0) return { play, notes: [] };
  const words = spotWords(lines);
  const notes: LoggedDrop[] = [];
  let next = play;
  const note = (which: "start" | "end", reason: string) =>
    notes.push({ playerId: "", action: `${which}_spot`, rule: "R37", reason, kind: "changed" });

  for (const which of ["start", "end"] as const) {
    const key = which === "start" ? "startSpot" : "endSpot";
    const given = next[key];
    if (given) {
      const placed = placeByWords(given, words, teams, offense);
      if (placed) {
        next = { ...next, [key]: placed.spot };
        note(which, `${which} spot's half from the words: ${placed.why}`);
      }
      continue;
    }
    // Only a spot the reader left out, and only on a play from scrimmage or a kick the words describe.
    if (given === undefined) continue;
    const found = spotFromWords(words, which, teams, offense);
    if (found) {
      next = { ...next, [key]: found.spot };
      note(which, `${which} spot from the words: ${found.why}`);
    }
  }
  return { play: next, notes };
}
