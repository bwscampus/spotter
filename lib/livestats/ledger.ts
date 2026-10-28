import type { Drive } from "./drives";
import { absoluteSpot, flagged, gainEvents, gainIs, type GameState } from "./gameState";
import { wipedOut } from "./penalty";
import type { FieldSpot, Side, StatsPlay } from "./types";

// =============================================================================
// The drive ledger (Oct 11, fix 6, Part 2, rule R43): the down, the distance
// and where the ball is at every snap of a drive, and each play's gain, worked
// out from every fact the booth said at once rather than one play at a time.
//
// On the audited broadcast, yards worked out from yard lines one play at a
// time were right 4 times and wrong 4 (the half guessed wrong, or where the
// ball was caught taken as where the play ended), while down-and-distance
// arithmetic went 6 for 6 and 32 plays were left blank. The facts of a drive
// pin each other: a spot said without its half has two readings, and the next
// down and distance, a first down said, a touchdown or a stated gain usually
// leaves only one of them standing.
//
// The model: positions x_0..x_n are the ball before each play from scrimmage
// and after the last, as yards from the offense's own goal line. Every fact is
// an edge between two positions, or between a position and the goal line:
//   - a stated gain (plus the flag's yards, when one was marked off), an
//     unflagged incompletion (0), a wiped-out play (its penalty yards), a
//     late-said number;
//   - the change in distance to go between two downs of one series (the line
//     to gain does not move: x_k + dist_k = x_i + dist_i);
//   - a stated shortfall ("4 yards shy");
//   - a yard line said exactly ("to the 22", "from the 28"), a touchdown (the
//     goal line), where a kick or turnover left the ball before the drive.
// Each edge has a weight (TUNING). Edges go in heaviest first, and an edge
// that contradicts the ones already in is broken and counted. A spot said
// approximately ("past the 30", "near the 40") never pins a gain: it only
// counts for or against a reading. Each half-less spot's two readings are
// tried together across the drive (up to MAX_HALF_COMBOS) and the reading that
// breaks the least weight wins; a tie prefers the reading no word contradicts
// ("big run" with a loss, "for a loss" with a gain); two readings still tied
// fill only the gains they agree on.
//
// What it fills (R43): a gain the facts pin, for a play nobody said a number
// for, marked estimated with source "ledger"; never a stated yard. A stated
// yard the facts contradict is noted and kept. It also says what the next snap
// looks like (the GAME STATE block) and where the downs say a snap was missed
// (Part 3). Pure.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A number the booth said for the play. The strongest fact: on the audited game 46 right, 1 wrong. */
export const STATED_WEIGHT = 10;

/** A touchdown ends at the goal line; an unflagged incomplete pass moves nothing. Rules of football. */
export const RULE_WEIGHT = 10;

/** The change in distance between two downs of one series: 6 for 6 on the audited game. */
export const DOWNS_WEIGHT = 8;

/** A shortfall said in words ("4 yards shy of the first down"). Said about this play, but easy to mishear. */
export const SHORT_BY_WEIGHT = 7;

/**
 * A number said a line or two after the play ("for 11"): right 2, wrong 2 on
 * the audited game before the stat-talk filter, so it yields to the downs and
 * to a pair of yard lines.
 */
export const LATE_YARDS_WEIGHT = 6;

/** A yard line said exactly, in a known half. Right when the half is right; the half is what the readings decide. */
export const EXACT_SPOT_WEIGHT = 5;

/**
 * A figure the reader worked out itself from two yard lines or from a phrase
 * ("picks up a couple", yardsSource "spots" or "phrase"). The reader's
 * evidence, kept unless the drive's facts contradict it, and weighed like one
 * yard line.
 */
export const READER_WORKED_WEIGHT = 5;

/** A flag's yards as marked off, moving the ball with no play. */
export const PENALTY_WEIGHT = 5;

/** Where a kick, a return or a turnover left the ball before the drive: usually right, sometimes a return the reader missed. */
export const CARRIED_SPOT_WEIGHT = 4;

/** A first down said ("moves the chains") means the gain reached the distance; a sack is a loss. Checked against the gains, never a fill. */
export const FIRST_DOWN_WEIGHT = 4;
export const SACK_WEIGHT = 4;

/**
 * A yard line said approximately ("past the 30", "near the 40", "inside the
 * 10"): within this many yards, and it never pins a gain, because it usually
 * says where the ball was caught rather than where the play ended.
 */
export const APPROX_SPOT_YARDS = 5;
export const APPROX_SPOT_WEIGHT = 2;

/**
 * How many readings of a drive's half-less spots are tried at once: 64 is six
 * spots, more than a drive usually has. Past that, the spots furthest from a
 * known-half anchor are fixed by the reading nearer that anchor.
 */
export const MAX_HALF_COMBOS = 64;

/**
 * A worked-out gain past this is left blank. Longer than R23's 40, because the
 * half is now chosen against the whole drive, but past 60 a wrong anchor is
 * likelier than a play that long.
 */
export const MAX_LEDGER_GAIN_YARDS = 60;

/**
 * Two readings that break the same facts and contradict no words still differ
 * in how far they say the ball went. When that difference is more than this,
 * the nearer reading wins ("from the 20 to the 26" is 6, not 54, with nothing
 * else said); within it, both fit equally well and nothing is filled.
 */
export const NEARER_READING_MARGIN = 20;

// =============================================================================

/** What the words around a play say about its gain, for the tie-break. */
export interface PlayHints {
  saysGain?: boolean;
  saysLoss?: boolean;
  /** A number said a line or two after the play as its gain (lib/livestats/gameState.ts lateStatedYards), when there is one. */
  lateYards?: number | null;
}

export interface LedgerPlay {
  playId: string;
  play: StatsPlay;
  hints?: PlayHints;
}

export interface LedgerGain {
  /** The gain the facts pin, or null. */
  gain: number | null;
  pinned: boolean;
  /** The play's stated yards do not fit the other facts. Noted, never changed. */
  brokenStated: boolean;
  /** The late-said number does not fit the facts and should not be used. */
  brokenLate: boolean;
  /** The late-said number fits, and may be written as the play's gain. */
  lateFits: boolean;
  /** The reader's own worked-out figure (yardsSource "spots" or "phrase") does not fit the facts. */
  brokenReader: boolean;
}

/** The next snap as the ledger sees it, for the GAME STATE block. */
export interface LedgerNext {
  down: number | null;
  distance: number | null;
  /** Yards from the offense's goal line, or null. */
  spot: number | null;
  /** The spot was said (an exact yard line in a known half) rather than worked out. */
  spotSaid: boolean;
}

/** A snap the downs say was run between two counted plays and never read (Part 3). */
export interface LedgerGap {
  offense: Side;
  /** The play before the gap, or null when the gap is at the drive's start. */
  beforeId: string | null;
  afterId: string;
  before: { down: number | null; distance: number | null; spot: number | null };
  after: { down: number | null; distance: number | null; spot: number | null };
  /** The yards the missing snap must have gained, when the facts pin them. */
  yards: number | null;
  /** How many snaps the downs skipped. */
  snaps: number;
}

export interface DriveSolution {
  gains: Map<string, LedgerGain>;
  next: LedgerNext | null;
  gaps: LedgerGap[];
  /** The weight of the facts the winning reading breaks. */
  broken: number;
  /** Two readings tied and only their shared gains are filled. */
  tied: boolean;
}

// -----------------------------------------------------------------------------
// The facts of a drive, as edges.
// -----------------------------------------------------------------------------

const GROUND = -1;

interface Edge {
  /** Positions, or GROUND for the goal line. x_b = x_a + value. */
  a: number;
  b: number;
  value: number;
  weight: number;
  /** Which play's stated, late or reader-worked-out number this is, so a break can be reported on it. */
  stated?: string;
  late?: string;
  reader?: string;
  /** An approximate spot: scored within APPROX_SPOT_YARDS, never joined. */
  soft?: boolean;
}

/** A half-less spot, with its two readings. */
interface Reading {
  node: number;
  yardLine: number;
  weight: number;
  soft: boolean;
}

interface Inequality {
  play: number;
  kind: "firstDown" | "loss";
  distance: number;
  weight: number;
}

const DOWN_KEEPING: ReadonlySet<StatsPlay["playType"]> = new Set(["penalty_only"]);

/** The plays the ledger places: everything but the try after a touchdown. The kick that ends a drive anchors its last position. */
function scrimmageOf<P extends LedgerPlay>(drive: Drive<P & { status: string }>): { plays: P[]; kick: P | null } {
  const all = drive.plays.filter((entry) => entry.play.playType !== "extra_point" && entry.play.playType !== "two_point");
  const last = all[all.length - 1];
  const kick = last && (last.play.playType === "punt" || last.play.playType === "field_goal") ? last : null;
  return { plays: kick ? all.slice(0, -1) : all, kick };
}

/** A flag's yards, signed for the offense; null when a flag's yards were not said; 0 with no flag. */
function penaltyYards(play: StatsPlay): number | null {
  const penalty = play.penalty;
  if (!penalty || !flagged(play)) return 0;
  if (typeof penalty.penaltyYards !== "number") return null;
  if (penalty.on === "offense") return -penalty.penaltyYards;
  if (penalty.on === "defense") return penalty.penaltyYards;
  return null;
}

/** The signed gain an event carries: a sack is a loss. */
function signedGain(play: StatsPlay): number | null {
  const event = gainEvents(play).find((each) => each.yards !== null);
  if (!event || event.yards === null) return null;
  return event.action === "sacked" || event.action === "sack" ? -Math.abs(event.yards) : event.yards;
}

/** An incomplete pass and nothing else that moved the ball. */
function isIncompletion(play: StatsPlay): boolean {
  const moved = new Set(["pass_complete", "reception", "pass_intercepted", "interception", "sacked", "sack", "rush", "fumble", "fumble_recovery", "kick_return", "punt_return"]);
  return play.events.some((event) => event.action === "pass_incomplete") && !play.events.some((event) => moved.has(event.action));
}

function isSack(play: StatsPlay): boolean {
  return play.playType === "sack" || play.events.some((event) => event.action === "sacked" || event.action === "sack");
}

/** Whether the gain was said late (the code wrote it from a line after the play), by the mark R23 leaves on the event. */
function lateGain(play: StatsPlay): boolean {
  return gainEvents(play).some((event) => event.yards !== null && event.late === true);
}

/** The sources that are the reader's own figure (v6): two yard lines or a phrase it read. */
export const READER_SOURCES: ReadonlySet<string> = new Set(["spots", "phrase"]);

/** v7 (Part 6): the yards solver's figures count as the reader's own too, kept unless the drive's facts contradict them. */
export const SOLVER_SOURCES: ReadonlySet<string> = new Set(["spots", "phrase", "downs"]);

/** Whether the play's worked-out gain is the reader's own (from two yard lines or a phrase it read), not the code's. */
export function readerWorked(play: StatsPlay, sources: ReadonlySet<string> = READER_SOURCES): boolean {
  return gainEvents(play).some((event) => event.yards !== null && event.yardsSource !== null && sources.has(event.yardsSource));
}

/** Whether the play keeps the down: a flag with no play, or a play a flag wiped out. */
function keepsDown(play: StatsPlay): boolean {
  return DOWN_KEEPING.has(play.playType) || wipedOut(play);
}

interface Facts {
  edges: Edge[];
  readings: Reading[];
  inequalities: Inequality[];
  /** Whether each play's movement (gain plus flag yards) is known, by index. */
  n: number;
}

function spotEdge(node: number, spot: FieldSpot, offense: Side, weight: number, readings: Reading[], edges: Edge[]) {
  const soft = spot.approximate === true;
  const w = soft ? APPROX_SPOT_WEIGHT : weight;
  const abs = absoluteSpot(spot, offense);
  if (abs !== null) edges.push({ a: GROUND, b: node, value: abs, weight: w, ...(soft ? { soft: true } : {}) });
  else if (spot.territory === "unknown" && spot.yardLine !== 50) readings.push({ node, yardLine: spot.yardLine, weight: w, soft });
}

/** Every fact of the drive as edges, readings to enumerate, and inequalities to check. */
function factsOf(plays: readonly LedgerPlay[], kick: LedgerPlay | null, offense: Side, before: GameState): Facts {
  const edges: Edge[] = [];
  const readings: Reading[] = [];
  const inequalities: Inequality[] = [];
  const n = plays.length;

  // Where the ball was left for this drive.
  if (before.ballLeftAt) {
    const abs = absoluteSpot(before.ballLeftAt, offense);
    if (abs !== null) edges.push({ a: GROUND, b: 0, value: abs, weight: CARRIED_SPOT_WEIGHT });
  }

  plays.forEach((entry, i) => {
    const play = entry.play;
    const pen = penaltyYards(play);
    if (play.startSpot) spotEdge(i, play.startSpot, offense, EXACT_SPOT_WEIGHT, readings, edges);
    if (play.touchdown && !wipedOut(play)) edges.push({ a: GROUND, b: i + 1, value: 100, weight: RULE_WEIGHT });
    // An incomplete pass moves nothing, so a yard line said in its lines is not where it ended: its start spot is all it says.
    else if (play.endSpot && !(isIncompletion(play) && !flagged(play))) spotEdge(i + 1, play.endSpot, offense, EXACT_SPOT_WEIGHT, readings, edges);

    // The movement on this play: its gain plus the flag's yards.
    if (wipedOut(play) || play.playType === "penalty_only") {
      if (pen !== null) edges.push({ a: i, b: i + 1, value: pen, weight: PENALTY_WEIGHT });
    } else if (isIncompletion(play) && !flagged(play)) {
      edges.push({ a: i, b: i + 1, value: 0, weight: RULE_WEIGHT });
    } else {
      const gain = signedGain(play);
      const kind = gainIs(play);
      if (gain !== null && kind === "stated" && pen !== null) {
        const late = lateGain(play);
        edges.push({ a: i, b: i + 1, value: gain + pen, weight: late ? LATE_YARDS_WEIGHT : STATED_WEIGHT, ...(late ? { late: entry.playId } : { stated: entry.playId }) });
      } else if (gain !== null && kind === "estimated" && readerWorked(play) && pen !== null) {
        edges.push({ a: i, b: i + 1, value: gain + pen, weight: READER_WORKED_WEIGHT, reader: entry.playId });
      } else if (kind !== "stated" && typeof entry.hints?.lateYards === "number" && pen !== null) {
        edges.push({ a: i, b: i + 1, value: entry.hints.lateYards + pen, weight: LATE_YARDS_WEIGHT, late: entry.playId });
      }
      if (kind !== "stated" && play.distance !== null && typeof play.shortBy === "number" && pen !== null) {
        edges.push({ a: i, b: i + 1, value: play.distance - play.shortBy + pen, weight: SHORT_BY_WEIGHT });
      }
      if (play.distance !== null && (play.firstDown || nextIsFirstDown(plays, i))) inequalities.push({ play: i, kind: "firstDown", distance: play.distance, weight: FIRST_DOWN_WEIGHT });
      if (isSack(play)) inequalities.push({ play: i, kind: "loss", distance: 0, weight: SACK_WEIGHT });
    }

    // The next down of the same series: the line to gain does not move, so
    // the ball moved by the change in distance. The next play with a distance
    // said, whose down is this one's plus the snaps between (a flag with no
    // play or a wiped-out play keeps the down; its own down and distance were
    // true at its snap, so it counts as a position like any other).
    if (play.down !== null && play.distance !== null) {
      const from = describes(plays, i);
      let snaps = keepsDown(play) ? 0 : 1;
      for (let k = i + 1; k < plays.length; k++) {
        const next = plays[k].play;
        if (next.offense !== null && next.offense !== offense) break;
        if (next.down !== null && next.distance !== null) {
          const to = describes(plays, k);
          if (next.down === play.down + snaps && to > from) edges.push({ a: from, b: to, value: play.distance - next.distance, weight: DOWNS_WEIGHT });
          break;
        }
        if (next.down !== null && next.down !== play.down + snaps) break;
        if (!keepsDown(next)) snaps += 1;
      }
    }
  });

  // The kick that ended the drive was snapped where the last play left the ball.
  if (kick?.play.startSpot) spotEdge(n, kick.play.startSpot, offense, EXACT_SPOT_WEIGHT, readings, edges);

  return { edges, readings, inequalities, n };
}

/**
 * The position a play's down and distance describe: the snap itself for a
 * play from scrimmage or a wiped-out play (true when the ball was snapped),
 * the ball after the flag for a flag with no play ("1st and 15" is said once
 * the yards are marked off).
 */
function describes(plays: readonly LedgerPlay[], i: number): number {
  return plays[i].play.playType === "penalty_only" ? i + 1 : i;
}

/**
 * Whether the very next play is a snap at first down, so play i reached the
 * line to gain. A flag with no play or a wiped-out play between them replays
 * the down instead, and says nothing about play i.
 */
function nextIsFirstDown(plays: readonly LedgerPlay[], i: number): boolean {
  const next = plays[i + 1]?.play;
  return next !== undefined && !keepsDown(next) && next.down === 1 && next.offense === plays[i].play.offense;
}

// -----------------------------------------------------------------------------
// Solving one reading.
// -----------------------------------------------------------------------------

/** Union-find with offsets: x_node = x_root + diff[node]. */
class Positions {
  private readonly parent: number[];
  private readonly diff: number[];
  constructor(count: number) {
    // Index 0 is the ground; node i is at i + 1.
    this.parent = Array.from({ length: count + 1 }, (_, i) => i);
    this.diff = Array.from({ length: count + 1 }, () => 0);
  }
  private find(node: number): { root: number; offset: number } {
    let offset = 0;
    let current = node;
    while (this.parent[current] !== current) {
      offset += this.diff[current];
      current = this.parent[current];
    }
    return { root: current, offset };
  }
  /** Adds x_b = x_a + value. True when it fits (already implied or newly joined), false when it contradicts. */
  join(a: number, b: number, value: number, tolerance = 0, soft = false): boolean {
    const A = this.find(a + 1);
    const B = this.find(b + 1);
    if (A.root === B.root) return Math.abs(B.offset - A.offset - value) <= tolerance;
    if (soft) return true;
    // x_b = x_a + value; x_a = rootA + A.offset; x_b = rootB + B.offset  =>  rootB = rootA + A.offset + value - B.offset
    this.parent[B.root] = A.root;
    this.diff[B.root] = A.offset + value - B.offset;
    return true;
  }
  /** x_b - x_a when both are connected, else null. */
  between(a: number, b: number): number | null {
    const A = this.find(a + 1);
    const B = this.find(b + 1);
    return A.root === B.root ? B.offset - A.offset : null;
  }
  /** The position from the goal line, when anchored. */
  at(node: number): number | null {
    return this.between(GROUND, node);
  }
}

interface Solved {
  positions: Positions;
  broken: number;
  brokenStated: Set<string>;
  brokenLate: Set<string>;
  brokenReader: Set<string>;
  contradicted: number;
  gains: Map<number, number>;
  /** How far the gains say the ball went in all, for the nearer-reading tie-break. */
  magnitude: number;
}

function solveReading(facts: Facts, plays: readonly LedgerPlay[], chosen: Edge[]): Solved {
  const positions = new Positions(facts.n + 1);
  const all = [...facts.edges, ...chosen].sort((a, b) => b.weight - a.weight);
  let broken = 0;
  const brokenStated = new Set<string>();
  const brokenLate = new Set<string>();
  const brokenReader = new Set<string>();
  const held: Edge[] = [];
  const brokenAnchors: Edge[] = [];
  const breaks = (edge: Edge) => {
    broken += edge.weight;
    if (edge.stated) brokenStated.add(edge.stated);
    if (edge.late) brokenLate.add(edge.late);
    if (edge.reader) brokenReader.add(edge.reader);
  };
  // The hard facts first, heaviest first; an edge that contradicts them is broken.
  for (const edge of all) {
    if (edge.soft) continue;
    if (positions.join(edge.a, edge.b, edge.value)) {
      if (edge.a === GROUND) held.push(edge);
    } else {
      breaks(edge);
      if (edge.a === GROUND) brokenAnchors.push(edge);
    }
  }
  // Then the approximate spots: scored within their tolerance where the hard
  // facts already place the ball, and the only anchor where nothing else does.
  for (const edge of all) {
    if (!edge.soft) continue;
    if (positions.at(edge.b) !== null) {
      if (!positions.join(edge.a, edge.b, edge.value, APPROX_SPOT_YARDS, true)) breaks(edge);
    } else positions.join(edge.a, edge.b, edge.value);
  }
  const edges = all;
  // A yard line said exactly that the gains said between it and the nearest
  // yard line that held cannot reach: the stated yards in that stretch are
  // noted (never changed), and a late number there is taken back.
  for (const anchor of brokenAnchors) {
    const nearest = held.filter((edge) => positions.between(edge.b, anchor.b) !== null).reduce<Edge | null>((best, edge) => (best === null || Math.abs(edge.b - anchor.b) < Math.abs(best.b - anchor.b) ? edge : best), null);
    if (!nearest) continue;
    const from = Math.min(nearest.b, anchor.b);
    const to = Math.max(nearest.b, anchor.b);
    for (const edge of edges) {
      if (edge.a === GROUND || edge.a < from || edge.b > to) continue;
      if (edge.stated) brokenStated.add(edge.stated);
      if (edge.late) brokenLate.add(edge.late);
    }
  }
  const gains = new Map<number, number>();
  plays.forEach((entry, i) => {
    const movement = positions.between(i, i + 1);
    const pen = penaltyYards(entry.play);
    if (movement === null || pen === null) return;
    gains.set(i, movement - pen);
  });
  let contradicted = 0;
  for (const check of facts.inequalities) {
    const gain = gains.get(check.play);
    if (gain === undefined) continue;
    if (check.kind === "firstDown" && gain < check.distance) {
      broken += check.weight;
      contradicted += 1;
    }
    if (check.kind === "loss" && gain >= 0) {
      broken += check.weight;
      contradicted += 1;
    }
  }
  // The words' tie-break: a gain where the booth said a loss, a loss where it said a gain.
  let magnitude = 0;
  for (const [i, gain] of gains) {
    magnitude += Math.abs(gain);
    const hints = plays[i].hints;
    if (!hints) continue;
    if (hints.saysLoss && !hints.saysGain && gain >= 0) contradicted += 1;
    if (hints.saysGain && !hints.saysLoss && gain <= 0) contradicted += 1;
  }
  return { positions, broken, brokenStated, brokenLate, brokenReader, contradicted, gains, magnitude };
}

/** Negative when `a` is the better reading, positive when `b` is, 0 for a tie. */
function compareReadings(a: Solved, b: Solved): number {
  if (a.broken !== b.broken) return a.broken - b.broken;
  if (a.contradicted !== b.contradicted) return a.contradicted - b.contradicted;
  if (Math.abs(a.magnitude - b.magnitude) > NEARER_READING_MARGIN) return a.magnitude - b.magnitude;
  return 0;
}

/** Both readings of a half-less spot, as ground edges. */
function readingEdges(reading: Reading): [Edge, Edge] {
  const own: Edge = { a: GROUND, b: reading.node, value: reading.yardLine, weight: reading.weight, ...(reading.soft ? { soft: true } : {}) };
  const theirs: Edge = { ...own, value: 100 - reading.yardLine };
  return [own, theirs];
}

/**
 * The reading nearer a known-half anchor, for spots past the enumeration cap:
 * the nearest ground edge by position, else nothing.
 */
function nearerReading(reading: Reading, facts: Facts): Edge | null {
  const anchors = facts.edges.filter((edge) => edge.a === GROUND && !edge.soft);
  if (anchors.length === 0) return null;
  const nearest = anchors.reduce((best, edge) => (Math.abs(edge.b - reading.node) < Math.abs(best.b - reading.node) ? edge : best));
  const [own, theirs] = readingEdges(reading);
  return Math.abs(own.value - nearest.value) <= Math.abs(theirs.value - nearest.value) ? own : theirs;
}

// -----------------------------------------------------------------------------
// The drive, solved.
// -----------------------------------------------------------------------------

/**
 * One drive, every reading tried, the best kept. `before` is the state before
 * the drive's first play (for where a kick or turnover left the ball).
 */
export function solveDrive<P extends LedgerPlay & { status: string }>(drive: Drive<P>, before: GameState): DriveSolution {
  const { plays, kick } = scrimmageOf(drive);
  const offense = drive.offense;
  const facts = factsOf(plays, kick, offense, before);

  // Which half-less spots to enumerate, and which to fix by their nearer anchor.
  const budget = Math.floor(Math.log2(MAX_HALF_COMBOS));
  const enumerated = facts.readings.slice(0, budget);
  const fixed = facts.readings
    .slice(budget)
    .map((reading) => nearerReading(reading, facts))
    .filter((edge): edge is Edge => edge !== null);

  let best: Solved[] = [];
  const combos = 1 << enumerated.length;
  for (let mask = 0; mask < combos; mask++) {
    const chosen = enumerated.map((reading, index) => readingEdges(reading)[(mask >> index) & 1]);
    const solved = solveReading(facts, plays, [...fixed, ...chosen]);
    const order = best.length === 0 ? -1 : compareReadings(solved, best[0]);
    if (order < 0) best = [solved];
    else if (order === 0) best.push(solved);
  }
  const winner = best[0];
  const tied = best.length > 1;

  const gains = new Map<string, LedgerGain>();
  plays.forEach((entry, i) => {
    const values = best.map((solved) => solved.gains.get(i));
    const agreed = values.every((value) => value !== undefined && value === values[0]);
    const gain = agreed && values[0] !== undefined && Math.abs(values[0]) <= MAX_LEDGER_GAIN_YARDS ? values[0] : null;
    const stated = gainIs(entry.play) === "stated" && !lateGain(entry.play);
    const brokenLate = best.every((solved) => solved.brokenLate.has(entry.playId));
    gains.set(entry.playId, {
      gain,
      pinned: gain !== null,
      brokenStated: stated && best.every((solved) => solved.brokenStated.has(entry.playId)),
      brokenLate,
      lateFits: !brokenLate && (lateGain(entry.play) || typeof entry.hints?.lateYards === "number"),
      brokenReader: best.every((solved) => solved.brokenReader.has(entry.playId)),
    });
  });

  const next = drive.endedBy === null && plays.length > 0 && !tied ? nextSnap_(plays, winner, facts) : null;
  return { gains, next, gaps: gapsOf(plays, offense, winner, before), broken: winner.broken, tied };
}

/** The next snap after the last play: its down and distance by the series rules, and the ball when it is anchored. */
function nextSnap_(plays: readonly LedgerPlay[], solved: Solved, facts: Facts): LedgerNext {
  const n = plays.length;
  const last = plays[n - 1].play;
  const spot = solved.positions.at(n);
  const spotSaid = spot !== null && facts.edges.some((edge) => edge.a === GROUND && edge.b === n && !edge.soft && edge.value === spot && edge.weight === EXACT_SPOT_WEIGHT);
  let down: number | null = null;
  let distance: number | null = null;
  if (keepsDown(last)) {
    down = last.down;
    distance = last.distance;
  } else if (last.down !== null) {
    const gain = solved.gains.get(n - 1) ?? null;
    const made = last.firstDown || (gain !== null && last.distance !== null && gain >= last.distance);
    if (made) {
      down = 1;
      distance = spot !== null ? Math.min(10, 100 - spot) : 10;
    } else if (last.down < 4) {
      down = last.down + 1;
      distance = last.distance !== null && gain !== null ? last.distance - gain : null;
    }
  }
  return { down, distance, spot, spotSaid };
}

/**
 * Where the downs say a snap was missed (Part 3): a drive whose first snap is
 * not first down, or two snaps in a row whose downs are not consecutive (a
 * first down made is followed by 1st; otherwise by the down plus one).
 */
function gapsOf(plays: readonly LedgerPlay[], offense: Side, solved: Solved, before: GameState): LedgerGap[] {
  const gaps: LedgerGap[] = [];
  const snaps = plays.map((entry, index) => ({ entry, index })).filter(({ entry }) => !keepsDown(entry.play));
  if (snaps.length === 0) return gaps;

  const first = snaps[0];
  // A fresh possession (a kick or turnover left the ball) whose first snap is a later down.
  if (before.ballLeftAt && first.entry.play.down !== null && first.entry.play.down > 1) {
    const spot = absoluteSpot(before.ballLeftAt, offense);
    const after = solved.positions.at(first.index);
    gaps.push({
      offense,
      beforeId: null,
      afterId: first.entry.playId,
      before: { down: 1, distance: spot !== null ? Math.min(10, 100 - spot) : 10, spot },
      after: { down: first.entry.play.down, distance: first.entry.play.distance, spot: after },
      yards: spot !== null && after !== null ? after - spot : first.entry.play.distance !== null && first.entry.play.down === 2 ? 10 - first.entry.play.distance : null,
      snaps: first.entry.play.down - 1,
    });
  }

  for (let s = 0; s + 1 < snaps.length; s++) {
    const here = snaps[s];
    const next = snaps[s + 1];
    const play = here.entry.play;
    if (play.down === null || next.entry.play.down === null) continue;
    const gain = solved.gains.get(here.index) ?? null;
    // Whether the play reached the line to gain: said, shown by the gain, or unknown.
    const made: boolean | null = play.firstDown ? true : gain !== null && play.distance !== null ? gain >= play.distance : null;
    const expected = made === true ? [1] : made === false ? (play.down < 4 ? [play.down + 1] : []) : play.down < 4 ? [play.down + 1, 1] : [1];
    if (expected.length === 0) continue;
    const got = next.entry.play.down;
    if (expected.includes(got)) continue;
    // A down past one the downs expected: that many snaps were never read. A
    // down before every expected one is a misread, not a missed snap.
    const from = expected.filter((down) => down < got).sort((a, b) => b - a)[0];
    if (from === undefined) continue;
    const missing = got - from;
    const madeHere = from === 1;
    const spotBefore = solved.positions.at(here.index + 1);
    const spotAfter = solved.positions.at(next.index);
    const distanceBefore = madeHere ? (spotBefore !== null ? Math.min(10, 100 - spotBefore) : 10) : play.distance !== null && gain !== null ? play.distance - gain : null;
    let yards: number | null = spotBefore !== null && spotAfter !== null ? spotAfter - spotBefore : null;
    if (yards === null && missing === 1 && distanceBefore !== null && next.entry.play.distance !== null) yards = distanceBefore - next.entry.play.distance;
    gaps.push({
      offense,
      beforeId: here.entry.playId,
      afterId: next.entry.playId,
      before: { down: from, distance: distanceBefore, spot: spotBefore },
      after: { down: got, distance: next.entry.play.distance, spot: spotAfter },
      yards,
      snaps: missing,
    });
  }
  return gaps;
}
