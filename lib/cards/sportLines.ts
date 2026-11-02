import { seasonLine, type StatItem, type StatLine } from "./lines";
import type { NumberSport, SeasonNumbers } from "./sportStats";

// =============================================================================
// What a basketball or volleyball card's SEASON section says (Nov 2), from the
// player's season totals, built the way football's is (lib/cards/lines.ts):
// every group the player has, the biggest first, each in the order it is said
// out loud, and a zero never shown.
//
// Basketball reads per game, the way basketball is called ("18.4 ppg"), when
// the sheet gave games played; totals otherwise. Volleyball reads totals, with
// kills per set beside the kills and the hitting percentage after them.
//
// Pure, and in lib/cards/ because the card path and the review table both read it.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A shooting percentage shows only once a player has taken this many of that shot: "100% 3PT" on one attempt says nothing. */
export const MIN_FG_ATTEMPTS = 20;
export const MIN_THREE_ATTEMPTS = 10;
export const MIN_FT_ATTEMPTS = 10;

/** Hitting percentage needs this many attacks to mean anything. */
export const MIN_ATTACK_ATTEMPTS = 20;

// =============================================================================

/** The season line for any sport whose stats are numbers. */
export function seasonLineFor(sport: NumberSport, stats: SeasonNumbers | null | undefined): StatLine {
  if (sport === "basketball") return basketballLine(stats ?? null);
  if (sport === "volleyball") return volleyballLine(stats ?? null);
  return seasonLine(stats);
}

interface Group {
  weight: number;
  items: StatItem[];
}

/** Every group, biggest first (a stable sort keeps the listed order on a tie), each item marked with its group. */
function lineOf(groups: Array<Group | null>): StatLine {
  return groups
    .filter((group): group is Group => group !== null && group.items.length > 0)
    .sort((a, b) => b.weight - a.weight)
    .flatMap((group, index) => group.items.map((item) => ({ ...item, group: index })));
}

function positive(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** "1,204", or "41.5" for a half block. */
function count(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : (Math.round(value * 10) / 10).toLocaleString("en-US");
}

/** "18.4": one decimal, always, as averages are said. */
function average(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function item(value: string, label: string, labelFirst = false): StatItem {
  return labelFirst ? { value, label, estimated: false, labelFirst: true } : { value, label, estimated: false };
}

/** "47%" for made over attempted, once there are enough attempts. */
function percent(made: number | undefined, attempted: number | undefined, minimum: number): string | null {
  const tried = positive(attempted);
  if (tried === null || tried < minimum) return null;
  return `${Math.round(((made ?? 0) / tried) * 100)}%`;
}

// -----------------------------------------------------------------------------
// Basketball
// -----------------------------------------------------------------------------

export function basketballLine(stats: SeasonNumbers | null): StatLine {
  if (!stats) return [];
  const games = positive(stats.gp);
  /** Per game when games played are known, else the total; null when it is zero. */
  const rate = (total: number | undefined, perGame: string, totalLabel: string): { item: StatItem; weight: number } | null => {
    const value = positive(total);
    if (value === null) return null;
    return games ? { item: item(average(value / games), perGame), weight: value / games } : { item: item(count(value), totalLabel), weight: value };
  };

  const points = rate(stats.pts, "ppg", "pts");
  const shooting = [
    percent(stats.fg_made, stats.fg_att, MIN_FG_ATTEMPTS) && item(percent(stats.fg_made, stats.fg_att, MIN_FG_ATTEMPTS)!, "FG"),
    percent(stats.three_made, stats.three_att, MIN_THREE_ATTEMPTS)
      ? item(percent(stats.three_made, stats.three_att, MIN_THREE_ATTEMPTS)!, "3PT")
      : positive(stats.three_made)
        ? item(count(stats.three_made!), "3PM")
        : null,
    percent(stats.ft_made, stats.ft_att, MIN_FT_ATTEMPTS) && item(percent(stats.ft_made, stats.ft_att, MIN_FT_ATTEMPTS)!, "FT"),
  ].filter((entry): entry is StatItem => Boolean(entry));
  const scoring: Group | null = points || shooting.length > 0 ? { weight: points?.weight ?? 0, items: [...(points ? [points.item] : []), ...shooting] } : null;

  const totalRebounds = positive(stats.reb) ?? (positive((stats.oreb ?? 0) + (stats.dreb ?? 0)) ?? undefined);
  const rebounds = rate(totalRebounds, "rpg", "reb");
  const assists = rate(stats.ast, "apg", "ast");
  const steals = rate(stats.stl, "spg", "stl");
  const blocks = rate(stats.blk, "bpg", "blk");

  return lineOf([
    scoring,
    rebounds && { weight: rebounds.weight, items: [rebounds.item] },
    assists && { weight: assists.weight, items: [assists.item] },
    steals || blocks
      ? { weight: (steals?.weight ?? 0) + (blocks?.weight ?? 0), items: [steals?.item, blocks?.item].filter((entry): entry is StatItem => Boolean(entry)) }
      : null,
  ]);
}

// -----------------------------------------------------------------------------
// Volleyball
// -----------------------------------------------------------------------------

/** ".284", "-.050", "1.000": hitting percentage the way it is printed and said. */
export function hittingText(kills: number, errors: number, attempts: number): string {
  const value = (kills - errors) / attempts;
  const fixed = Math.abs(value).toFixed(3);
  const bare = fixed.startsWith("0") ? fixed.slice(1) : fixed;
  return value < 0 ? `-${bare}` : bare;
}

/** Total blocks: the sheet's own total, else solos plus half of each assisted block, as the total is scored. */
export function totalBlocks(stats: SeasonNumbers): number | null {
  return positive(stats.blocks) ?? positive((stats.solo_blocks ?? 0) + (stats.block_assists ?? 0) / 2);
}

export function volleyballLine(stats: SeasonNumbers | null): StatLine {
  if (!stats) return [];
  const kills = positive(stats.kills);
  const sets = positive(stats.sets);
  const attempts = positive(stats.attack_att);

  const attacking: Group | null = kills
    ? {
        weight: kills,
        items: [
          item(count(kills), "kills"),
          ...(sets ? [item(average(kills / sets), "per set")] : []),
          ...(attempts && attempts >= MIN_ATTACK_ATTEMPTS ? [item(hittingText(kills, stats.attack_err ?? 0, attempts), "hitting", true)] : []),
        ],
      }
    : null;

  const single = (value: number | null, label: string): Group | null => (value ? { weight: value, items: [item(count(value), label)] } : null);

  return lineOf([
    attacking,
    single(positive(stats.assists), "assists"),
    single(positive(stats.digs), "digs"),
    single(positive(stats.aces), "aces"),
    single(totalBlocks(stats), "blocks"),
  ]);
}
