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
  if (sport === "ice_hockey") return hockeyLine(stats ?? null);
  if (sport === "soccer") return soccerLine(stats ?? null);
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

// -----------------------------------------------------------------------------
// Ice hockey (Nov 6), the way a broadcast graphic prints it. A skater: "7 G,
// 13 A, 20 PTS", then the power play, short handed and game winning goals,
// shots on goal, plus/minus and penalty minutes. A goalie: the record
// ("4-0-0", W-L-OTL, with ties when there are any: W-L-T-OTL), goals against
// average, save percentage, shutouts and saves. GAA is goals against per 60
// minutes when minutes are known, else per game; save percentage is saves over
// shots against (".939"), worked out only past MIN_SHOTS_AGAINST.
// -----------------------------------------------------------------------------

/** Save percentage needs this many shots against to mean anything. */
export const MIN_SHOTS_AGAINST = 20;

/** ".939", "1.000": save percentage the way it is printed and said. */
export function savePercentText(saves: number, shotsAgainst: number): string {
  const fixed = (saves / shotsAgainst).toFixed(3);
  return fixed.startsWith("0") ? fixed.slice(1) : fixed;
}

/** "2.00": goals against average, per 60 minutes played, else per game played; null when neither is known. */
export function goalsAgainstAverage(stats: SeasonNumbers): string | null {
  const against = typeof stats.h_goals_against === "number" && stats.h_goals_against >= 0 ? stats.h_goals_against : null;
  if (against === null) return null;
  const minutes = positive(stats.h_minutes);
  if (minutes) return ((against * 60) / minutes).toFixed(2);
  const games = positive(stats.gp);
  return games ? (against / games).toFixed(2) : null;
}

/** Whether a hockey row is a goalie's: any goalie number on it. */
export function isGoalieLine(stats: SeasonNumbers): boolean {
  return [stats.h_saves, stats.h_shots_against, stats.h_goals_against, stats.h_wins, stats.h_losses, stats.h_minutes, stats.h_shutouts].some((value) => positive(value) !== null);
}

/** "+3", "-1": plus/minus with its sign, never a bare zero. */
function signed(value: number): string {
  return value > 0 ? `+${count(value)}` : `-${count(Math.abs(value))}`;
}

export function hockeyLine(stats: SeasonNumbers | null): StatLine {
  if (!stats) return [];
  const goals = positive(stats.h_goals);
  const assists = positive(stats.h_assists);
  const points = positive(stats.h_points) ?? (goals || assists ? (goals ?? 0) + (assists ?? 0) : null);

  const goalie: Group | null = isGoalieLine(stats)
    ? (() => {
        const wins = stats.h_wins ?? 0;
        const losses = stats.h_losses ?? 0;
        const ties = stats.h_ties ?? 0;
        const otl = stats.h_otl ?? 0;
        const decisions = wins + losses + ties + otl;
        const shotsAgainst = positive(stats.h_shots_against) ?? (positive(stats.h_saves) !== null ? (stats.h_saves ?? 0) + (stats.h_goals_against ?? 0) : null);
        const saves = positive(stats.h_saves) ?? (shotsAgainst !== null ? shotsAgainst - (stats.h_goals_against ?? 0) : null);
        const gaa = goalsAgainstAverage(stats);
        const items: StatItem[] = [
          ...(decisions > 0 ? [item(ties > 0 ? `${wins}-${losses}-${ties}-${otl}` : `${wins}-${losses}-${otl}`, "record")] : []),
          ...(gaa !== null ? [item(gaa, "GAA")] : []),
          ...(shotsAgainst !== null && shotsAgainst >= MIN_SHOTS_AGAINST && saves !== null ? [item(savePercentText(saves, shotsAgainst), "SV%")] : []),
          ...(positive(stats.h_shutouts) ? [item(count(stats.h_shutouts!), "SO")] : []),
          ...(saves !== null && saves > 0 ? [item(count(saves), "saves")] : []),
        ];
        // A goalie's numbers lead his card, however many points he has.
        return { weight: Number.MAX_SAFE_INTEGER, items };
      })()
    : null;

  const scoring: Group | null =
    goals || assists || points
      ? {
          weight: points ?? 0,
          items: [
            ...(goals ? [item(count(goals), "G")] : []),
            ...(assists ? [item(count(assists), "A")] : []),
            ...(points ? [item(count(points), "PTS")] : []),
          ],
        }
      : null;
  const special: Group | null = (() => {
    const items = [
      positive(stats.h_ppg) ? item(count(stats.h_ppg!), "PPG") : null,
      positive(stats.h_shg) ? item(count(stats.h_shg!), "SHG") : null,
      positive(stats.h_gwg) ? item(count(stats.h_gwg!), "GWG") : null,
    ].filter((entry): entry is StatItem => entry !== null);
    return items.length > 0 ? { weight: items.length, items } : null;
  })();
  const shots = positive(stats.h_sog);
  const plusMinus = typeof stats.h_plus_minus === "number" && Number.isFinite(stats.h_plus_minus) && stats.h_plus_minus !== 0 ? stats.h_plus_minus : null;
  const pim = positive(stats.h_pim);

  return lineOf([
    goalie,
    scoring,
    special,
    shots ? { weight: 0.5, items: [item(count(shots), "SOG")] } : null,
    plusMinus !== null ? { weight: 0.4, items: [item(signed(plusMinus), "+/-", true)] } : null,
    pim ? { weight: 0.3, items: [item(count(pim), "PIM")] } : null,
  ]);
}

// -----------------------------------------------------------------------------
// Soccer (Nov 7), the way a broadcast graphic prints it. A field player: "7 G,
// 4 A, 18 PTS" (high school points are 2 a goal and 1 an assist, the sheet's
// own when it gives them), then game winning and penalty kick goals, shots
// and shots on goal, and cards. A goalkeeper first: the record (W-L-T), goals
// against average, save percentage, shutouts and saves. GAA is per 80 minutes
// (a high school game) when minutes are known, else per game; save percentage
// is saves over shots on goal faced, past MIN_SHOTS_FACED.
// -----------------------------------------------------------------------------

/** A high school soccer game's length, which goals against average is counted per. */
export const SOCCER_GAME_MINUTES = 80;

/** Save percentage needs this many shots on goal faced to mean anything. */
export const MIN_SHOTS_FACED = 20;

/** Whether a soccer row is a goalkeeper's: any keeper number on it. */
export function isKeeperLine(stats: SeasonNumbers): boolean {
  return [stats.s_saves, stats.s_shots_faced, stats.s_goals_against, stats.s_shutouts, stats.s_wins, stats.s_losses, stats.s_ties].some((value) => positive(value) !== null);
}

/** "0.95": goals against per 80 minutes played, else per game played; null when neither is known. */
export function soccerGoalsAgainstAverage(stats: SeasonNumbers): string | null {
  const against = typeof stats.s_goals_against === "number" && stats.s_goals_against >= 0 ? stats.s_goals_against : null;
  if (against === null) return null;
  const minutes = positive(stats.s_minutes);
  if (minutes) return ((against * SOCCER_GAME_MINUTES) / minutes).toFixed(2);
  const games = positive(stats.gp);
  return games ? (against / games).toFixed(2) : null;
}

/** Shots on goal faced: the sheet's own, else saves plus goals against. */
export function shotsFaced(stats: SeasonNumbers): number | null {
  return positive(stats.s_shots_faced) ?? (positive(stats.s_saves) !== null ? (stats.s_saves ?? 0) + (stats.s_goals_against ?? 0) : null);
}

export function soccerLine(stats: SeasonNumbers | null): StatLine {
  if (!stats) return [];
  const goals = positive(stats.s_goals);
  const assists = positive(stats.s_assists);
  const points = positive(stats.s_points) ?? (goals || assists ? 2 * (goals ?? 0) + (assists ?? 0) : null);

  const keeper: Group | null = isKeeperLine(stats)
    ? (() => {
        const wins = stats.s_wins ?? 0;
        const losses = stats.s_losses ?? 0;
        const ties = stats.s_ties ?? 0;
        const faced = shotsFaced(stats);
        const saves = positive(stats.s_saves) ?? (faced !== null ? faced - (stats.s_goals_against ?? 0) : null);
        const gaa = soccerGoalsAgainstAverage(stats);
        const items: StatItem[] = [
          ...(wins + losses + ties > 0 ? [item(`${wins}-${losses}-${ties}`, "record")] : []),
          ...(gaa !== null ? [item(gaa, "GAA")] : []),
          ...(faced !== null && faced >= MIN_SHOTS_FACED && saves !== null ? [item(savePercentText(saves, faced), "SV%")] : []),
          ...(positive(stats.s_shutouts) ? [item(count(stats.s_shutouts!), "SO")] : []),
          ...(saves !== null && saves > 0 ? [item(count(saves), "saves")] : []),
        ];
        // A keeper's numbers lead the card, however many points.
        return { weight: Number.MAX_SAFE_INTEGER, items };
      })()
    : null;

  const scoring: Group | null =
    goals || assists || points
      ? {
          weight: points ?? 0,
          items: [
            ...(goals ? [item(count(goals), "G")] : []),
            ...(assists ? [item(count(assists), "A")] : []),
            ...(points ? [item(count(points), "PTS")] : []),
          ],
        }
      : null;
  const big: Group | null = (() => {
    const items = [
      positive(stats.s_gwg) ? item(count(stats.s_gwg!), "GWG") : null,
      positive(stats.s_pk_goals) ? item(count(stats.s_pk_goals!), "PK") : null,
    ].filter((entry): entry is StatItem => entry !== null);
    return items.length > 0 ? { weight: items.length, items } : null;
  })();
  const shooting: Group | null = (() => {
    const items = [
      positive(stats.s_shots) ? item(count(stats.s_shots!), "SH") : null,
      positive(stats.s_sog) ? item(count(stats.s_sog!), "SOG") : null,
    ].filter((entry): entry is StatItem => entry !== null);
    return items.length > 0 ? { weight: 0.5, items } : null;
  })();
  const cards: Group | null = (() => {
    const items = [
      positive(stats.s_yellow) ? item(count(stats.s_yellow!), "YC") : null,
      positive(stats.s_red) ? item(count(stats.s_red!), "RC") : null,
    ].filter((entry): entry is StatItem => entry !== null);
    return items.length > 0 ? { weight: 0.3, items } : null;
  })();

  return lineOf([keeper, scoring, big, shooting, cards]);
}

