import type { YardsSource } from "./types";

// =============================================================================
// The yards solver (v7, Part 6): each way a play's gain can be known, worked
// out on its own, then chosen in a fixed order, so a stated number is never
// beaten by arithmetic and arithmetic is never beaten by a guess.
//   stated:  yardsSaid from the extractor, or "<n> yards", "picks up <n>",
//            "gain of <n>", "loss of <n>" in the play's lines (79% exact on
//            the dev games).
//   dd:      the next down and distance, with no flag between: on the same
//            series the gain is d_prev - d_next; a first down means the gain
//            reached d_prev (exact only with a spot or a number beside it);
//            "and goal" is the goal line less the new distance.
//   spots:   the end spot less the start spot, as yards from the offense's
//            own goal line.
//   ledger:  the drive ledger's figure (lib/livestats/ledger.ts), last.
// An incompletion is 0 and exact; a sack is a loss, and a stated "loss of"
// wins. With a flag, dd is not used across it unless the flag's yards are
// known and taken out. Two methods more than a yard apart keep the first
// and set agree false. Pure.
// =============================================================================

export type YardsMethod = "stated" | "dd" | "spots" | "ledger" | "incompletion";

export interface YardsCandidate {
  method: YardsMethod;
  yards: number;
  /** A figure the method pins exactly; false for "at least" and for the ledger. */
  exact: boolean;
}

export interface YardsSolution {
  yards: number | null;
  /** The source the play's event carries (lib/livestats/types.ts): stated, downs, spots or ledger. */
  source: YardsSource | null;
  method: YardsMethod | null;
  /** Every exact method agreed within a yard (true when only one spoke). */
  agree: boolean;
  candidates: YardsCandidate[];
}

export interface DownFacts {
  down: number;
  distance: number | null;
  isGoal: boolean;
}

export interface YardsFacts {
  playType: "rush" | "pass_complete" | "pass_incomplete" | "sack" | "interception" | "fumble_lost" | "punt" | "kick" | "penalty_only" | "no_play" | "not_a_play";
  yardsSaid: number | null;
  /** The play's own lines, for a number said in words. */
  lines: readonly string[];
  /** The call before the play, and the next one on the same possession. */
  dd: DownFacts | null;
  nextDd: DownFacts | null;
  /** Yards from the offense's own goal line, 0 to 100, when known. */
  startSpot: number | null;
  endSpot: number | null;
  /** The next play's start spot, when it was said: the end of this one. */
  nextStart?: number | null;
  penalty: "none" | "offense" | "defense" | "unclear";
  penaltyYards: number | null;
  /** The ledger's figure, when it pinned one. */
  ledger: number | null;
  touchdown: boolean;
}

const SOURCE: Record<YardsMethod, YardsSource> = { stated: "stated", dd: "downs", spots: "spots", ledger: "ledger", incompletion: "stated" };

/** The method order: the first that speaks wins. */
export const METHOD_ORDER: readonly YardsMethod[] = ["incompletion", "stated", "dd", "spots", "ledger"];

/** "<n> yards", "picks up <n>", "gain of <n>", "loss of <n>", "<n> yard gain", with the sign from the loss words. */
const GAIN_WORDS = [
  /\bgain of (\d{1,2})\b/,
  /\bpicks? up (\d{1,2})\b/,
  /\bpickup of (\d{1,2})\b/,
  /\b(\d{1,2})[ -]yard (?:gain|run|catch|pass|completion|reception|scramble|carry|rush|pickup|strike)\b/,
  /\b(?:a )?(\d{1,2}) yards? (?:on the (?:play|carry|catch|run)|to the)\b/,
  /\bfor (\d{1,2}) yards?\b(?! (?:on the (?:season|year|night|day)|rushing|passing|receiving|tonight|today))/,
  /\bgood for (\d{1,2})\b/,
];
const LOSS_WORDS = [/\bloss of (\d{1,2})\b/, /\bloses (\d{1,2})\b/, /\b(\d{1,2}) yards? (?:behind|back)\b/, /\bdropped (?:him )?for a loss of (\d{1,2})\b/];
/** Lines about a total, a season or another game give no number for this play. */
const NOT_THIS_PLAY = /\b(?:season|career|tonight|today|total|average|averaging|on the (?:night|day|year)|so far|already has|now has|last (?:week|year|game))\b/;

/** The number the lines say for this play's gain, signed, or null. */
export function statedInLines(lines: readonly string[]): number | null {
  for (const line of lines) {
    const text = line.toLowerCase();
    if (NOT_THIS_PLAY.test(text)) continue;
    for (const pattern of LOSS_WORDS) {
      const match = pattern.exec(text);
      if (match) return -Number(match[1]);
    }
    for (const pattern of GAIN_WORDS) {
      const match = pattern.exec(text);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

/** The flag's yards signed for the offense: negative against it. Null when a flag's yards are not known. */
function flagYards(facts: YardsFacts): number | null {
  if (facts.penalty === "none") return 0;
  if (facts.penaltyYards === null) return null;
  return facts.penalty === "offense" ? -facts.penaltyYards : facts.penalty === "defense" ? facts.penaltyYards : null;
}

export function solveYards(facts: YardsFacts): YardsSolution {
  const candidates: YardsCandidate[] = [];
  const sack = facts.playType === "sack";
  const incompletion = facts.playType === "pass_incomplete";

  if (incompletion) candidates.push({ method: "incompletion", yards: 0, exact: true });

  // Stated: the extractor's number, else the words. A sack's number is a loss whatever its sign.
  let stated = facts.yardsSaid ?? statedInLines(facts.lines);
  if (stated !== null && sack) stated = -Math.abs(stated);
  if (stated !== null && !incompletion) candidates.push({ method: "stated", yards: stated, exact: true });

  // The next down and distance.
  const flag = flagYards(facts);
  if (facts.dd && facts.nextDd && flag !== null && !incompletion) {
    const prev = facts.dd;
    const next = facts.nextDd;
    if (next.isGoal && next.distance !== null && facts.startSpot !== null) {
      candidates.push({ method: "dd", yards: 100 - facts.startSpot - next.distance - flag, exact: true });
    } else if (next.down === prev.down + 1 && prev.distance !== null && next.distance !== null && !prev.isGoal) {
      candidates.push({ method: "dd", yards: prev.distance - next.distance - flag, exact: flag === 0 || facts.penalty !== "unclear" });
    } else if (next.down === 1 && prev.distance !== null && !prev.isGoal && flag === 0) {
      // A first down: the gain reached the distance. Exact only when something else pins it.
      candidates.push({ method: "dd", yards: prev.distance, exact: false });
    }
  }

  // The spots.
  const end = facts.touchdown ? 100 : (facts.endSpot ?? facts.nextStart ?? null);
  if (facts.startSpot !== null && end !== null && !incompletion && flag === 0) {
    candidates.push({ method: "spots", yards: end - facts.startSpot, exact: true });
  }

  if (facts.ledger !== null && !incompletion) candidates.push({ method: "ledger", yards: facts.ledger, exact: false });

  // The first exact method in order wins; the first-down "at least" counts only to confirm.
  const chosen = METHOD_ORDER.map((method) => candidates.find((candidate) => candidate.method === method && candidate.exact)).find((candidate) => candidate !== undefined) ?? candidates.find((candidate) => candidate.method === "ledger") ?? null;
  if (!chosen) return { yards: null, source: null, method: null, agree: true, candidates };
  let agree = true;
  for (const other of candidates) {
    if (other === chosen) continue;
    if (other.exact && Math.abs(other.yards - chosen.yards) > 1) agree = false;
    if (!other.exact && other.method === "dd" && chosen.yards < other.yards - 1) agree = false;
  }
  if (sack && chosen.yards > 0) return { yards: -Math.abs(chosen.yards), source: SOURCE[chosen.method], method: chosen.method, agree, candidates };
  return { yards: chosen.yards, source: SOURCE[chosen.method], method: chosen.method, agree, candidates };
}
