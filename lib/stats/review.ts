import { byJersey } from "@/lib/cards/cardPlayer";
import { MAX_STAT_LINES, MAX_STAT_LINE_LENGTH } from "@/lib/cards/limits";
import { cleanFootballStats, FOOTBALL_STAT_KEYS, isEmptyStats, type FootballStatKey, type FootballStats } from "@/lib/cards/statKeys";
import type { Json } from "@/lib/json";
import { matchStats, unmatchedWarnings } from "./matchStats";
import type { LineBlock, NumberBlock, StatsExtractResponse, StatsKind, StatsPlayer } from "./types";

// =============================================================================
// The stats review screen's state and what it saves, as plain functions so the
// rules can be tested without a browser: which rows the announcer checks, which
// warnings they see, and exactly what set_season_stats is sent.
// =============================================================================

/** One matched player on the review screen. Football fills stats, every other sport lines. */
export interface ReviewRow {
  player: StatsPlayer;
  stats: FootballStats;
  lines: string[];
  /** The sheet's spelling, when the jersey placed the row but the surname did not agree. */
  mismatchedName?: string;
}

export interface StatsReview {
  kind: StatsKind;
  /** Matched players, in jersey order. */
  rows: ReviewRow[];
  /** Claude's warnings about the sheet, then one per row that matched nobody, naming its jersey. */
  warnings: string[];
  /** Rows that landed on nobody. A count, for analytics. */
  unmatched: number;
  /** Roster players the sheet said nothing about. */
  silent: number;
}

export function buildStatsReview(response: StatsExtractResponse): StatsReview {
  const blocks: Array<NumberBlock | LineBlock> = response.blocks;
  const result = matchStats(response.roster, blocks);

  const rows: ReviewRow[] = result.matched.map((match) => ({
    player: match.player,
    stats: "stats" in match.block ? { ...match.block.stats } : {},
    lines: "lines" in match.block ? [...match.block.lines] : [],
    ...(match.mismatchedName ? { mismatchedName: match.mismatchedName } : {}),
  }));
  rows.sort((a, b) => byJersey(a.player, b.player));

  const warnings = [...new Set([...response.warnings, ...unmatchedWarnings(result)])];
  return { kind: response.kind, rows, warnings, unmatched: result.unmatched.length, silent: result.silent.length };
}

/**
 * One number typed into the table. Blank clears the stat, which is not the same
 * as zero: a blank means the sheet did not say. Anything that is not a number
 * leaves the stat as it was.
 */
export function withStat(stats: FootballStats, key: FootballStatKey, typed: string): FootballStats {
  const text = typed.trim();
  const next = { ...stats };
  if (text.length === 0) {
    delete next[key];
    return next;
  }
  const value = Number(text);
  if (!Number.isFinite(value)) return stats;
  next[key] = value;
  return next;
}

/** The stat columns worth showing: every key some row has, in 9.2 order. */
export function columnsIn(rows: ReviewRow[]): FootballStatKey[] {
  return FOOTBALL_STAT_KEYS.filter((key) => rows.some((row) => row.stats[key] !== undefined));
}

/** Today in the announcer's own time zone, as the date input and Postgres both want it. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface SetSeasonStatsArgs {
  p_roster_id: string;
  p_stats: Json;
}

/**
 * Exactly what set_season_stats gets. A player left with nothing (every stat
 * cleared, every line blank) is left out, and the RPC clears whatever they had,
 * because a new import replaces the old numbers.
 */
export function toSetSeasonStatsArgs(
  rosterId: string,
  kind: StatsKind,
  rows: ReviewRow[],
  asOf: string | null,
): SetSeasonStatsArgs {
  const players: Array<{ id: string; stats: FootballStats | null; lines: string[] }> = [];
  for (const row of rows) {
    if (kind === "numbers") {
      const stats = cleanFootballStats(row.stats);
      if (isEmptyStats(stats)) continue;
      players.push({ id: row.player.id, stats, lines: [] });
    } else {
      const lines = cleanLines(row.lines);
      if (lines.length === 0) continue;
      players.push({ id: row.player.id, stats: null, lines });
    }
  }
  const date = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null;
  return { p_roster_id: rosterId, p_stats: { as_of: date, players } as Json };
}

/** How many players a set_season_stats call names. */
export function playersSent(args: SetSeasonStatsArgs): number {
  const stats = args.p_stats as { players?: unknown } | null;
  return Array.isArray(stats?.players) ? stats.players.length : 0;
}

/**
 * What to say when set_season_stats wrote fewer players than it was sent, or
 * null when it wrote them all. It returns how many rows it matched, and a
 * player it cannot find has usually been replaced by a roster save made since
 * this page opened (a save gives every player a new id).
 */
export function statsShortfall(sent: number, matched: unknown): string | null {
  if (typeof matched !== "number" || !Number.isFinite(matched) || matched >= sent) return null;
  const missing = sent - matched;
  const rest = missing === 1 ? "One is" : `The other ${missing} are`;
  return `Saved stats for ${matched} of ${sent} players. ${rest} no longer on this team's saved roster, probably because the roster was saved again. Import the stats again to place them.`;
}

/** Blank lines dropped, long ones cut to what the card holds, at most three. */
export function cleanLines(lines: string[]): string[] {
  return lines
    .map((line) => line.trim().slice(0, MAX_STAT_LINE_LENGTH).trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_STAT_LINES);
}

/**
 * The counts prep.import_finished carries for a stats import. Counts only: no
 * name, jersey or number from the sheet can get in, because nothing here reads
 * one into the result.
 */
export function statsImportProps(review: StatsReview): Record<string, number> {
  return {
    players_found: review.rows.length,
    players_flagged: review.unmatched + review.rows.filter((row) => row.mismatchedName !== undefined).length,
    players_silent: review.silent,
    warnings: review.warnings.length,
  };
}
