import { MAX_STAT_LINES, MAX_STAT_LINE_LENGTH } from "./limits";
import type { FootballStats } from "./statKeys";

// =============================================================================
// A football card's stat lines, built from numbers. docs/V3_DEFINITION.md 8.7.
//
// Pure: numbers in, text out. The card path may import this folder, and live
// stats will too (item 13 adds the TONIGHT line here), which is why it lives in
// lib/cards/ and imports nothing from either side.
//
// What a player has done is sorted into groups (passing, rushing, receiving,
// defense, returns, kicking), each weighted by how much of it they did. The
// biggest group goes first, one group per line, so a two-way player reads
// "SEASON 64 CAR 420 YDS 5 TD" then "31 TKL 2 SACKS 9 YDS". YDS rides with
// every stat that has yards.
// =============================================================================

// =============================================================================
// TUNING: how the lines read and how long they may get.
// =============================================================================

/** Leads the first line, so the season numbers read apart from tonight's. */
export const SEASON_LABEL = "SEASON";

/** Between groups that had to share the last line. */
export const GROUP_SEPARATOR = " · ";

/** Lines a card has room for. The same slots the other sports' text lines use. */
export const MAX_LINES = MAX_STAT_LINES;

/** Longest a line may be. The card's stat slot truncates past about this. */
export const MAX_LINE_LENGTH = MAX_STAT_LINE_LENGTH;

// =============================================================================

interface Group {
  /** How much of this the player did. The biggest group leads. */
  weight: number;
  /**
   * The group's parts, most important first. Each part is atomic: a count and
   * its yards stay together ("4 SACKS 22 YDS"), so trimming a long line can
   * drop a whole stat but never leaves one without its YDS.
   */
  parts: string[];
}

/** The season lines for a football card, biggest group first. Empty when there is nothing to show. */
export function seasonLines(stats: FootballStats | null | undefined): string[] {
  if (!stats) return [];
  const groups = [passing(stats), rushing(stats), receiving(stats), defense(stats), returns(stats), kicking(stats)]
    .filter((group): group is Group => group !== null)
    // Stable sort, so a tie keeps the order above: offense before defense.
    .sort((a, b) => b.weight - a.weight);
  if (groups.length === 0) return [];

  const lines: string[] = [];
  groups.forEach((group, index) => {
    const prefix = index === 0 ? `${SEASON_LABEL} ` : "";
    if (index < MAX_LINES) {
      lines.push(fit(prefix, group.parts));
      return;
    }
    // More groups than lines: the smaller ones share the last line, as far as
    // it has room. What does not fit is left off rather than cut in half.
    const last = lines[lines.length - 1];
    const joined = `${last}${GROUP_SEPARATOR}${group.parts[0]}`;
    if (joined.length > MAX_LINE_LENGTH) return;
    lines[lines.length - 1] = fit(`${last}${GROUP_SEPARATOR}`, group.parts);
  });
  return lines;
}

/** Prefix plus as many whole parts as fit. The first part always goes in, cut if it must be. */
function fit(prefix: string, parts: string[]): string {
  let line = `${prefix}${parts[0]}`;
  for (const part of parts.slice(1)) {
    const next = `${line} ${part}`;
    if (next.length > MAX_LINE_LENGTH) break;
    line = next;
  }
  return line.slice(0, MAX_LINE_LENGTH);
}

// -----------------------------------------------------------------------------
// The groups. Each returns null when the player has nothing in it. A zero is
// left off, because "0 TD" on a card is worse than nothing, with one exception
// an announcer would actually say: a quarterback's 0 INT.
// -----------------------------------------------------------------------------

function passing(s: FootballStats): Group | null {
  const parts: string[] = [];
  const cmp = s.pass_cmp;
  const att = s.pass_att;
  const yards = has(s.pass_yds) ? ` ${num(s.pass_yds!)} YDS` : "";
  if (has(cmp) && has(att)) parts.push(`${num(cmp!)}/${num(att!)}${yards}`);
  else if (has(att)) parts.push(`${num(att!)} ATT${yards}`);
  else if (has(cmp)) parts.push(`${num(cmp!)} CMP${yards}`);
  else if (yards) parts.push(`${num(s.pass_yds!)} PASS YDS`);
  if (parts.length === 0) return null;
  if (has(s.pass_td)) parts.push(`${num(s.pass_td!)} TD`);
  if (has(s.pass_int) || (s.pass_int === 0 && has(att))) parts.push(`${num(s.pass_int!)} INT`);
  return { weight: s.pass_att ?? s.pass_cmp ?? 0, parts };
}

function rushing(s: FootballStats): Group | null {
  const lead = countWithYards(s.rush_att, "CAR", s.rush_yds, "RUSH YDS");
  if (!lead) return null;
  const parts = [lead];
  if (has(s.rush_td)) parts.push(`${num(s.rush_td!)} TD`);
  return { weight: s.rush_att ?? 0, parts };
}

function receiving(s: FootballStats): Group | null {
  const lead = countWithYards(s.rec, "REC", s.rec_yds, "REC YDS");
  if (!lead) return null;
  const parts = [lead];
  if (has(s.rec_td)) parts.push(`${num(s.rec_td!)} TD`);
  return { weight: s.rec ?? 0, parts };
}

function defense(s: FootballStats): Group | null {
  const parts: string[] = [];
  if (has(s.tkl)) parts.push(`${num(s.tkl!)} TKL`);
  const sacks = countWithYards(s.sacks, s.sacks === 1 ? "SACK" : "SACKS", s.sack_yds, "SACK YDS");
  if (sacks) parts.push(sacks);
  const ints = countWithYards(s.def_int, "INT", s.int_ret_yds, "INT YDS");
  if (ints) parts.push(ints);
  if (has(s.pbu)) parts.push(`${num(s.pbu!)} PBU`);
  if (has(s.ff)) parts.push(`${num(s.ff!)} FF`);
  const recoveries = countWithYards(s.fr, "FR", s.fr_ret_yds, "FR YDS");
  if (recoveries) parts.push(recoveries);
  if (parts.length === 0) return null;
  const weight = [s.tkl, s.sacks, s.def_int, s.pbu, s.ff, s.fr].reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return { weight, parts };
}

function returns(s: FootballStats): Group | null {
  const parts: string[] = [];
  const kicks = countWithYards(s.kr, "KR", s.kr_yds, "KR YDS");
  if (kicks) parts.push(kicks);
  const punts = countWithYards(s.pr, "PR", s.pr_yds, "PR YDS");
  if (punts) parts.push(punts);
  if (parts.length === 0) return null;
  const tds = (s.kr_td ?? 0) + (s.pr_td ?? 0);
  if (tds > 0) parts.push(`${num(tds)} TD`);
  return { weight: (s.kr ?? 0) + (s.pr ?? 0), parts };
}

/** Field goals, extra points, the long, and punting, which is the same player often enough. */
function kicking(s: FootballStats): Group | null {
  const parts: string[] = [];
  const fg = madeOf(s.fgm, s.fga, "FG");
  if (fg) parts.push(fg);
  const xp = madeOf(s.xpm, s.xpa, "XP");
  if (xp) parts.push(xp);
  if (has(s.fg_long)) parts.push(`LONG ${num(s.fg_long!)}`);
  const punting = countWithYards(s.punts, s.punts === 1 ? "PUNT" : "PUNTS", s.punt_yds, "PUNT YDS");
  if (punting) parts.push(punting);
  if (parts.length === 0) return null;
  const weight = (s.fga ?? s.fgm ?? 0) + (s.xpa ?? s.xpm ?? 0) + (s.punts ?? 0);
  return { weight, parts };
}

/** "64 CAR 420 YDS", or "64 CAR", or "420 RUSH YDS" when the sheet gave yards without a count. */
function countWithYards(count: number | undefined, label: string, yards: number | undefined, yardsOnly: string): string | null {
  if (has(count)) return has(yards) ? `${num(count!)} ${label} ${num(yards!)} YDS` : `${num(count!)} ${label}`;
  if (has(yards)) return `${num(yards!)} ${yardsOnly}`;
  return null;
}

/** "8/11 FG", or "8 FG" when only makes were given. */
function madeOf(made: number | undefined, attempted: number | undefined, label: string): string | null {
  if (has(attempted)) return `${num(made ?? 0)}/${num(attempted!)} ${label}`;
  if (has(made)) return `${num(made!)} ${label}`;
  return null;
}

/** Present and not zero. Negative yards are real (a sacked quarterback's rushing) and do show. */
function has(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value !== 0;
}

/** 1420 as "1,420"; half a sack as "4.5". */
function num(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
