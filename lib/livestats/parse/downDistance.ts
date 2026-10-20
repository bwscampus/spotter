import { parseNumbers, type NumberToken } from "./numbers";
import { tokenize } from "./tokens";

// =============================================================================
// The down and distance call (v7, Part 2): "third and 7", "3rd and seven",
// "fourth and goal from the 2", "first down at the 46", "second and long",
// "2 to go on third down", "on first down". The most reliable boundary in a
// broadcast, and the fact the yards solver (lib/livestats/yards.ts) and the
// segmenter (lib/livestats/segment.ts) lean on. Pure and synchronous.
//
// numerals=true writes "third" as "3rd" and "quarter" as "0.25", so both
// spellings of each ordinal are read. "first down" on its own is a result
// ("first down!"), not a call, unless a spot or "and" follows it.
// =============================================================================

export interface DownDistance {
  down: 1 | 2 | 3 | 4;
  /** Yards to go, or null when not said (or said as "goal", "long", "short"). */
  distance: number | null;
  isGoal: boolean;
  /** The distance is a guess at the words ("long", "short", "inches"). */
  fuzzy: boolean;
  /** Which line of a segment it was on, as the caller numbers them. */
  lineIdx: number;
  /** Token indexes of the call, inclusive. */
  span: [number, number];
}

const ORDINALS: Record<string, 1 | 2 | 3 | 4> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4 };

/** "and" as the transcript hears it. */
const AND = new Set(["and", "an", "&", "n"]);

const SPOT_LEADS = new Set(["at", "from", "on", "near", "inside", "to"]);

function ordinalAt(words: readonly string[], index: number): 1 | 2 | 3 | 4 | null {
  return ORDINALS[words[index]] ?? null;
}

/**
 * The first down-and-distance call in the line, or null. `lineIdx` is passed
 * through so a segment can say which of its lines it came from.
 */
export function parseDownDistance(text: string, lineIdx = 0): DownDistance | null {
  const words = tokenize(text);
  return parseDownDistanceWords(words, lineIdx, parseNumbers(words));
}

export function parseDownDistanceWords(words: readonly string[], lineIdx = 0, numbers: readonly NumberToken[] = parseNumbers(words)): DownDistance | null {
  const numberAt = (index: number) => numbers.find((number) => number.start === index) ?? null;
  // "7 to go", anywhere on the line: the distance when the down is said another way.
  let toGo: NumberToken | null = null;
  for (let i = 0; i + 2 < words.length; i++) {
    if (words[i + 1] === "to" && words[i + 2] === "go") toGo = numberAt(i) ?? toGo;
  }

  for (let i = 0; i < words.length; i++) {
    const down = ordinalAt(words, i);
    if (down === null) continue;
    let at = i + 1;
    // "third down and 7", "on third down".
    const saidDown = words[at] === "down";
    if (saidDown) at += 1;
    if (AND.has(words[at] ?? "")) {
      const after = words[at + 1];
      if (after === undefined) continue;
      if (after === "goal") {
        // "and goal from the 2": the distance is the yard line when one is said close by.
        let distance: number | null = null;
        for (let k = at + 2; k <= at + 4 && k < words.length; k++) {
          if (SPOT_LEADS.has(words[k])) {
            const number = numberAt(k + 1) ?? numberAt(k + 2);
            if (number && !number.fuzzy && number.value <= 10) distance = number.value;
            break;
          }
        }
        return { down, distance, isGoal: true, fuzzy: false, lineIdx, span: [i, at + 1] };
      }
      if (after === "long" || after === "short" || after === "medium" || after === "forever") return { down, distance: null, isGoal: false, fuzzy: true, lineIdx, span: [i, at + 1] };
      const number = numberAt(at + 1);
      if (number) {
        // "third and 7 yards to go" and "third and a yard" are both fine; a fuzzy number ("inches") stays fuzzy.
        const value = number.value;
        if (value >= 0 && value <= 99) return { down, distance: value, isGoal: false, fuzzy: number.fuzzy, lineIdx, span: [i, number.end] };
      }
      // "third and" followed by something that is not a distance: a down alone.
      return { down, distance: null, isGoal: false, fuzzy: false, lineIdx, span: [i, at - 1] };
    }
    if (saidDown) {
      // "on first down", "first down at the 46", "third down 7 to go". A bare
      // "first down" with nothing after it is the result cue, not a call.
      const before = words[i - 1];
      const next = words[at];
      const lead = next !== undefined && (SPOT_LEADS.has(next) || next === "play" || next === "here" || next === "now");
      if (toGo) return { down, distance: toGo.value, isGoal: false, fuzzy: toGo.fuzzy, lineIdx, span: [Math.min(i, toGo.start), Math.max(at - 1, toGo.end + 2)] };
      if (before === "on" || lead) return { down, distance: null, isGoal: false, fuzzy: false, lineIdx, span: [i, at - 1] };
      if (down !== 1) return { down, distance: null, isGoal: false, fuzzy: false, lineIdx, span: [i, at - 1] };
      continue;
    }
  }
  return null;
}
