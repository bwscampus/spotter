import { FOOTBALL_KEY_GROUPS, FOOTBALL_STAT_KEYS, FOOTBALL_STAT_LABELS, type FootballStatKey } from "./statKeys";

// =============================================================================
// Season stats as numbers, by sport (Nov 2: basketball and volleyball join
// football). Football's keys stay in statKeys.ts, untouched; this file adds the
// other two and the one place that says which keys a sport has.
//
// The keys never share a name with football's: football's fgm and fga are kicks,
// so basketball's field goals are fg_made and fg_att. A number saved for one
// sport can never be read as another's. Only gp (games played) is shared, and it
// means the same thing in all three.
//
// Totals only. A rate (points per game, kills per set, a percentage) is worked
// out from the totals where the card or the panel needs it, never stored.
//
// The database keeps the union of every sport's keys in clean_season_stats
// (db/migrations/0022_basketball_volleyball_stats.sql), and a test compares them.
// In lib/cards/ because the card path and setup both read it.
// =============================================================================

export const BASKETBALL_STAT_KEYS = [
  "gp",
  "min",
  "pts",
  "fg_made",
  "fg_att",
  "three_made",
  "three_att",
  "ft_made",
  "ft_att",
  "oreb",
  "dreb",
  "reb",
  "ast",
  "stl",
  "blk",
  "tov",
  "pf",
] as const;

export const VOLLEYBALL_STAT_KEYS = [
  "gp",
  "sets",
  "kills",
  "attack_err",
  "attack_att",
  "assists",
  "aces",
  "serve_err",
  "digs",
  "solo_blocks",
  "block_assists",
  "blocks",
  "recv_err",
] as const;

export type BasketballStatKey = (typeof BASKETBALL_STAT_KEYS)[number];
export type VolleyballStatKey = (typeof VOLLEYBALL_STAT_KEYS)[number];
export type StatKey = FootballStatKey | BasketballStatKey | VolleyballStatKey;

/** A player's numbers for their sport. A missing key means the sheet had nothing for it, which is not zero. */
export type SeasonNumbers = Partial<Record<StatKey, number>>;

/** The sports whose season stats are numbers. Every other sport's are written lines. */
export const NUMBER_SPORTS = ["football", "basketball", "volleyball"] as const;
export type NumberSport = (typeof NUMBER_SPORTS)[number];

/** Every key any sport has, once each, football's first: what clean_season_stats keeps. */
export const SEASON_STAT_KEYS: readonly StatKey[] = [...new Set<StatKey>([...FOOTBALL_STAT_KEYS, ...BASKETBALL_STAT_KEYS, ...VOLLEYBALL_STAT_KEYS])];

export function numberSport(sport: string | null | undefined): NumberSport | null {
  return (NUMBER_SPORTS as readonly string[]).includes(sport ?? "") ? (sport as NumberSport) : null;
}

const KEYS: Record<NumberSport, readonly StatKey[]> = {
  football: FOOTBALL_STAT_KEYS,
  basketball: BASKETBALL_STAT_KEYS,
  volleyball: VOLLEYBALL_STAT_KEYS,
};

/** A sport's keys in the order its sheet and the review table give them. */
export function statKeysFor(sport: NumberSport): readonly StatKey[] {
  return KEYS[sport];
}

export const BASKETBALL_STAT_LABELS: Record<BasketballStatKey, string> = {
  gp: "GP",
  min: "Min",
  pts: "Pts",
  fg_made: "FGM",
  fg_att: "FGA",
  three_made: "3PM",
  three_att: "3PA",
  ft_made: "FTM",
  ft_att: "FTA",
  oreb: "Off reb",
  dreb: "Def reb",
  reb: "Reb",
  ast: "Ast",
  stl: "Stl",
  blk: "Blk",
  tov: "TO",
  pf: "PF",
};

export const VOLLEYBALL_STAT_LABELS: Record<VolleyballStatKey, string> = {
  gp: "Matches",
  sets: "Sets",
  kills: "Kills",
  attack_err: "Att err",
  attack_att: "Att",
  assists: "Ast",
  aces: "Aces",
  serve_err: "Srv err",
  digs: "Digs",
  solo_blocks: "Solo blk",
  block_assists: "Blk ast",
  blocks: "Blocks",
  recv_err: "Rec err",
};

/** Short column headings for the review table, in the words that sport's stats sheet uses. */
export function statLabel(sport: NumberSport, key: StatKey): string {
  if (sport === "basketball") return BASKETBALL_STAT_LABELS[key as BasketballStatKey] ?? key;
  if (sport === "volleyball") return VOLLEYBALL_STAT_LABELS[key as VolleyballStatKey] ?? key;
  return FOOTBALL_STAT_LABELS[key as FootballStatKey] ?? key;
}

/** Whether a key belongs to the sport. */
export function isStatKeyOf(sport: NumberSport, value: unknown): value is StatKey {
  return typeof value === "string" && (KEYS[sport] as readonly string[]).includes(value);
}

/**
 * Keeps only the sport's keys holding finite numbers, the rule clean_season_stats
 * applies in the database (which keeps every sport's). Anything else is dropped
 * rather than refused. Null when nothing is left, which reads as "no season stats".
 */
export function cleanStatsFor(sport: NumberSport, raw: unknown): SeasonNumbers | null {
  return cleanKeys(KEYS[sport], raw);
}

/**
 * Every sport's keys at once, for a row whose sport is not to hand (the keyed
 * roster a snapshot carries). A row only ever holds its own sport's keys, because
 * the import cleans by sport.
 */
export function cleanSeasonNumbers(raw: unknown): SeasonNumbers | null {
  return cleanKeys(SEASON_STAT_KEYS, raw);
}

function cleanKeys(keys: readonly StatKey[], raw: unknown): SeasonNumbers | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const clean: SeasonNumbers = {};
  let any = false;
  for (const key of keys) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
      any = true;
    }
  }
  return any ? clean : null;
}

/** True when every number is zero or there are none: nothing worth a card line. */
export function isEmptyNumbers(sport: NumberSport, stats: SeasonNumbers | null): boolean {
  if (!stats) return true;
  return KEYS[sport].every((key) => !stats[key]);
}

/** One call's share of a sheet: which sections to read and which keys they fill. */
export interface KeyGroup {
  name: string;
  sections: string;
  keys: readonly StatKey[];
}

const BASKETBALL_KEY_GROUPS: readonly KeyGroup[] = [
  {
    name: "all",
    sections: "every section (Scoring or Shooting, Rebounding, Assists, Steals, Blocks, Turnovers, Fouls)",
    keys: BASKETBALL_STAT_KEYS,
  },
];

const VOLLEYBALL_KEY_GROUPS: readonly KeyGroup[] = [
  {
    name: "all",
    sections: "every section (Attacking, Serving, Setting, Serve Receive, Digging or Defense, Blocking)",
    keys: VOLLEYBALL_STAT_KEYS,
  },
];

/**
 * How a sport's sheet is read: one call per group, at the same time, joined by
 * player afterwards. Football needs three (a seven page sheet ran past the route's
 * budget in one); a basketball or volleyball sheet is a page or two, so one call.
 */
export function keyGroupsFor(sport: NumberSport): readonly KeyGroup[] {
  if (sport === "basketball") return BASKETBALL_KEY_GROUPS;
  if (sport === "volleyball") return VOLLEYBALL_KEY_GROUPS;
  return FOOTBALL_KEY_GROUPS;
}

const BASKETBALL_GROUP_OF: Record<BasketballStatKey, string> = {
  gp: "Games",
  min: "Games",
  pts: "Scoring",
  fg_made: "Scoring",
  fg_att: "Scoring",
  three_made: "Scoring",
  three_att: "Scoring",
  ft_made: "Scoring",
  ft_att: "Scoring",
  oreb: "Rebounds",
  dreb: "Rebounds",
  reb: "Rebounds",
  ast: "Passing",
  stl: "Defence",
  blk: "Defence",
  tov: "Other",
  pf: "Other",
};

const VOLLEYBALL_GROUP_OF: Record<VolleyballStatKey, string> = {
  gp: "Played",
  sets: "Played",
  kills: "Attacking",
  attack_err: "Attacking",
  attack_att: "Attacking",
  assists: "Setting",
  aces: "Serving",
  serve_err: "Serving",
  digs: "Defence",
  recv_err: "Defence",
  solo_blocks: "Blocking",
  block_assists: "Blocking",
  blocks: "Blocking",
};

/** The review table's group heading for a basketball or volleyball column. Football's are columnGroups.ts's. */
export function sportGroupOf(sport: "basketball" | "volleyball", key: StatKey): string {
  const groups: Record<string, string> = sport === "basketball" ? BASKETBALL_GROUP_OF : VOLLEYBALL_GROUP_OF;
  return groups[key] ?? "Other";
}
