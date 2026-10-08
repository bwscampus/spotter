import { isEmptyStats, type FootballStatKey, type FootballStats } from "./statKeys";
import { withTonight, type TonightTally } from "./tonight";

// =============================================================================
// A football card's stat lines, built from numbers. docs/CARD_SPEC.md and
// docs/V3_DEFINITION.md 8.7.
//
// Pure: numbers in, items out. The card path may import this folder, and live
// stats does too, which is why it lives in lib/cards/ and imports nothing from
// either side.
//
// A card has two stat sections, SEASON (the uploaded numbers plus tonight) and
// TONIGHT, labelled on the card itself, so the lines carry no such word. Each
// item is a value and a label, written the way an announcer says them: "420
// yds", "5 TD", "22 rec", "88-140", "7-9 FG", "long 42".
//
// Show as much as fits (Jed, Oct 7: "not all stats are shown on the cards").
// What the player did is sorted into groups (passing, rushing, receiving,
// defense, returns, kicking), each weighted by how much of it they did. A line
// is the two biggest groups, MAX_GROUPS, each in spoken order and each with up
// to MAX_GROUP_ITEMS items: the card puts the biggest in its left column and
// the next in its right, one item a row, so a quarterback shows his running
// and a two-way player both sides of the ball. Each item carries its group
// and its rank within it, and a card with fewer rows than items shows the
// highest priority ones. The second group's first item always names it ("64
// car", "45 tkl", "7-9 FG"), so its yards and touchdowns are not read as the
// first group's.
//
// A figure that includes a number Spotter is not sure of is an estimate, on
// tonight's line and on the season total it went into, for the rest of the
// game: yards worked out from yard lines or phrasing (rule R8), and every stat
// from a play Claude was unsure of (testrun, Oct 3). The card marks it with
// ESTIMATE_MARK, in the same black as everything else: "2 car · ~11 yds".
// =============================================================================

// =============================================================================
// TUNING: how the lines read and how long they may get.
// =============================================================================

/** Groups on one line: the card's two stat columns. */
export const MAX_GROUPS = 2;

/** Most items one group keeps: the most rows a card's column has (components/PlayerCard.tsx). */
export const MAX_GROUP_ITEMS = 5;

/** Most items on one line, both groups. */
export const MAX_ITEMS = MAX_GROUPS * MAX_GROUP_ITEMS;

/**
 * Longest one item may be, counted as displayed, mark included: what fits one
 * of the card's two stat columns ("~1,420 yds"). An item past this is dropped
 * unless it is the last one standing in its group.
 */
export const MAX_ROW_CHARS = 10;

/** Between items. */
export const ITEM_SEPARATOR = " · ";

/**
 * Marks an estimated figure, in front of its value. Jed asked for "~" on Oct 3
 * and kept it through the card redesign, whose brief had "est" after the label.
 */
export const ESTIMATE_MARK = "~";

// =============================================================================

/** One thing said about a player: "420" and "yds". */
export interface StatItem {
  value: string;
  label: string;
  /** Includes a number Spotter is not sure of. Marked on the card with ESTIMATE_MARK. */
  estimated: boolean;
  /** Said label first: "long 42". */
  labelFirst?: boolean;
  /**
   * Its priority within its group, 0 the highest: a card with fewer rows than
   * items shows those under its row count. Absent on lines saved before Oct 5,
   * which read in spoken order.
   */
  rank?: number;
  /**
   * Which group it is in: 0 the biggest, the card's left column; 1 the next,
   * the right column. Absent on lines saved before Oct 7, which had one group.
   */
  group?: number;
}

/** A line: up to MAX_GROUPS groups, each in the order it is said, the biggest first. Empty means no line. */
export type StatLine = StatItem[];

/** What a football card's two sections say. */
export interface CardLines {
  /** The season, plus tonight during a game. Empty for a player with no uploaded season stats. */
  season: StatLine;
  /** Tonight alone. Empty when the player has done nothing tonight. */
  tonight: StatLine;
}

/** Which figures are estimates. */
type Estimated = ReadonlySet<FootballStatKey>;

const NONE: Estimated = new Set();

/** One item as the card shows it: "~11 yds", "long 42", "88-140". */
export function itemText(item: StatItem): string {
  const value = `${item.estimated ? ESTIMATE_MARK : ""}${item.value}`;
  if (!item.label) return value;
  return item.labelFirst ? `${item.label} ${value}` : `${value} ${item.label}`;
}

/** A whole line as the card shows it, for the review table, the saved text and the tests. */
export function lineText(line: StatLine): string {
  return line.map(itemText).join(ITEM_SEPARATOR);
}

/** The season line for a football card: the two biggest groups, as they fit. Empty when there is nothing to show. */
export function seasonLine(stats: FootballStats | null | undefined, estimated: Estimated = NONE): StatLine {
  if (!stats) return [];
  return lineFor(groupsOf(stats, estimated));
}

/** Tonight's line, "2 car · ~11 yds", or empty when tonight has nothing to show. */
export function tonightItems(tonight: TonightTally | null | undefined): StatLine {
  if (!tonight) return [];
  return lineFor(groupsOf(tonight.stats, new Set(tonight.estimated)));
}

/**
 * A football card during a game. The season line is the uploaded season plus
 * tonight; a player with no uploaded season stats gets no season line at all,
 * because it would only repeat tonight's.
 */
export function cardLines(season: FootballStats | null | undefined, tonight: TonightTally | null | undefined): CardLines {
  const tonightLine = tonightItems(tonight);
  if (!season || isEmptyStats(season)) return { season: [], tonight: tonightLine };
  const combined = withTonight(season, tonight);
  return { season: seasonLine(combined.stats, new Set(combined.estimated)), tonight: tonightLine };
}

// -----------------------------------------------------------------------------

/** One item a group could say, and how much it matters: rank 0 is kept longest. */
interface Candidate {
  item: StatItem;
  rank: number;
}

interface Group {
  /** How much of this the player did. The biggest group leads. */
  weight: number;
  /** In spoken order. */
  candidates: Candidate[];
}

/**
 * The heaviest groups, MAX_GROUPS of them, biggest first. Each is in spoken
 * order, losing its lowest priority item until it has MAX_GROUP_ITEMS or
 * fewer and none is longer than MAX_ROW_CHARS; the last item standing stays
 * even if it is long, so a group is never empty for want of room. Each item
 * keeps its group and its rank within the group, for the card's columns and
 * rows. A group after the first ranks its first spoken item highest, because
 * that is the item that says which group it is.
 */
function lineFor(groups: Group[]): StatLine {
  // Stable sort, so a tie keeps the order groupsOf gives: offense before defense.
  const shown = groups.sort((a, b) => b.weight - a.weight).slice(0, MAX_GROUPS);
  return shown.flatMap((group, index) => groupItems(group, index));
}

function groupItems(group: Group, index: number): StatLine {
  const candidates = group.candidates.map((candidate, at) => (index > 0 && at === 0 ? { ...candidate, rank: -1 } : candidate));
  const kept = [...candidates];
  const tooLong = (candidate: Candidate) => itemText(candidate.item).length > MAX_ROW_CHARS;
  while (kept.length > 1 && (kept.length > MAX_GROUP_ITEMS || kept.some(tooLong))) {
    // The lowest priority long item goes first; with none too long, the lowest priority item.
    const pool = kept.some(tooLong) ? kept.filter(tooLong) : kept;
    const lowest = pool.reduce((worst, candidate) => (candidate.rank >= worst.rank ? candidate : worst));
    kept.splice(kept.indexOf(lowest), 1);
  }
  const order = [...kept].sort((a, b) => a.rank - b.rank);
  return kept.map((candidate) => ({ ...candidate.item, rank: order.indexOf(candidate), group: index }));
}

/** Builds items from the sheet: each marked when any number in it is an estimate. */
interface Items {
  /** "420 yds", the sum of the keys. Null when it is zero or absent. */
  count(label: string, ...keys: FootballStatKey[]): StatItem | null;
  /** "7-9 FG", made and attempted, one mark for the pair. Null without attempts. */
  pair(made: FootballStatKey, attempted: FootballStatKey, label: string): StatItem | null;
  /** "long 42". */
  lead(label: string, key: FootballStatKey): StatItem | null;
}

function groupsOf(stats: FootballStats, estimated: Estimated): Group[] {
  const marked = (keys: FootballStatKey[]) => keys.some((key) => estimated.has(key));
  const items: Items = {
    count(label, ...keys) {
      const value = keys.reduce((total, key) => total + (stats[key] ?? 0), 0);
      if (!has(value)) return null;
      return { value: num(value), label, estimated: marked(keys) };
    },
    pair(made, attempted, label) {
      const tried = stats[attempted];
      if (!has(tried)) return null;
      return { value: `${num(stats[made] ?? 0)}-${num(tried!)}`, label, estimated: marked([made, attempted]) };
    },
    lead(label, key) {
      const value = stats[key];
      if (!has(value)) return null;
      return { value: num(value!), label, estimated: marked([key]), labelFirst: true };
    },
  };
  return [
    passing(stats, items),
    rushing(stats, items),
    receiving(stats, items),
    defense(stats, items),
    returns(stats, items),
    kicking(stats, items),
  ].filter((group): group is Group => group !== null);
}

/** Candidates in spoken order, each with its rank. Missing items are skipped. */
function ranked(...entries: Array<[StatItem | null, number]>): Candidate[] {
  return entries
    .filter((entry): entry is [StatItem, number] => entry[0] !== null)
    .map(([item, rank]) => ({ item, rank }));
}

// -----------------------------------------------------------------------------
// The groups, each in spoken order with the brief's priority as its rank. A
// zero is left off, always. Each returns null when the player has nothing in
// it. A stat the brief does not list keeps its place in its group at the
// lowest priority, so a group that led before still leads, and still says
// something: a punter's punts, a returner's returns.
// -----------------------------------------------------------------------------

/** Completions-attempts, TD, yds; said "88-140, 1,420 yards, 9 TD". */
function passing(s: FootballStats, it: Items): Group | null {
  const lead =
    has(s.pass_cmp) && has(s.pass_att)
      ? it.pair("pass_cmp", "pass_att", "")
      : (it.count("att", "pass_att") ?? it.count("cmp", "pass_cmp"));
  const yards = it.count(lead ? "yds" : "pass yds", "pass_yds");
  if (!lead && !yards) return null;
  const candidates = ranked([lead, 0], [yards, 2], [it.count("TD", "pass_td"), 1], [it.count("INT", "pass_int"), 3]);
  return { weight: s.pass_att ?? s.pass_cmp ?? 0, candidates };
}

/** Rushing yds, TD, car; said "64 car, 420 yds, 5 TD". */
function rushing(s: FootballStats, it: Items): Group | null {
  const carries = it.count("car", "rush_att");
  const yards = it.count(carries ? "yds" : "rush yds", "rush_yds");
  if (!carries && !yards) return null;
  return { weight: s.rush_att ?? 0, candidates: ranked([carries, 2], [yards, 0], [it.count("TD", "rush_td"), 1]) };
}

/** Rec, yds, TD. */
function receiving(s: FootballStats, it: Items): Group | null {
  const catches = it.count("rec", "rec");
  const yards = it.count(catches ? "yds" : "rec yds", "rec_yds");
  if (!catches && !yards) return null;
  return { weight: s.rec ?? 0, candidates: ranked([catches, 0], [yards, 1], [it.count("TD", "rec_td"), 2]) };
}

/** Tkl, sk, INT, PBU; then forced and recovered fumbles and defensive TDs. */
function defense(s: FootballStats, it: Items): Group | null {
  const plays = ranked(
    [it.count("tkl", "tkl"), 0],
    [it.count("sk", "sacks"), 1],
    [it.count("INT", "def_int"), 2],
    [it.count("PBU", "pbu"), 3],
    [it.count("ff", "ff"), 4],
    [it.count("fr", "fr"), 5],
  );
  if (plays.length === 0) {
    // Yards with no count beside them: a group before, so still one.
    const yards = ranked(
      [it.count("sack yds", "sack_yds"), 0],
      [it.count("int yds", "int_ret_yds"), 1],
      [it.count("fr yds", "fr_ret_yds"), 2],
    );
    return yards.length > 0 ? { weight: 0, candidates: yards } : null;
  }
  // A pick-six or a scoop-and-score.
  const candidates = [...plays, ...ranked([it.count("TD", "int_td", "fr_td"), 6])];
  const weight = [s.tkl, s.sacks, s.def_int, s.pbu, s.ff, s.fr].reduce<number>((total, value) => total + (value ?? 0), 0);
  return { weight, candidates };
}

/** Not in the brief: kick returns, punt returns, each with its yards, and return TDs. */
function returns(s: FootballStats, it: Items): Group | null {
  const kicks = it.count("kr", "kr");
  const punts = it.count("pr", "pr");
  const candidates = ranked(
    [kicks, 0],
    [it.count(kicks ? "yds" : "kr yds", "kr_yds"), 1],
    [punts, 2],
    [it.count(punts ? "yds" : "pr yds", "pr_yds"), 3],
  );
  if (candidates.length === 0) return null;
  candidates.push(...ranked([it.count("TD", "kr_td", "pr_td"), 4]));
  return { weight: (s.kr ?? 0) + (s.pr ?? 0), candidates };
}

/** FG, long; then extra points and punting, which is the same player often enough. */
function kicking(s: FootballStats, it: Items): Group | null {
  const punts = it.count(s.punts === 1 ? "punt" : "punts", "punts");
  const candidates = ranked(
    [it.pair("fgm", "fga", "FG") ?? it.count("FG", "fgm"), 0],
    [it.lead("long", "fg_long"), 1],
    [it.pair("xpm", "xpa", "xp") ?? it.count("xp", "xpm"), 2],
    [punts, 3],
    [it.count(punts ? "yds" : "punt yds", "punt_yds"), 4],
  );
  if (candidates.length === 0) return null;
  const weight = (s.fga ?? s.fgm ?? 0) + (s.xpa ?? s.xpm ?? 0) + (s.punts ?? 0);
  return { weight, candidates };
}

/** Present and not zero. Negative yards are real (a sacked quarterback's rushing) and do show. */
function has(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

/** 1420 as "1,420"; half a sack as "4.5". */
function num(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
