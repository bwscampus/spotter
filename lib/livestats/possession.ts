import type { ParsedLine } from "./parse";
import { bestHits } from "./parse/names";
import { wipedOut } from "./penalty";
import { hasGroup } from "./positions";
import type { PossessionFact } from "./stateMachine";
import type { Side, StatsEvent, StatsPlay, StatsRosterPlayer } from "./types";

// =============================================================================
// Who has the ball, from evidence (v7, fix 1, Part 3). Two pure pieces the
// reader (lib/livestats/v7.ts) feeds the tracker's timeline with:
//   voteOf:  the offensive players a segment's PLAY lines name, by roster
//            position: a quarterback counts 2, a running back, fullback,
//            receiver or tight end 1, a defender nothing; the side ahead, and
//            by how much. One misheard receiver (a margin of 1) is weak.
//   flipsOf: what the counted plays say about possession afterwards: a punt,
//            a kickoff with its returner, an interception, a lost fumble, a
//            field goal (made or missed), a turnover on downs, and a
//            touchdown once its try is in (the try stays with the scoring
//            side, so R32 finds its kicker).
// On Oct 20, 34 passes went to the other side's quarterback because the
// tracker took possession from the play's own offense, which the mapping had
// filled from the tracker.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A name this clear votes; a sound-alike two edits off does not. */
export const VOTE_NAME_SCORE = 0.8;

/** A margin this big decides the offense on its own; less only counts when nothing else says who has the ball. */
export const DECISIVE_VOTE = 2;

// =============================================================================

export interface Vote {
  side: Side;
  margin: number;
}

const other = (side: Side): Side => (side === "home" ? "away" : "home");

/** What one named player is worth to his side's vote. */
function weight(player: StatsRosterPlayer): number {
  if (hasGroup(player.position, "qb")) return 2;
  if (hasGroup(player.position, "skill")) return 1;
  return 0;
}

/**
 * The side the offensive players named in these lines are on, and by how
 * much; null for nobody or a tie. A quarterback named in `beforeSnap` (the
 * segment's PRE lines: "castellane in the shotgun") votes too (fix 1, item 4);
 * nobody else named there does.
 */
export function voteOf(lines: readonly ParsedLine[], roster: readonly StatsRosterPlayer[], beforeSnap: readonly ParsedLine[] = []): Vote | null {
  const players = new Map(roster.map((player) => [player.playerId, player]));
  const votes: Record<Side, number> = { home: 0, away: 0 };
  const named = bestHits(lines.flatMap((line) => oneSided(line, players))).filter((hit) => hit.score >= VOTE_NAME_SCORE);
  const ids = new Set(named.map((hit) => hit.playerId));
  const quarterbacks = bestHits(beforeSnap.flatMap((line) => oneSided(line, players))).filter((hit) => hit.score >= VOTE_NAME_SCORE && !ids.has(hit.playerId) && hasGroup(players.get(hit.playerId)?.position, "qb"));
  for (const hit of [...named, ...quarterbacks]) {
    const player = players.get(hit.playerId);
    if (player) votes[player.side] += weight(player);
  }
  if (votes.home === votes.away) return null;
  return votes.home > votes.away ? { side: "home", margin: votes.home - votes.away } : { side: "away", margin: votes.away - votes.home };
}

/**
 * A line's name hits, less any word that names players on both teams (a
 * surname both rosters have, a sound-alike of one on each): such a word
 * cannot say which side has the ball (fix 1, item 4: on the dev games three
 * surnames each named a defender on one side and a receiver on the other).
 */
function oneSided(line: ParsedLine, players: ReadonlyMap<string, StatsRosterPlayer>): ParsedLine["nameHits"] {
  const sidesAt = new Map<string, Set<Side>>();
  for (const hit of line.nameHits) {
    const side = players.get(hit.playerId)?.side;
    if (!side) continue;
    const key = `${hit.span[0]}-${hit.span[1]}`;
    sidesAt.set(key, (sidesAt.get(key) ?? new Set<Side>()).add(side));
  }
  return line.nameHits.filter((hit) => (sidesAt.get(`${hit.span[0]}-${hit.span[1]}`)?.size ?? 0) < 2);
}

/** The flips the counted plays imply, oldest first: from each play's last line on, this side has the ball. */
export function flipsOf(plays: ReadonlyArray<{ status: string; play: StatsPlay }>, roster: readonly StatsRosterPlayer[]): PossessionFact[] {
  const sides = new Map(roster.map((player) => [player.playerId, player.side]));
  const sideOf = (event: StatsEvent | undefined) => (event && event.playerId !== "" ? (sides.get(event.playerId) ?? null) : null);
  const counted = plays.filter((entry) => entry.status !== "discarded").map((entry) => entry.play).sort((a, b) => a.seqEnd - b.seqEnd);
  const flips: PossessionFact[] = [];
  const flip = (side: Side | null, play: StatsPlay) => {
    if (side) flips.push({ side, basis: "flip", seq: play.seqEnd });
  };
  /** The side that scored a touchdown whose try has not been counted yet. */
  let scored: Side | null = null;
  for (const play of counted) {
    if (wipedOut(play)) continue;
    const find = (action: StatsEvent["action"]) => play.events.find((event) => event.action === action && event.playerId !== "");
    const offense = play.offense;
    switch (play.playType) {
      case "punt": {
        const punter = sideOf(find("punt")) ?? offense;
        flip(punter ? other(punter) : null, play);
        scored = null;
        continue;
      }
      case "kickoff": {
        flip(sideOf(find("kick_return")), play);
        scored = null;
        continue;
      }
      case "extra_point":
      case "two_point": {
        const kicking = scored ?? sideOf(find("extra_point")) ?? offense;
        flip(kicking ? other(kicking) : null, play);
        scored = null;
        continue;
      }
      case "field_goal": {
        const kicker = sideOf(find("field_goal")) ?? offense;
        flip(kicker ? other(kicker) : null, play);
        continue;
      }
      default:
        break;
    }
    // A turnover: the side that came up with the ball.
    const intercepted = find("interception");
    const recovered = find("fumble_recovery");
    const lost = find("fumble");
    if (intercepted || find("pass_intercepted")) {
      flip(sideOf(intercepted) ?? (offense ? other(offense) : null), play);
      continue;
    }
    if (recovered && lost && sideOf(recovered) !== null && sideOf(recovered) !== sideOf(lost)) {
      flip(sideOf(recovered), play);
      continue;
    }
    if (play.touchdown) {
      // The try stays with the side that scored; the flip comes with it, or with the kickoff.
      scored = offense ?? sideOf(find("rush")) ?? sideOf(find("reception"));
      continue;
    }
    // Fourth down, short of the line to gain: the other side takes over.
    const gain = play.events.find((event) => (event.action === "rush" || event.action === "reception" || event.action === "sacked") && event.yards !== null);
    const yards = gain ? (gain.action === "sacked" ? -Math.abs(gain.yards!) : gain.yards!) : null;
    if (play.down === 4 && play.distance !== null && yards !== null && !play.firstDown && yards < play.distance && offense && (play.playType === "run" || play.playType === "pass" || play.playType === "sack")) {
      flip(other(offense), play);
    }
  }
  return flips;
}
