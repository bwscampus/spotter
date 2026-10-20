import type { LoggedDrop } from "@/lib/log/statsLog";
import { candidateAt, type Candidate } from "../candidates";
import { spotProgress } from "../parse/spots";
import type { PlaySegment } from "../segment";
import { NO_PENALTY, type FieldSpot, type Penalty, type Side, type StatsEvent, type StatsPlay, type StatsRosterPlayer } from "../types";
import { UNSURE_BELOW_CONFIDENCE } from "./confidence";
import type { ExtractAnswer } from "./schema";

// =============================================================================
// The extractor's answer as a play the rest of the engine reads (v7, Part 5):
// one ExtractAnswer, with its candidate list and its segment, into the
// StatsPlay shape, so lib/livestats/session.ts (the check, the merge, the
// stat rules, the ledger) keeps working unchanged. NOT_NAMED credits nobody
// (playerId "", which R9 drops and the strip shows as unknown); a pass with
// no passer is left for the quarterback rule (R14); a player marked out
// tonight is dropped here (R35) before the check sees the play. Pure.
// =============================================================================

export interface MappingState {
  offense: Side | null;
  out: ReadonlySet<string>;
  roster: readonly StatsRosterPlayer[];
}

export interface MappedPlay {
  /** Null when the answer was not a play. */
  play: StatsPlay | null;
  notes: LoggedDrop[];
}

const CONFIDENCE: Record<ExtractAnswer["confidence"], number> = { high: 0.9, medium: 0.65, low: 0.4 };

/** The actions a play may carry with nobody read for them (lib/livestats/validate.ts has the same list). */
const NOBODY_ALLOWED: ReadonlySet<StatsEvent["action"]> = new Set(["rush", "reception", "pass_complete", "pass_incomplete", "pass_intercepted", "sacked"]);

function territoryOf(spot: ReturnType<PlaySegment["lines"][number]["spots"]["find"]>, offense: Side | null): FieldSpot | null {
  if (!spot) return null;
  if (spot.territory === "mid") return { yardLine: 50, territory: "midfield" };
  const progress = spotProgress(spot, offense);
  const territory: FieldSpot["territory"] = progress === null ? "unknown" : progress === 50 ? "midfield" : progress < 50 ? (offense ?? "unknown") : offense ? (offense === "home" ? "away" : "home") : "unknown";
  return { yardLine: spot.yardLine, territory, ...(spot.approximate ? { approximate: true } : {}) };
}

/** The kick a "kick" answer means, from the play's words: a field goal, an extra point, or a kickoff. */
function kickKind(segment: PlaySegment): "field_goal" | "extra_point" | "kickoff" {
  const text = segment.lines.map((line) => line.text).join(" ");
  if (/\bextra point|\bpat\b|point after|conversion kick/.test(text)) return "extra_point";
  if (/field goal|\bfg\b|upright|good from|no good|wide (?:left|right)/.test(text)) return "field_goal";
  return "kickoff";
}

export function answerToPlay(answer: ExtractAnswer, segment: PlaySegment, candidates: readonly Candidate[], state: MappingState): MappedPlay {
  const notes: LoggedDrop[] = [];
  if (answer.playType === "not_a_play") return { play: null, notes };
  const players = new Map(state.roster.map((player) => [player.playerId, player]));
  const sideOf = (id: string | null) => (id ? players.get(id)?.side ?? null : null);

  /** The playerId a candidate index means, "" for NOT_NAMED, and null (dropped) for a player out tonight. */
  const who = (idx: number | null, action: StatsEvent["action"]): string | null => {
    if (idx === null) return null;
    const candidate = candidateAt(candidates, idx);
    if (!candidate || !candidate.playerId) return "";
    if (state.out.has(candidate.playerId)) {
      notes.push({ playerId: candidate.playerId, action, rule: "R35", reason: "marked out tonight: not playing, so not credited", kind: "dropped" });
      return "";
    }
    return candidate.playerId;
  };

  const events: StatsEvent[] = [];
  const add = (playerId: string | null, action: StatsEvent["action"], yards: number | null = null, made: boolean | null = null) => {
    if (playerId === null) return;
    // Nobody read for it: kept for a carry, a catch or a pass (shown as unknown, the quarterback rule for a pass); a tackle by nobody is nothing.
    if (playerId === "" && !NOBODY_ALLOWED.has(action)) return;
    if (events.some((event) => event.playerId === playerId && event.action === action)) return;
    events.push({ playerId, action, yards, yardsSource: yards === null ? null : "stated", made });
  };

  const gain = answer.yardsSaid;
  let playType: StatsPlay["playType"] = "other";
  const carrier = who(answer.carrierIdx, "rush");
  const passer = who(answer.passerIdx, "pass_complete");
  const receiver = who(answer.receiverIdx, "reception");
  const tackler = who(answer.tacklerIdx, "tackle");

  switch (answer.playType) {
    case "rush":
      playType = "run";
      add(carrier ?? "", "rush", gain);
      add(tackler, "tackle");
      break;
    case "pass_complete":
      playType = "pass";
      add(passer ?? "", "pass_complete", gain);
      add(receiver ?? "", "reception", gain);
      add(tackler, "tackle");
      break;
    case "pass_incomplete":
      playType = "pass";
      add(passer ?? "", "pass_incomplete");
      // The target of an incompletion is not credited; a defender named on one broke it up.
      add(tackler, "pass_breakup");
      break;
    case "sack": {
      playType = "sack";
      const loss = gain === null ? null : Math.abs(gain);
      add(carrier ?? passer ?? "", "sacked", loss);
      add(tackler, "sack", loss);
      break;
    }
    case "interception":
      playType = "pass";
      add(passer ?? "", "pass_intercepted");
      add(receiver, "interception", gain);
      add(tackler, "tackle");
      break;
    case "fumble_lost":
      playType = "run";
      add(carrier, "fumble");
      add(tackler, "fumble_recovery");
      break;
    case "punt":
      playType = "punt";
      add(carrier, "punt", gain);
      add(receiver, "punt_return");
      add(tackler, "tackle");
      break;
    case "kick": {
      const kind = kickKind(segment);
      playType = kind;
      if (kind === "kickoff") {
        add(receiver, "kick_return", gain);
        add(tackler, "tackle");
      } else {
        const text = segment.lines.map((line) => line.text).join(" ");
        const made = /\bno good|wide (?:left|right)|missed|blocked|short\b/.test(text) ? false : /\bgood\b|through the uprights|splits the uprights/.test(text) ? true : null;
        add(carrier, kind, kind === "field_goal" ? gain : null, made);
      }
      break;
    }
    case "penalty_only":
      playType = "penalty_only";
      break;
    case "no_play":
      // What the snap was: from who was credited first, the words second.
      playType =
        answer.passerIdx !== null || answer.receiverIdx !== null ? "pass" : answer.carrierIdx !== null ? (segment.cues.sack && !segment.cues.rush ? "sack" : "run") : segment.cues.sack ? "sack" : segment.cues.pass || segment.cues.complete || segment.cues.incomplete ? "pass" : "run";
      if (playType === "run") add(carrier, "rush", gain);
      else if (playType === "pass") {
        if (receiver || segment.cues.complete) {
          add(passer ?? "", "pass_complete", gain);
          add(receiver, "reception", gain);
        } else add(passer ?? "", "pass_incomplete");
      } else add(carrier ?? passer ?? "", "sacked", gain === null ? null : Math.abs(gain));
      add(tackler, "tackle");
      break;
  }

  const penalty: Penalty =
    answer.penalty === "none" && answer.playType !== "no_play"
      ? NO_PENALTY
      : { on: answer.penalty === "unclear" ? "unknown" : answer.penalty === "none" ? "unknown" : answer.penalty, noPlay: answer.playType === "no_play", beforeSnap: answer.playType === "penalty_only" && segment.cues.penalty && /false start|delay of game|offside|offsides|encroachment|illegal formation|illegal shift|illegal motion/.test(segment.lines.map((line) => line.text).join(" ")), penaltyYards: null };

  const offense: Side | null = sideOf(carrier && carrier !== "" ? carrier : passer && passer !== "" ? passer : receiver && receiver !== "" && answer.playType !== "interception" ? receiver : null) ?? state.offense;
  const playLines = segment.lines;
  const startSpot = territoryOf(playLines.flatMap((line) => line.spots).find((spot) => spot.kind === "start") ?? (segment.spotBefore ?? undefined), offense);
  // Where it ended: the last "to the N" in the play's lines, else the last "at the N" (where the catch was made, where he was brought down).
  const ends = playLines.flatMap((line) => line.spots).filter((spot) => spot.kind === "end");
  const ats = playLines.flatMap((line) => line.spots).filter((spot) => spot.kind === "at");
  const endSpot = territoryOf(ends[ends.length - 1] ?? ats[ats.length - 1], offense);
  const text = [...segment.lines, ...segment.postLines.slice(0, 2)].map((line) => line.text).join(" ");
  const evidence = segment.lines.map((line) => line.text).join(" ").split(/\s+/).slice(0, 20).join(" ");

  const play: StatsPlay = {
    seqStart: segment.lineStart,
    seqEnd: segment.lineEnd,
    quarter: null,
    clock: null,
    down: segment.ddBefore?.down ?? null,
    distance: segment.ddBefore?.distance ?? null,
    offense,
    playType,
    nullified: answer.playType === "no_play",
    touchdown: answer.touchdown,
    firstDown: segment.cues.firstDown && !answer.touchdown,
    confidence: CONFIDENCE[answer.confidence],
    summary: summaryOf(answer, events, players, playType),
    evidence,
    events,
    updates: "",
    startSpot,
    endSpot,
    shortBy: null,
    score: null,
    penalty,
  };
  void text;
  return { play, notes };
}

/** "FENNIMORE 6 yd run, brought down by QUILLON", the way a spotter would write it. */
export function summaryOf(answer: ExtractAnswer, events: readonly StatsEvent[], players: ReadonlyMap<string, StatsRosterPlayer>, playType: StatsPlay["playType"]): string {
  const name = (id: string) => (id === "" ? "UNKNOWN" : (players.get(id)?.last.toUpperCase() ?? id));
  const find = (action: StatsEvent["action"]) => events.find((event) => event.action === action);
  const yards = answer.yardsSaid === null ? "" : ` ${answer.yardsSaid} yd`;
  const tackle = find("tackle") ?? find("sack") ?? find("pass_breakup") ?? find("fumble_recovery");
  const tail = tackle ? `, ${tackle.action === "pass_breakup" ? "broken up by" : tackle.action === "fumble_recovery" ? "recovered by" : "brought down by"} ${name(tackle.playerId)}` : "";
  const flag = answer.playType === "no_play" ? " (no play)" : "";
  switch (answer.playType) {
    case "rush":
      return `${name(find("rush")?.playerId ?? "")}${yards} run${answer.touchdown ? " TD" : ""}${tail}`;
    case "pass_complete":
      return `${name(find("pass_complete")?.playerId ?? "")} to ${name(find("reception")?.playerId ?? "")}${yards} pass${answer.touchdown ? " TD" : ""}${tail}`;
    case "pass_incomplete":
      return `${name(find("pass_incomplete")?.playerId ?? "")} incomplete${tail}`;
    case "sack":
      return `${name(find("sacked")?.playerId ?? "")} sacked${yards ? ` for${yards}` : ""}${tackle ? ` by ${name(tackle.playerId)}` : ""}`;
    case "interception":
      return `${name(find("pass_intercepted")?.playerId ?? "")} intercepted${find("interception") ? ` by ${name(find("interception")!.playerId)}` : ""}`;
    case "fumble_lost":
      return `${name(find("fumble")?.playerId ?? "")} fumble, lost${tail}`;
    case "punt":
      return `${name(find("punt")?.playerId ?? "")} punt${yards}${find("punt_return") ? `, returned by ${name(find("punt_return")!.playerId)}` : ""}`;
    case "kick":
      return playType === "kickoff" ? `Kickoff${find("kick_return") ? `, returned by ${name(find("kick_return")!.playerId)}` : ""}` : `${name(events[0]?.playerId ?? "")} ${playType === "field_goal" ? "field goal" : "extra point"}${events[0]?.made === true ? " good" : events[0]?.made === false ? " missed" : ""}`;
    case "penalty_only":
      return `Penalty, no play${answer.penalty !== "none" ? ` (${answer.penalty})` : ""}`;
    case "no_play":
      return `${playType === "pass" ? "Pass" : playType === "sack" ? "Sack" : "Run"} wiped out by a flag${flag}`;
    default:
      return "Not a play";
  }
}

/** Whether an answer credits anyone at all. */
export function creditsAnyone(answer: ExtractAnswer): boolean {
  return [answer.carrierIdx, answer.passerIdx, answer.receiverIdx, answer.tacklerIdx].some((idx) => idx !== null && idx !== 0);
}

export { UNSURE_BELOW_CONFIDENCE };
