import type { FootballStatKey, FootballStats } from "./statKeys";

// =============================================================================
// What a player has done tonight, as the card sees it. docs/V3_DEFINITION.md
// 8.7: the card's SEASON line is the uploaded season numbers plus tonight, and
// TONIGHT is tonight alone.
//
// Live stats (lib/livestats/apply.ts) work these numbers out from the plays it
// has applied, always from the whole list, never by adding up as it goes. This
// file only says what the result looks like and how it adds to a season, so the
// card path can read it without importing anything from live stats.
// =============================================================================

/** One player's numbers tonight, on the same keys as the season sheet. */
export interface TonightTally {
  stats: FootballStats;
  /**
   * Yards figures that include at least one worked-out number (from yard
   * lines or phrasing, spec rule R8). The card shows them with a ~.
   */
  estimated: FootballStatKey[];
}

/** The keys that hold yards, which are the only numbers that can be worked out rather than said. */
export const YARD_KEYS = [
  "rush_yds",
  "pass_yds",
  "rec_yds",
  "sack_yds",
  "int_ret_yds",
  "fr_ret_yds",
  "kr_yds",
  "pr_yds",
  "punt_yds",
  "fg_long",
] as const satisfies readonly FootballStatKey[];

export function isYardKey(key: FootballStatKey): boolean {
  return (YARD_KEYS as readonly FootballStatKey[]).includes(key);
}

/**
 * The season plus tonight. Every number adds, with two exceptions: the long
 * field goal is the longer of the two, and games played is the sheet's own,
 * since tonight is not over.
 *
 * A worked-out figure stays marked after the add: a season total that includes
 * an estimate is an estimate. The one case it does not carry is a long field
 * goal that tonight did not beat, because then the number shown is the sheet's.
 */
export function withTonight(season: FootballStats, tonight: TonightTally | null | undefined): TonightTally {
  if (!tonight) return { stats: { ...season }, estimated: [] };
  const stats: FootballStats = { ...season };
  const estimated = new Set(tonight.estimated);
  for (const [key, value] of Object.entries(tonight.stats) as Array<[FootballStatKey, number]>) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (key === "gp") continue;
    if (key === "fg_long") {
      const sheet = season.fg_long;
      if (sheet === undefined || value > sheet) stats.fg_long = value;
      else estimated.delete("fg_long");
      continue;
    }
    stats[key] = (season[key] ?? 0) + value;
  }
  return { stats, estimated: [...estimated] };
}

// -----------------------------------------------------------------------------
// One change to one player's numbers, the unit the stats strip shows and the
// announcer corrects: "LANGAN #22 +8 RUSH YDS". A play is a list of these, and
// tonight is the sum of the lists of the plays the announcer has OK'd.
// -----------------------------------------------------------------------------

export interface StatChange {
  playerId: string;
  key: FootballStatKey;
  /** Null when the play had this stat but its yards were not known (rule R8): it shows as "?" and counts nothing. */
  amount: number | null;
  /** Worked out from yard lines or phrasing rather than said. Shown with a ~. */
  estimated: boolean;
}

/**
 * Tonight's numbers for every player, from the changes of every OK'd play.
 * Worked out from the whole list every time, never kept as a running count,
 * so taking a play back is leaving it out (docs/V3_DEFINITION.md 8.6).
 */
export function tallyChanges(changes: Iterable<StatChange>): Map<string, TonightTally> {
  return tallyWithBooth([{ seqStart: 0, changes: [...changes] }], []);
}

// -----------------------------------------------------------------------------
// The booth's stat lines (Oct 11, fix 6, Part 1, rule R41). A TV booth, and a
// high school booth with a stat crew, reads official running totals all game
// ("he's 14 of 17 for 181"), and every one of them is better evidence for a
// total than the sum of the plays Spotter read. An accepted line sets that
// player's total for that stat as of the line it was said on: tonight is the
// booth's number plus the plays counted after it. Still worked out from the
// whole list every time, never a stored delta, so undo, a correction and a
// reload stay exact: a correction to a play before the line changes nothing,
// because the booth's number already includes that play; one after it counts.
// -----------------------------------------------------------------------------

/** A booth line as the totals need it: the line it was said on, and the total it sets. */
export interface BoothTotal {
  seq: number;
  playerId: string;
  key: FootballStatKey;
  value: number;
}

/** One counted play as the totals need it: where its lines begin, and what it changes. */
export interface TalliedPlay {
  seqStart: number;
  changes: readonly StatChange[];
}

/**
 * Tonight for every player, from the counted plays and the booth's accepted
 * lines together. For each player and stat with a booth line, the latest line
 * (at seq S) sets the total, and only the changes of plays whose lines begin
 * after S add to it; a stat the booth never stated is the sum of its changes,
 * as tallyChanges always was. A total the booth set carries no ~ of its own;
 * an estimated change counted after it still marks the stat.
 */
export function tallyWithBooth(plays: Iterable<TalliedPlay>, booth: readonly BoothTotal[]): Map<string, TonightTally> {
  const totals = new Map<string, { stats: FootballStats; estimated: Set<FootballStatKey> }>();
  const entry = (playerId: string) => {
    let total = totals.get(playerId);
    if (!total) {
      total = { stats: {}, estimated: new Set() };
      totals.set(playerId, total);
    }
    return total;
  };
  // The latest line per player and stat; the later in the list wins a tie.
  const set = new Map<string, BoothTotal>();
  for (const line of booth) {
    const id = `${line.playerId}|${line.key}`;
    const held = set.get(id);
    if (!held || line.seq >= held.seq) set.set(id, line);
  }
  for (const line of set.values()) entry(line.playerId).stats[line.key] = line.value;

  for (const play of plays) {
    for (const change of play.changes) {
      if (change.amount === null || !Number.isFinite(change.amount)) continue;
      const line = set.get(`${change.playerId}|${change.key}`);
      // The booth's number already includes every play up to its line.
      if (line && play.seqStart <= line.seq) continue;
      const total = entry(change.playerId);
      const before = total.stats[change.key];
      total.stats[change.key] = change.key === "fg_long" ? Math.max(before ?? 0, change.amount) : (before ?? 0) + change.amount;
      if (change.estimated) total.estimated.add(change.key);
    }
  }
  const result = new Map<string, TonightTally>();
  for (const [playerId, total] of totals) result.set(playerId, { stats: total.stats, estimated: [...total.estimated] });
  return result;
}
