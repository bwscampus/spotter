import { titleCase } from "@/lib/cards/cardFace";
import { ESTIMATE_MARK } from "@/lib/cards/lines";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import type { FootballStatKey, FootballStats } from "@/lib/cards/statKeys";
import type { TonightTally } from "@/lib/cards/tonight";
import { statsKindFor } from "@/lib/stats/types";
import type { SeasonNumbers } from "@/lib/cards/sportStats";
import { goalsAgainstAverage, MIN_SHOTS_AGAINST, MIN_SHOTS_FACED, savePercentText, shotsFaced, soccerGoalsAgainstAverage } from "@/lib/cards/sportLines";

// =============================================================================
// The team panel's four leader boxes (docs/PANEL_SPEC.md): PASS and RUSH on
// top, REC and TKL under them. Each shows the player on that team with the
// most of its big number, tonight from live stats, or for the season when the
// game has no live stats. Pure, so who leads is tested.
// =============================================================================

export type LeaderCategory = "PASS" | "RUSH" | "REC" | "TKL" | "PTS" | "REB" | "AST" | "STL" | "KILLS" | "DIGS" | "ACES" | "G" | "A" | "SV%";

/** Football's four, left to right, top to bottom. */
export const LEADER_CATEGORIES = ["PASS", "RUSH", "REC", "TKL"] as const satisfies readonly LeaderCategory[];

/** Basketball's and volleyball's four (Nov 2), left to right, top to bottom. */
export const BASKETBALL_LEADERS: readonly LeaderCategory[] = ["PTS", "REB", "AST", "STL"];
export const VOLLEYBALL_LEADERS: readonly LeaderCategory[] = ["KILLS", "AST", "DIGS", "ACES"];
/** Soccer's four (Nov 7): goals, assists, points, and the keeper with the best save percentage. */
export const SOCCER_LEADERS: readonly LeaderCategory[] = ["G", "A", "PTS", "SV%"];
/** Ice hockey's four (Nov 6): points, goals, assists, and the goalie with the best save percentage. */
export const HOCKEY_LEADERS: readonly LeaderCategory[] = ["PTS", "G", "A", "SV%"];

/** The number shown before anyone has one. */
export const NO_LEADER = "–";

export interface LeaderBox {
  category: LeaderCategory;
  /** "~212", "1,204", or "–" before anyone has a stat in the category. */
  number: string;
  /** Under the number: "YDS" or "TKL"; basketball's per game ("PPG") or totals ("PTS"); volleyball's totals ("KILLS"). */
  unit: "YDS" | "TKL" | "PPG" | "PTS" | "RPG" | "REB" | "APG" | "AST" | "SPG" | "STL" | "KILLS" | "DIGS" | "ACES" | "G" | "A" | "SV%";
  /** After the category: "9-14", "14 car, 1 TD", "3 rec", or "" (TKL, and before anyone leads). */
  support: string;
  /** The leader's surname, as the card writes it; null before anyone leads. */
  name: string | null;
  playerId: string | null;
}

/** Tonight's numbers as live stats hands them to the panel: the same totals the cards add, and when each leader stat took its value. */
export interface TonightBoard {
  tallies: ReadonlyMap<string, TonightTally>;
  reached: ReadonlyMap<string, Partial<Record<FootballStatKey, number>>>;
}

/** How a leader's supporting numbers are written: one stat, or a pair ("9-14"), each with a ~ when any part is an estimate. */
interface Writer {
  count(key: FootballStatKey): string;
  pair(made: FootballStatKey, tried: FootballStatKey): string;
  has(key: FootballStatKey): boolean;
}

interface Category {
  big: FootballStatKey;
  unit: LeaderBox["unit"];
  /** The keys that say a player has done something in this category. */
  keys: readonly FootballStatKey[];
  support(write: Writer): string;
}

/** Football's four. The type keeps the rest of the code on football's names; basketball's and volleyball's are SPORT_RULES below. */
type FootballCategory = "PASS" | "RUSH" | "REC" | "TKL";

const CATEGORIES: Record<FootballCategory, Category> = {
  PASS: { big: "pass_yds", unit: "YDS", keys: ["pass_yds", "pass_cmp", "pass_att"], support: (write) => write.pair("pass_cmp", "pass_att") },
  RUSH: {
    big: "rush_yds",
    unit: "YDS",
    keys: ["rush_yds", "rush_att"],
    // The touchdowns only when there are some: anything zero is left out, as on the cards.
    support: (write) => [`${write.count("rush_att")} car`, write.has("rush_td") ? `${write.count("rush_td")} TD` : ""].filter(Boolean).join(", "),
  },
  REC: { big: "rec_yds", unit: "YDS", keys: ["rec_yds", "rec"], support: (write) => `${write.count("rec")} rec` },
  TKL: { big: "tkl", unit: "TKL", keys: ["tkl"], support: () => "" },
};

/** Whether a sport's games have four leader boxes: football, basketball and volleyball (Nov 2), whose stats are numbers. */
export function hasLeaders(sport: string | null | undefined): boolean {
  return statsKindFor(sport) === "numbers";
}

/** "1,204": thousands get a comma, as on the cards. */
function numberText(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

interface Candidate {
  player: KeyedPlayer;
  order: number;
  stats: FootballStats;
  estimated: ReadonlySet<FootballStatKey>;
  reached: Partial<Record<FootballStatKey, number>>;
}

function box(category: FootballCategory, candidates: readonly Candidate[]): LeaderBox {
  const rule = CATEGORIES[category];
  const counted = (candidate: Candidate) => rule.keys.some((key) => (candidate.stats[key] ?? 0) !== 0);
  let leader: Candidate | null = null;
  for (const candidate of candidates) {
    if (!counted(candidate)) continue;
    if (!leader) {
      leader = candidate;
      continue;
    }
    const mine = candidate.stats[rule.big] ?? 0;
    const theirs = leader.stats[rule.big] ?? 0;
    if (mine > theirs) leader = candidate;
    else if (mine === theirs) {
      // A tie goes to whoever reached it first, then to roster order.
      const myTime = candidate.reached[rule.big] ?? Infinity;
      const theirTime = leader.reached[rule.big] ?? Infinity;
      if (myTime < theirTime || (myTime === theirTime && candidate.order < leader.order)) leader = candidate;
    }
  }
  if (!leader) return { category, number: NO_LEADER, unit: rule.unit, support: "", name: null, playerId: null };

  const { stats, estimated } = leader;
  // One mark for a number with any estimated part, in front, as the cards write it ("~9-14").
  const mark = (...keys: FootballStatKey[]) => (keys.some((key) => estimated.has(key)) ? ESTIMATE_MARK : "");
  const write: Writer = {
    count: (key) => `${mark(key)}${numberText(stats[key] ?? 0)}`,
    pair: (made, tried) => `${mark(made, tried)}${numberText(stats[made] ?? 0)}-${numberText(stats[tried] ?? 0)}`,
    has: (key) => (stats[key] ?? 0) !== 0,
  };
  return {
    category,
    number: write.count(rule.big),
    unit: rule.unit,
    support: rule.support(write),
    name: titleCase(leader.player.last),
    playerId: leader.player.playerId,
  };
}

function sidePlayers(roster: readonly KeyedPlayer[], side: "home" | "away"): Array<{ player: KeyedPlayer; order: number }> {
  return roster.map((player, order) => ({ player, order })).filter(({ player }) => player.side === side);
}

/** Tonight's leaders on one side, from live stats' totals. */
export function tonightLeaders(board: TonightBoard, roster: readonly KeyedPlayer[], side: "home" | "away"): LeaderBox[] {
  const candidates: Candidate[] = sidePlayers(roster, side).flatMap(({ player, order }) => {
    const tally = board.tallies.get(player.playerId);
    if (!tally) return [];
    return [{ player, order, stats: tally.stats, estimated: new Set(tally.estimated), reached: board.reached.get(player.playerId) ?? {} }];
  });
  return LEADER_CATEGORIES.map((category) => box(category, candidates));
}

/** The season's leaders on one side, from the uploaded season stats, for a game without live stats. */
export function seasonLeaders(roster: readonly KeyedPlayer[], side: "home" | "away", sport: string | null = "football"): LeaderBox[] {
  if (sport === "basketball" || sport === "volleyball" || sport === "ice_hockey" || sport === "soccer") return sportSeasonLeaders(roster, side, sport);
  const candidates: Candidate[] = sidePlayers(roster, side).flatMap(({ player, order }) =>
    player.season ? [{ player, order, stats: player.season, estimated: new Set<FootballStatKey>(), reached: {} }] : [],
  );
  return LEADER_CATEGORIES.map((category) => box(category, candidates));
}

// =============================================================================
// Basketball and volleyball (Nov 2): the season's four leaders from the
// uploaded totals. Basketball leads by per-game average when the sheet gave
// games played (a player who missed games is not behind for it), else by the
// total; volleyball by the total, the way its leaders are read. A tie goes to
// roster order.
// =============================================================================

interface SportRule {
  /** The number a leader is chosen by and shows; null when the player has none. */
  value(stats: SeasonNumbers): number | null;
  /** Shown under the number: per game or total. */
  unit(stats: SeasonNumbers): LeaderBox["unit"];
  /** After the category, or "". */
  support(stats: SeasonNumbers): string;
}

function positiveOf(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Per game when games played are known. */
function perGame(total: number | null, stats: SeasonNumbers): number | null {
  if (total === null) return null;
  const games = positiveOf(stats.gp);
  return games ? total / games : total;
}

function basketballRule(total: (stats: SeasonNumbers) => number | null, perGameUnit: LeaderBox["unit"], totalUnit: LeaderBox["unit"]): SportRule {
  return {
    value: (stats) => perGame(total(stats), stats),
    unit: (stats) => (positiveOf(stats.gp) ? perGameUnit : totalUnit),
    support: () => "",
  };
}

/** A hockey skater's points: the sheet's own, else goals plus assists. */
function hockeyPoints(stats: SeasonNumbers): number | null {
  return positiveOf(stats.h_points) ?? positiveOf((stats.h_goals ?? 0) + (stats.h_assists ?? 0));
}

/** A goalie's save percentage, once he has faced MIN_SHOTS_AGAINST shots. */
function hockeySavePercent(stats: SeasonNumbers): number | null {
  const against = positiveOf(stats.h_shots_against) ?? (positiveOf(stats.h_saves) !== null ? (stats.h_saves ?? 0) + (stats.h_goals_against ?? 0) : null);
  if (against === null || against < MIN_SHOTS_AGAINST) return null;
  const saves = positiveOf(stats.h_saves) ?? against - (stats.h_goals_against ?? 0);
  return saves / against;
}

/** A soccer player's points: the sheet's own, else 2 a goal and 1 an assist. */
function soccerPoints(stats: SeasonNumbers): number | null {
  return positiveOf(stats.s_points) ?? positiveOf(2 * (stats.s_goals ?? 0) + (stats.s_assists ?? 0));
}

/** A keeper's save percentage, once he has faced MIN_SHOTS_FACED shots on goal. */
function soccerSavePercent(stats: SeasonNumbers): number | null {
  const faced = shotsFaced(stats);
  if (faced === null || faced < MIN_SHOTS_FACED) return null;
  const saves = positiveOf(stats.s_saves) ?? faced - (stats.s_goals_against ?? 0);
  return saves / faced;
}

const SPORT_RULES: Partial<Record<LeaderCategory, { basketball?: SportRule; volleyball?: SportRule; ice_hockey?: SportRule; soccer?: SportRule }>> = {
  PTS: {
    basketball: basketballRule((stats) => positiveOf(stats.pts), "PPG", "PTS"),
    // "7G 13A" beside the points.
    ice_hockey: {
      value: hockeyPoints,
      unit: () => "PTS",
      support: (stats) => `${numberText(stats.h_goals ?? 0)}G ${numberText(stats.h_assists ?? 0)}A`,
    },
    soccer: {
      value: soccerPoints,
      unit: () => "PTS",
      support: (stats) => `${numberText(stats.s_goals ?? 0)}G ${numberText(stats.s_assists ?? 0)}A`,
    },
  },
  G: {
    ice_hockey: { value: (stats) => positiveOf(stats.h_goals), unit: () => "G", support: (stats) => (positiveOf(stats.h_ppg) ? `${numberText(stats.h_ppg!)} PPG` : "") },
    soccer: { value: (stats) => positiveOf(stats.s_goals), unit: () => "G", support: (stats) => (positiveOf(stats.s_sog) ? `${numberText(stats.s_sog!)} SOG` : "") },
  },
  A: {
    ice_hockey: { value: (stats) => positiveOf(stats.h_assists), unit: () => "A", support: () => "" },
    soccer: { value: (stats) => positiveOf(stats.s_assists), unit: () => "A", support: () => "" },
  },
  "SV%": {
    soccer: {
      value: soccerSavePercent,
      unit: () => "SV%",
      support: (stats) => {
        const gaa = soccerGoalsAgainstAverage(stats);
        return gaa ? `${gaa} GAA` : "";
      },
    },
    ice_hockey: {
      value: hockeySavePercent,
      unit: () => "SV%",
      support: (stats) => {
        const gaa = goalsAgainstAverage(stats);
        return gaa ? `${gaa} GAA` : "";
      },
    },
  },
  REB: { basketball: basketballRule((stats) => positiveOf(stats.reb) ?? positiveOf((stats.oreb ?? 0) + (stats.dreb ?? 0)), "RPG", "REB") },
  AST: {
    basketball: basketballRule((stats) => positiveOf(stats.ast), "APG", "AST"),
    volleyball: { value: (stats) => positiveOf(stats.assists), unit: () => "AST", support: () => "" },
  },
  STL: { basketball: basketballRule((stats) => positiveOf(stats.stl), "SPG", "STL") },
  KILLS: {
    volleyball: {
      value: (stats) => positiveOf(stats.kills),
      unit: () => "KILLS",
      // Kills per set, when the sheet gave sets played.
      support: (stats) => {
        const kills = positiveOf(stats.kills);
        const sets = positiveOf(stats.sets);
        return kills && sets ? `${(Math.round((kills / sets) * 10) / 10).toFixed(1)}/set` : "";
      },
    },
  },
  DIGS: { volleyball: { value: (stats) => positiveOf(stats.digs), unit: () => "DIGS", support: () => "" } },
  ACES: { volleyball: { value: (stats) => positiveOf(stats.aces), unit: () => "ACES", support: () => "" } },
};

/** "18.4" for an average, "1,204" for a total. */
function leaderNumber(value: number, unit: LeaderBox["unit"]): string {
  if (unit === "SV%") return savePercentText(value, 1);
  return ["PPG", "RPG", "APG", "SPG"].includes(unit) ? (Math.round(value * 10) / 10).toFixed(1) : numberText(value);
}

function sportSeasonLeaders(roster: readonly KeyedPlayer[], side: "home" | "away", sport: "basketball" | "volleyball" | "ice_hockey" | "soccer"): LeaderBox[] {
  const categories = sport === "basketball" ? BASKETBALL_LEADERS : sport === "ice_hockey" ? HOCKEY_LEADERS : sport === "soccer" ? SOCCER_LEADERS : VOLLEYBALL_LEADERS;
  const players = sidePlayers(roster, side).filter(({ player }) => player.season);
  return categories.map((category) => {
    const rule = SPORT_RULES[category]?.[sport];
    let best: { player: KeyedPlayer; stats: SeasonNumbers; value: number } | null = null;
    for (const { player } of players) {
      const stats = player.season as SeasonNumbers;
      const value = rule?.value(stats) ?? null;
      if (value === null) continue;
      // Strictly more: a tie keeps the earlier player in roster order.
      if (!best || value > best.value) best = { player, stats, value };
    }
    const emptyUnit: LeaderBox["unit"] = rule ? rule.unit({}) : "PTS";
    if (!rule || !best) return { category, number: NO_LEADER, unit: emptyUnit, support: "", name: null, playerId: null };
    const unit = rule.unit(best.stats);
    return {
      category,
      number: leaderNumber(best.value, unit),
      unit,
      support: rule.support(best.stats),
      name: titleCase(best.player.last),
      playerId: best.player.playerId,
    };
  });
}
