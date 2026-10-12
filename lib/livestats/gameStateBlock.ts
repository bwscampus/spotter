import { STRIP_LABELS } from "./describe";
import { currentQbs } from "./check";
import { stateAfter } from "./gameState";
import { kickerFor, punterFor } from "./scoreboard";
import type { SessionPlay } from "./session";
import type { FootballStatKey } from "@/lib/cards/statKeys";
import type { FieldSpot, ReaderGameState, Side, StatsPlay, StatsRosterPlayer, TeamWords } from "./types";

// =============================================================================
// The game state the reader is told (Oct 11, Part 2). In the two audited games
// the facts that settled most mistakes were the score, the down and distance,
// where the ball was, who was at quarterback, who had kicked and who was out,
// and the reader saw none of them: it did not even know the team names, so it
// could not place "Georgia 30" in a half.
//
// Built from the plays already counted, exactly as the code already believes
// them (lib/livestats/gameState.ts for the ball, check.ts for the
// quarterbacks, scoreboard.ts for the kickers), rendered as a short block in
// the volatile part of every call, never the cached prefix. Unknown values are
// left out, not guessed, and the prompt says the transcript wins. Pure.
// =============================================================================

export interface GameStateInputs {
  teams?: TeamWords | null;
  /** Players marked out tonight (Part 3), by playerId. */
  out?: ReadonlySet<string> | readonly string[] | null;
  /**
   * The booth's accepted stat lines (fix 6, Part 1), handed in only for a
   * re-read (a drive, the half, a booth line, a gap), where they are facts
   * about the totals; the per-window calls do not carry them.
   */
  booth?: ReadonlyArray<{ seq: number; playerId: string; key: FootballStatKey; value: number }> | null;
}

/** The plays that still count, in read order, as the state reads them. */
function counted(plays: readonly SessionPlay[]): SessionPlay[] {
  return plays.filter((play) => play.status !== "discarded");
}

/** The ball as a yard line in a half, from yards off the offense's goal line. */
function spotFor(spot: number, offense: Side): FieldSpot {
  if (spot === 50) return { yardLine: 50, territory: "midfield" };
  const defense: Side = offense === "home" ? "away" : "home";
  return spot < 50 ? { yardLine: spot, territory: offense } : { yardLine: 100 - spot, territory: defense };
}

/** What the code believes about the game after these plays. */
export function readerGameState(plays: readonly SessionPlay[], roster: readonly StatsRosterPlayer[], inputs: GameStateInputs = {}): ReaderGameState {
  const live = counted(plays);
  const checked: StatsPlay[] = live.map((play) => play.play);
  const state: ReaderGameState = {};

  if (inputs.teams) state.teams = { home: inputs.teams.home.name, away: inputs.teams.away.name };

  for (let i = checked.length - 1; i >= 0; i--) {
    if (checked[i].quarter !== null) {
      state.quarter = checked[i].quarter!;
      break;
    }
  }
  for (let i = checked.length - 1; i >= 0; i--) {
    const score = checked[i].score;
    if (score) {
      state.score = { home: score.home, away: score.away };
      break;
    }
  }

  const ball = stateAfter(checked);
  if (ball.possession) {
    state.possession = ball.possession;
    if (ball.down !== null) state.down = ball.down;
    if (ball.distance !== null) state.distance = ball.distance;
    if (ball.spot !== null) state.spot = spotFor(ball.spot, ball.possession);
    else if (ball.ballLeftAt && ball.ballLeftAt.territory !== "unknown") state.spot = ball.ballLeftAt;
  }

  const outIds = new Set(inputs.out ? [...inputs.out] : []);
  const qbs = currentQbs(roster, checked, outIds);
  const known: Partial<Record<Side, string>> = {};
  for (const side of ["home", "away"] as const) if (qbs[side]) known[side] = qbs[side]!;
  if (Object.keys(known).length > 0) state.qbs = known;

  const sideOf = new Map(roster.map((player) => [player.playerId, player.side]));
  const kickers: Partial<Record<Side, string>> = {};
  const punters: Partial<Record<Side, string>> = {};
  for (const side of ["home", "away"] as const) {
    // Only a kicker already credited tonight is a fact; the roster's lone kicker is R32's guess, not the game's.
    const kicked = live.some((play) => play.play.events.some((event) => (event.action === "field_goal" || event.action === "extra_point") && sideOf.get(event.playerId) === side));
    const kicker = kicked ? kickerFor(side, live, roster, sideOf) : null;
    if (kicker) kickers[side] = kicker;
    const punter = punterFor(side, live, sideOf);
    if (punter) punters[side] = punter;
  }
  if (Object.keys(kickers).length > 0) state.kickers = kickers;
  if (Object.keys(punters).length > 0) state.punters = punters;

  const out = inputs.out ? [...inputs.out].filter((id) => sideOf.has(id)) : [];
  if (out.length > 0) state.out = [...new Set(out)].sort();

  if (inputs.booth && inputs.booth.length > 0) state.booth = inputs.booth.map((line) => ({ seq: line.seq, playerId: line.playerId, key: line.key, value: line.value }));

  return state;
}

function ordinal(down: number): string {
  return down === 1 ? "1st" : down === 2 ? "2nd" : down === 3 ? "3rd" : `${down}th`;
}

/**
 * The block as the reader reads it. One line per known thing; an empty string
 * when nothing is known, so the request carries no block at all.
 */
export function renderGameState(state: ReaderGameState): string {
  const lines: string[] = [];
  const name = (side: Side) => state.teams?.[side] ?? `the ${side} team`;
  if (state.teams) lines.push(`Home: ${state.teams.home}. Away: ${state.teams.away}.`);
  if (state.quarter !== undefined) lines.push(`Quarter: ${state.quarter > 4 ? "overtime" : state.quarter}.`);
  if (state.score) lines.push(`Score: ${name("home")} (home) ${state.score.home}, ${name("away")} (away) ${state.score.away}.`);
  if (state.possession) {
    const parts = [`${name(state.possession)} (${state.possession}) has the ball`];
    if (state.down !== undefined) parts.push(state.distance !== undefined ? `${ordinal(state.down)} and ${state.distance}` : `${ordinal(state.down)} down`);
    if (state.spot) {
      const where =
        state.spot.territory === "midfield" || state.spot.yardLine === 50
          ? "at midfield"
          : state.spot.territory === "unknown"
            ? `at the ${state.spot.yardLine}`
            : `at the ${name(state.spot.territory)} ${state.spot.yardLine}`;
      parts.push(where);
    }
    lines.push(`Ball: ${parts.join(", ")}.`);
  }
  if (state.qbs) {
    const who = (["home", "away"] as const).filter((side) => state.qbs?.[side]).map((side) => `${side} ${state.qbs![side]}`);
    if (who.length > 0) lines.push(`Quarterback on the field: ${who.join(", ")}.`);
  }
  if (state.kickers) {
    const who = (["home", "away"] as const).filter((side) => state.kickers?.[side]).map((side) => `${side} ${state.kickers![side]}`);
    if (who.length > 0) lines.push(`Last kicker used: ${who.join(", ")}.`);
  }
  if (state.punters) {
    const who = (["home", "away"] as const).filter((side) => state.punters?.[side]).map((side) => `${side} ${state.punters![side]}`);
    if (who.length > 0) lines.push(`Last punter used: ${who.join(", ")}.`);
  }
  if (state.out && state.out.length > 0) lines.push(`Out tonight, not playing, never credited: ${state.out.join(", ")}.`);
  if (state.booth && state.booth.length > 0) {
    // One line per player and transcript line: "H7-X: 14 CMP, 17 ATT, 181 PASS YDS (line 120)".
    const groups = new Map<string, typeof state.booth>();
    for (const line of state.booth) {
      const id = `${line.playerId}|${line.seq}`;
      groups.set(id, [...(groups.get(id) ?? []), line]);
    }
    lines.push("Running totals the booth read on air, which the totals follow (a play's yards are never a total):");
    for (const group of groups.values()) {
      lines.push(`  ${group[0].playerId}: ${group.map((line) => `${line.value} ${STRIP_LABELS[line.key]}`).join(", ")} (line ${group[0].seq})`);
    }
  }
  if (lines.length === 0) return "";
  return `GAME STATE\nWhat the code believes so far, from the plays already read. The transcript wins when they disagree.\n${lines.join("\n")}`;
}
