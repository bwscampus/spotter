import { titleCase } from "@/lib/cards/cardFace";
import { ESTIMATE_MARK } from "@/lib/cards/lines";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import type { FootballStatKey, FootballStats } from "@/lib/cards/statKeys";
import type { TonightTally } from "@/lib/cards/tonight";
import { statsKindFor } from "@/lib/stats/types";

// =============================================================================
// The team panel's four leader boxes (docs/PANEL_SPEC.md): PASS and RUSH on
// top, REC and TKL under them. Each shows the player on that team with the
// most of its big number, tonight from live stats, or for the season when the
// game has no live stats. Pure, so who leads is tested.
// =============================================================================

export type LeaderCategory = "PASS" | "RUSH" | "REC" | "TKL";

/** Left to right, top to bottom. */
export const LEADER_CATEGORIES: readonly LeaderCategory[] = ["PASS", "RUSH", "REC", "TKL"];

/** The number shown before anyone has one. */
export const NO_LEADER = "–";

export interface LeaderBox {
  category: LeaderCategory;
  /** "~212", "1,204", or "–" before anyone has a stat in the category. */
  number: string;
  /** Under the number: "YDS" or "TKL". */
  unit: "YDS" | "TKL";
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

const CATEGORIES: Record<LeaderCategory, Category> = {
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

/** Whether a sport's games have these four categories at all. Football only; volleyball and the rest have none. */
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

function box(category: LeaderCategory, candidates: readonly Candidate[]): LeaderBox {
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
export function seasonLeaders(roster: readonly KeyedPlayer[], side: "home" | "away"): LeaderBox[] {
  const candidates: Candidate[] = sidePlayers(roster, side).flatMap(({ player, order }) =>
    player.season ? [{ player, order, stats: player.season, estimated: new Set<FootballStatKey>(), reached: {} }] : [],
  );
  return LEADER_CATEGORIES.map((category) => box(category, candidates));
}
