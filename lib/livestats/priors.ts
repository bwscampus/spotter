import type { TonightTally } from "@/lib/cards/tonight";
import type { LoggedDrop } from "@/lib/log/statsLog";
import type { Roster } from "./apply";
import { hasGroup } from "./positions";
import type { Side, StatsEvent, StatsPlay, StatsRosterPlayer } from "./types";

// =============================================================================
// Honest priors for a player nobody named (v7, Part 7). A pass with no passer
// is the offense's quarterback: that is a rule of football and was v6's R14
// already; the credit is marked prior:qb. A rusher or a receiver nobody named
// is never guessed in the live box score: the play keeps its credit to nobody
// (the strip shows an unknown carry), and the team's unattributed line
// ("Unattributed rush: 4 yds") keeps the team total right. Behind a setting,
// off by default, one back who has RB_SHARE of tonight's named carries takes
// an unnamed rush, marked prior:rb and estimated, so the card shows it with
// the ~. A player marked out tonight is never filled in. Pure.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** The share of the offense's named carries one back must hold to take an unnamed rush. */
export const RB_SHARE = 0.8;

/** Fewer named carries than this tonight and nobody has a share worth trusting. */
export const RB_MIN_CARRIES = 3;

// =============================================================================

export interface PriorsOptions {
  allowInferredRb: boolean;
  out?: ReadonlySet<string>;
  tonight?: ReadonlyMap<string, TonightTally>;
  /** The quarterback on the field for each side (lib/livestats/check.ts currentQbs). */
  qbs: Record<Side, string | null>;
}

export interface PriorsResult {
  play: StatsPlay;
  notes: LoggedDrop[];
}

const PASSES: ReadonlySet<StatsEvent["action"]> = new Set(["pass_complete", "pass_incomplete", "pass_intercepted"]);

function list(roster: Roster): readonly StatsRosterPlayer[] {
  return roster instanceof Map ? [...roster.values()] : (roster as readonly StatsRosterPlayer[]);
}

/** The back with RB_SHARE of the side's named carries tonight, or null. */
export function inferredBack(roster: Roster, side: Side, tonight: ReadonlyMap<string, TonightTally> | undefined, out?: ReadonlySet<string>): string | null {
  if (!tonight) return null;
  let total = 0;
  let best: { id: string; carries: number } | null = null;
  for (const player of list(roster)) {
    if (player.side !== side) continue;
    const carries = tonight.get(player.playerId)?.stats.rush_att ?? 0;
    if (carries <= 0) continue;
    total += carries;
    if (!hasGroup(player.position, "skill") || out?.has(player.playerId)) continue;
    if (!best || carries > best.carries) best = { id: player.playerId, carries };
  }
  if (!best || total < RB_MIN_CARRIES) return null;
  return best.carries / total >= RB_SHARE ? best.id : null;
}

/**
 * The play with its priors applied: the quarterback for a pass nobody threw,
 * and, when allowed, the dominant back for a run nobody carried. Everything
 * else credited to nobody stays nobody's.
 */
export function applyPriors(play: StatsPlay, roster: Roster, options: PriorsOptions): PriorsResult {
  const notes: LoggedDrop[] = [];
  const offense = play.offense;
  const events = play.events.map((event) => {
    if (event.playerId !== "") return event;
    if (PASSES.has(event.action) || event.action === "sacked") {
      const qb = offense ? options.qbs[offense] : null;
      if (qb && !options.out?.has(qb)) {
        notes.push({ playerId: "", action: event.action, rule: "R14", reason: "no passer named; the quarterback on the field (prior:qb)", kind: "filled", to: qb });
        return { ...event, playerId: qb, estimated: true };
      }
      return event;
    }
    if (event.action === "rush" && options.allowInferredRb && offense) {
      const back = inferredBack(roster, offense, options.tonight, options.out);
      if (back) {
        notes.push({ playerId: "", action: "rush", rule: "R9", reason: `no runner named; the back with ${Math.round(RB_SHARE * 100)}% of tonight's carries (prior:rb)`, kind: "filled", to: back });
        return { ...event, playerId: back, estimated: true };
      }
    }
    return event;
  });
  return { play: events.some((event, index) => event !== play.events[index]) ? { ...play, events } : play, notes };
}

/** One team line for a credit nobody holds: "Unattributed rush: 4 yds". */
export interface UnattributedLine {
  side: Side;
  kind: "rush" | "catch" | "pass";
  yards: number | null;
  playId: string;
  text: string;
}

/**
 * The team's unattributed lines from the counted plays: every carry, catch
 * or pass still credited to nobody, so a team total can include them.
 */
export function unattributedOf(plays: ReadonlyArray<{ playId: string; status: string; play: StatsPlay }>): UnattributedLine[] {
  const lines: UnattributedLine[] = [];
  for (const entry of plays) {
    if (entry.status !== "applied" || !entry.play.offense) continue;
    for (const event of entry.play.events) {
      if (event.playerId !== "") continue;
      const kind = event.action === "rush" ? "rush" : event.action === "reception" ? "catch" : PASSES.has(event.action) ? "pass" : null;
      if (!kind) continue;
      const yards = event.yards;
      lines.push({ side: entry.play.offense, kind, yards, playId: entry.playId, text: `Unattributed ${kind}${yards === null ? "" : `: ${yards} yds`}` });
    }
  }
  return lines;
}
