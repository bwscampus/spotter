import type { FootballStatKey, FootballStats } from "@/lib/cards/statKeys";
import type { TonightTally } from "@/lib/cards/tonight";
import { wipedOut } from "./penalty";
import type { Action, RuleId, Side, StatsEvent, StatsPlay, StatsRosterPlayer } from "./types";

// =============================================================================
// The stat rules. docs/V3_DEFINITION.md 8.3.
//
// Claude only says who did what. This turns that into numbers, and it is the
// only place that does: a pure function, so every rule has a test and none of
// them can drift with the prompt.
//
// Tonight's totals are never kept as a running count. tonightTotals works them
// out from the whole list of applied plays every time, so undoing a play is
// dropping it from the list, and the totals afterwards are exactly what they
// would have been if it had never been applied (spec 8.6).
//
// Every event that does not count comes back with the rule that dropped it,
// because that is what the browser log and the NFL comparison read.
// =============================================================================

/** One player's share of one play: what to add, and what is worked out rather than said. */
export interface PlayerDelta {
  playerId: string;
  /**
   * Increments on the 9.2 keys, signed (a sacked quarterback's rush_yds goes
   * down). One exception: fg_long is the length of this play's made field goal,
   * and totals take the longest rather than adding.
   */
  stats: FootballStats;
  /** Yards figures in this delta that came from yard lines or phrasing (R8). Shown with a ~. */
  estimated: FootballStatKey[];
  /** An action that has yards had none known. The attempt counts; the strip says "YDS ?" (R8). */
  yardsUnknown: boolean;
  /** Which yards figures were not known, so the strip can offer each one to be filled in. */
  unknownYards: FootballStatKey[];
}

export interface DroppedEvent {
  event: StatsEvent;
  rule: RuleId;
  /** Plain words for the log. */
  reason: string;
}

export interface AppliedPlay {
  play: StatsPlay;
  deltas: PlayerDelta[];
  dropped: DroppedEvent[];
  /** Some player on this play had yards that were not known. */
  yardsUnknown: boolean;
}

/** Both rosters, by playerId. A list works too and is indexed on the way in. */
export type Roster = ReadonlyMap<string, StatsRosterPlayer> | readonly StatsRosterPlayer[];

// -----------------------------------------------------------------------------
// Which actions mean what, for the rules below.
// -----------------------------------------------------------------------------

/**
 * Someone had the ball and could be brought down (R3): a run, a catch, a
 * return, a sack, or a turnover being returned. pass_complete counts even
 * without a named catcher, because a completion means somebody caught it.
 */
const BALL_CARRIER_ACTIONS: ReadonlySet<Action> = new Set([
  "rush",
  "reception",
  "pass_complete",
  "kick_return",
  "punt_return",
  "sacked",
  "sack",
  "interception",
  "fumble_recovery",
]);

/** Play types that had a ball carrier whether or not the announcer named him. */
const BALL_CARRIER_PLAYS: ReadonlySet<StatsPlay["playType"]> = new Set(["run", "sack"]);

/** On these plays nobody was tackled: the pass fell incomplete or was broken up (R2). */
const NO_CARRIER_ACTIONS: ReadonlySet<Action> = new Set(["pass_incomplete", "pass_breakup"]);

/** Whoever ended the play holding the ball, most final first, for touchdowns (R10). */
const SCORER_ORDER: readonly Action[] = ["fumble_recovery", "interception", "kick_return", "punt_return", "reception", "rush"];

/** The touchdown key for each way of scoring. */
const TD_KEY: Partial<Record<Action, FootballStatKey>> = {
  fumble_recovery: "fr_td",
  interception: "int_td",
  kick_return: "kr_td",
  punt_return: "pr_td",
  reception: "rec_td",
  rush: "rush_td",
};

// -----------------------------------------------------------------------------

/**
 * One play's numbers, by the rules in spec 8.3.
 *
 * Which events count is decided first, in rule order, and the first rule that
 * drops an event is the one it is logged under. Then each event that counts is
 * credited, and then the touchdown.
 */
export function applyPlay(play: StatsPlay, roster: Roster): AppliedPlay {
  const players = index(roster);
  const dropped: DroppedEvent[] = [];
  const counted: StatsEvent[] = [];

  // What the play was, from everything Claude said about it, including events
  // about to be dropped: a breakup by a player who is not on the roster still
  // means the pass was broken up.
  const actions = new Set(play.events.map((event) => event.action));
  const noCarrier = [...NO_CARRIER_ACTIONS].some((action) => actions.has(action));
  const hadCarrier = BALL_CARRIER_PLAYS.has(play.playType) || [...BALL_CARRIER_ACTIONS].some((action) => actions.has(action));
  const intercepted = actions.has("interception") || actions.has("pass_intercepted");
  const sackers = new Set(play.events.filter((event) => event.action === "sack").map((event) => event.playerId));

  for (const event of play.events) {
    const drop = (rule: RuleId, reason: string) => dropped.push({ event, rule, reason });
    if (wipedOut(play)) drop("R7", "the play was wiped out by a penalty");
    else if (play.playType === "two_point") drop("R11", "a two-point try adds nothing");
    else if (event.action === "punt" && play.playType === "kickoff") drop("R31", "a kickoff is not a punt");
    else if (event.playerId === "") drop("R9", "nobody could be read for this");
    else if (!players.has(event.playerId)) drop("R9", "not on either roster");
    else if (event.action === "tackle" && noCarrier) drop("R2", "nobody to tackle on an incomplete pass or a breakup");
    else if (event.action === "tackle" && !hadCarrier) drop("R3", "a tackle needs a ball carrier");
    else if (event.action === "tackle" && sackers.has(event.playerId)) drop("R4", "the sack already counts as his tackle");
    else if ((event.action === "reception" || event.action === "pass_complete") && intercepted) {
      drop("R5", "an intercepted pass is nobody's completion");
    } else counted.push(event);
  }

  // Every event that reaches here is on the roster (R9 ran above).
  const credit = new Credit();
  const sackCount = counted.filter((event) => event.action === "sack").length;

  for (const event of counted) {
    const id = event.playerId;
    // An event the check filled in or guessed at (lib/livestats/check.ts) is
    // an estimate through and through: every number it adds carries the ~.
    const est = event.estimated === true;
    switch (event.action) {
      // R1: only a rush makes a carry. Nothing else below touches rush_att,
      // except the sacked quarterback, which is R4's high school rule.
      case "rush":
        credit.add(id, "rush_att", 1, est);
        credit.yards(id, "rush_yds", own(event), est);
        break;
      case "pass_complete":
        credit.add(id, "pass_att", 1, est);
        credit.add(id, "pass_cmp", 1, est);
        credit.yards(id, "pass_yds", own(event) ?? partner(play, "reception"), est);
        break;
      case "pass_incomplete":
        credit.add(id, "pass_att", 1, est);
        break;
      // R5: the passer threw it and threw it away.
      case "pass_intercepted":
        credit.add(id, "pass_att", 1, est);
        credit.add(id, "pass_int", 1, est);
        break;
      case "reception":
        credit.add(id, "rec", 1, est);
        credit.yards(id, "rec_yds", own(event) ?? partner(play, "pass_complete"), est);
        break;
      // R4, high school: the quarterback's sack is a rushing attempt for a loss.
      case "sacked": {
        credit.add(id, "rush_att", 1, est);
        const loss = own(event) ?? partner(play, "sack");
        credit.yards(id, "rush_yds", loss && { value: -Math.abs(loss.value), source: loss.source }, est);
        break;
      }
      // R4: the defender gets the sack, its yards, and a tackle. A shared sack
      // is split evenly, the way stat sheets carry half sacks.
      case "sack": {
        const share = 1 / sackCount;
        credit.add(id, "sacks", share, est);
        credit.add(id, "tkl", 1, est);
        const loss = own(event) ?? partner(play, "sacked");
        credit.yards(id, "sack_yds", loss && { value: Math.abs(loss.value) * share, source: loss.source }, est);
        break;
      }
      case "tackle":
        credit.add(id, "tkl", 1, est);
        break;
      // R2: a breakup is only a breakup.
      case "pass_breakup":
        credit.add(id, "pbu", 1, est);
        break;
      // R5: the interception and its return.
      case "interception":
        credit.add(id, "def_int", 1, est);
        credit.yards(id, "int_ret_yds", own(event), est);
        break;
      // R6: the play's other stats stand. The fumbler loses it when the last
      // player to recover it plays for the other side.
      case "fumble":
        credit.add(id, "fum", 1, est);
        if (lostBy(play, event, players)) credit.add(id, "fum_lost", 1, est);
        break;
      case "forced_fumble":
        credit.add(id, "ff", 1, est);
        break;
      case "fumble_recovery":
        credit.add(id, "fr", 1, est);
        credit.yards(id, "fr_ret_yds", own(event), est);
        break;
      case "kick_return":
        credit.add(id, "kr", 1, est);
        credit.yards(id, "kr_yds", own(event), est);
        break;
      case "punt_return":
        credit.add(id, "pr", 1, est);
        credit.yards(id, "pr_yds", own(event), est);
        break;
      case "field_goal":
        credit.add(id, "fga", 1, est);
        if (event.made === true) {
          credit.add(id, "fgm", 1, est);
          // The long only counts a kick that went in. A miss's distance has no key.
          const distance = own(event);
          if (distance) credit.longest(id, distance, est);
        }
        break;
      case "extra_point":
        credit.add(id, "xpa", 1, est);
        if (event.made === true) credit.add(id, "xpm", 1, est);
        break;
      case "punt":
        credit.add(id, "punts", 1, est);
        credit.yards(id, "punt_yds", own(event), est);
        break;
    }
  }

  // R10: the touchdown goes to whoever ended the play with the ball, plus the
  // passer on a passing touchdown.
  if (play.touchdown && counted.length > 0) {
    const scorer = SCORER_ORDER.map((action) => counted.filter((event) => event.action === action).at(-1)).find(Boolean);
    if (scorer) credit.add(scorer.playerId, TD_KEY[scorer.action]!, 1, scorer.estimated === true);
    const turnover = intercepted || actions.has("fumble_recovery");
    const passingTd = scorer ? scorer.action === "reception" : !turnover;
    if (passingTd) {
      for (const pass of counted.filter((event) => event.action === "pass_complete")) {
        credit.add(pass.playerId, "pass_td", 1, pass.estimated === true);
      }
    }
  }

  const deltas = credit.deltas();
  return { play, deltas, dropped, yardsUnknown: deltas.some((delta) => delta.yardsUnknown) };
}

/** Every play in order, applied. What the harness prints and the browser log records. */
export function applyPlays(plays: readonly StatsPlay[], roster: Roster): AppliedPlay[] {
  const players = index(roster);
  return plays.map((play) => applyPlay(play, players));
}

/**
 * Tonight's numbers for every player who has any, worked out from the whole
 * list of applied plays. Never kept as a running count: undo is this list
 * without its last play.
 */
export function tonightTotals(plays: readonly StatsPlay[], roster: Roster): Map<string, TonightTally> {
  const totals = new Map<string, { stats: FootballStats; estimated: Set<FootballStatKey> }>();
  for (const applied of applyPlays(plays, roster)) {
    for (const delta of applied.deltas) {
      let total = totals.get(delta.playerId);
      if (!total) {
        total = { stats: {}, estimated: new Set() };
        totals.set(delta.playerId, total);
      }
      for (const [key, value] of Object.entries(delta.stats) as Array<[FootballStatKey, number]>) {
        total.stats[key] = key === "fg_long" ? Math.max(total.stats[key] ?? 0, value) : (total.stats[key] ?? 0) + value;
      }
      for (const key of delta.estimated) total.estimated.add(key);
    }
  }
  const result = new Map<string, TonightTally>();
  for (const [playerId, total] of totals) {
    result.set(playerId, { stats: total.stats, estimated: [...total.estimated] });
  }
  return result;
}

/** How many events each rule dropped, for stats.play_applied's dropped_<rule> props (docs/METRICS.md). */
export function droppedByRule(applied: AppliedPlay): Partial<Record<RuleId, number>> {
  const counts: Partial<Record<RuleId, number>> = {};
  for (const drop of applied.dropped) counts[drop.rule] = (counts[drop.rule] ?? 0) + 1;
  return counts;
}

// -----------------------------------------------------------------------------

interface KnownYards {
  value: number;
  source: NonNullable<StatsEvent["yardsSource"]>;
}

/** This event's own yards, when it has them. */
function own(event: StatsEvent): KnownYards | null {
  return event.yards !== null && event.yardsSource !== null ? { value: event.yards, source: event.yardsSource } : null;
}

/**
 * The yards another event on the same play carried. A completion's yards are
 * the catch's yards, and a sack's are the quarterback's loss, so when only one
 * side said it, both sides get it. Read from every event, dropped or not: a
 * catch by a player the roster does not have still says how far the pass went.
 */
function partner(play: StatsPlay, action: Action): KnownYards | null {
  for (const event of play.events) {
    if (event.action !== action) continue;
    const yards = own(event);
    if (yards) return yards;
  }
  return null;
}

/** R6: lost when the last recovery by a player on the rosters was by the other side. */
function lostBy(play: StatsPlay, fumble: StatsEvent, players: ReadonlyMap<string, StatsRosterPlayer>): boolean {
  const fumbler = players.get(fumble.playerId)?.side;
  if (!fumbler) return false;
  const recoveries = play.events.filter((event) => event.action === "fumble_recovery" && players.has(event.playerId));
  const last = recoveries.at(-1);
  if (!last) return false;
  const recoverer: Side | undefined = players.get(last.playerId)?.side;
  return recoverer !== undefined && recoverer !== fumbler;
}

function index(roster: Roster): ReadonlyMap<string, StatsRosterPlayer> {
  if (roster instanceof Map) return roster;
  return new Map((roster as readonly StatsRosterPlayer[]).map((player) => [player.playerId, player]));
}

/**
 * Collects one play's increments per player, in the order players first appear.
 * Plain fields, no constructor parameter properties: the replay harness runs
 * this file under node's own type stripping, which does not support them.
 */
class Credit {
  private readonly byPlayer = new Map<
    string,
    { stats: FootballStats; estimated: Set<FootballStatKey>; unknown: Set<FootballStatKey> }
  >();

  /** `estimated` marks a count code filled in or guessed at (lib/livestats/check.ts). */
  add(playerId: string, key: FootballStatKey, amount: number, estimated = false) {
    const entry = this.entry(playerId);
    entry.stats[key] = (entry.stats[key] ?? 0) + amount;
    if (estimated) entry.estimated.add(key);
  }

  /** R8: said yards count plainly, worked-out yards count with a ~, and no yards counts nothing. */
  yards(playerId: string, key: FootballStatKey, yards: KnownYards | null, estimated = false) {
    const entry = this.entry(playerId);
    if (!yards) {
      entry.unknown.add(key);
      return;
    }
    entry.stats[key] = (entry.stats[key] ?? 0) + yards.value;
    if (yards.source !== "stated" || estimated) entry.estimated.add(key);
  }

  /** A made field goal's distance, which totals keep the longest of rather than add. */
  longest(playerId: string, yards: KnownYards, estimated = false) {
    const entry = this.entry(playerId);
    entry.stats.fg_long = Math.max(entry.stats.fg_long ?? 0, yards.value);
    if (yards.source !== "stated" || estimated) entry.estimated.add("fg_long");
  }

  deltas(): PlayerDelta[] {
    return [...this.byPlayer].map(([playerId, entry]) => ({
      playerId,
      stats: entry.stats,
      estimated: [...entry.estimated],
      yardsUnknown: entry.unknown.size > 0,
      unknownYards: [...entry.unknown],
    }));
  }

  private entry(playerId: string) {
    let entry = this.byPlayer.get(playerId);
    if (!entry) {
      entry = { stats: {}, estimated: new Set(), unknown: new Set() };
      this.byPlayer.set(playerId, entry);
    }
    return entry;
  }
}
