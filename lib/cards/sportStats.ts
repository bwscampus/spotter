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

/**
 * Ice hockey (Nov 6): a skater's line and a goalie's line on one list, as a
 * hockey stats page prints them in two tables. Every key starts h_ so none is
 * read as another sport's (volleyball's assists, basketball's pts). Plus/minus
 * may be negative; minutes are a goalie's minutes played ("179:30" is 179.5).
 */
export const HOCKEY_STAT_KEYS = [
  "gp",
  "h_goals",
  "h_assists",
  "h_points",
  "h_ppg",
  "h_shg",
  "h_gwg",
  "h_sog",
  "h_plus_minus",
  "h_pim",
  "h_wins",
  "h_losses",
  "h_ties",
  "h_otl",
  "h_shots_against",
  "h_goals_against",
  "h_saves",
  "h_shutouts",
  "h_minutes",
] as const;

/**
 * Soccer (Nov 7): a field player's line and a goalkeeper's on one list, in the
 * columns a high school soccer stats page prints. Every key but gp starts s_.
 * Minutes are minutes played, a keeper's goals against average is worked out
 * from them; shots faced are shots on goal against.
 */
export const SOCCER_STAT_KEYS = [
  "gp",
  "s_minutes",
  "s_goals",
  "s_assists",
  "s_points",
  "s_gwg",
  "s_pk_goals",
  "s_shots",
  "s_sog",
  "s_yellow",
  "s_red",
  "s_wins",
  "s_losses",
  "s_ties",
  "s_shots_faced",
  "s_saves",
  "s_goals_against",
  "s_shutouts",
] as const;

export type BasketballStatKey = (typeof BASKETBALL_STAT_KEYS)[number];
export type VolleyballStatKey = (typeof VOLLEYBALL_STAT_KEYS)[number];
export type HockeyStatKey = (typeof HOCKEY_STAT_KEYS)[number];
export type SoccerStatKey = (typeof SOCCER_STAT_KEYS)[number];
export type StatKey = FootballStatKey | BasketballStatKey | VolleyballStatKey | HockeyStatKey | SoccerStatKey;

/** A player's numbers for their sport. A missing key means the sheet had nothing for it, which is not zero. */
export type SeasonNumbers = Partial<Record<StatKey, number>>;

/** The sports whose season stats are numbers. Every other sport's are written lines. */
export const NUMBER_SPORTS = ["football", "basketball", "volleyball", "ice_hockey", "soccer"] as const;
export type NumberSport = (typeof NUMBER_SPORTS)[number];

/** Every key any sport has, once each, football's first: what clean_season_stats keeps. */
export const SEASON_STAT_KEYS: readonly StatKey[] = [...new Set<StatKey>([...FOOTBALL_STAT_KEYS, ...BASKETBALL_STAT_KEYS, ...VOLLEYBALL_STAT_KEYS, ...HOCKEY_STAT_KEYS, ...SOCCER_STAT_KEYS])];

export function numberSport(sport: string | null | undefined): NumberSport | null {
  return (NUMBER_SPORTS as readonly string[]).includes(sport ?? "") ? (sport as NumberSport) : null;
}

const KEYS: Record<NumberSport, readonly StatKey[]> = {
  football: FOOTBALL_STAT_KEYS,
  basketball: BASKETBALL_STAT_KEYS,
  volleyball: VOLLEYBALL_STAT_KEYS,
  ice_hockey: HOCKEY_STAT_KEYS,
  soccer: SOCCER_STAT_KEYS,
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

/** The headings a hockey stats page uses (skaters, then goalies). */
export const HOCKEY_STAT_LABELS: Record<HockeyStatKey, string> = {
  gp: "GP",
  h_goals: "G",
  h_assists: "A",
  h_points: "Pts",
  h_pim: "PIM",
  h_plus_minus: "+/-",
  h_sog: "SOG",
  h_ppg: "PPG",
  h_shg: "SHG",
  h_gwg: "GWG",
  h_wins: "W",
  h_losses: "L",
  h_ties: "T",
  h_otl: "OTL",
  h_shots_against: "SA",
  h_goals_against: "GA",
  h_saves: "Sv",
  h_shutouts: "SO",
  h_minutes: "Min",
};

/** The headings a soccer stats page uses (field players, then goalkeepers). */
export const SOCCER_STAT_LABELS: Record<SoccerStatKey, string> = {
  gp: "GP",
  s_minutes: "Min",
  s_goals: "G",
  s_assists: "A",
  s_points: "Pts",
  s_gwg: "GWG",
  s_pk_goals: "PKG",
  s_shots: "Sh",
  s_sog: "SOG",
  s_yellow: "YC",
  s_red: "RC",
  s_wins: "W",
  s_losses: "L",
  s_ties: "T",
  s_shots_faced: "SF",
  s_saves: "Sv",
  s_goals_against: "GA",
  s_shutouts: "SO",
};

/** Short column headings for the review table, in the words that sport's stats sheet uses. */
export function statLabel(sport: NumberSport, key: StatKey): string {
  if (sport === "basketball") return BASKETBALL_STAT_LABELS[key as BasketballStatKey] ?? key;
  if (sport === "volleyball") return VOLLEYBALL_STAT_LABELS[key as VolleyballStatKey] ?? key;
  if (sport === "ice_hockey") return HOCKEY_STAT_LABELS[key as HockeyStatKey] ?? key;
  if (sport === "soccer") return SOCCER_STAT_LABELS[key as SoccerStatKey] ?? key;
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

const HOCKEY_KEY_GROUPS: readonly KeyGroup[] = [
  {
    name: "all",
    sections: "both tables: the skaters' (Player) stats and the goalies' stats",
    keys: HOCKEY_STAT_KEYS,
  },
];

const SOCCER_KEY_GROUPS: readonly KeyGroup[] = [
  {
    name: "all",
    sections: "both tables: the field players' stats (Scoring, Shooting, Discipline) and the goalkeepers' stats",
    keys: SOCCER_STAT_KEYS,
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
  if (sport === "ice_hockey") return HOCKEY_KEY_GROUPS;
  if (sport === "soccer") return SOCCER_KEY_GROUPS;
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

const HOCKEY_GROUP_OF: Record<HockeyStatKey, string> = {
  gp: "Played",
  h_goals: "Scoring",
  h_assists: "Scoring",
  h_points: "Scoring",
  h_ppg: "Scoring",
  h_shg: "Scoring",
  h_gwg: "Scoring",
  h_sog: "Shooting",
  h_plus_minus: "Other",
  h_pim: "Other",
  h_wins: "Goalie",
  h_losses: "Goalie",
  h_ties: "Goalie",
  h_otl: "Goalie",
  h_shots_against: "Goalie",
  h_goals_against: "Goalie",
  h_saves: "Goalie",
  h_shutouts: "Goalie",
  h_minutes: "Goalie",
};

const SOCCER_GROUP_OF: Record<SoccerStatKey, string> = {
  gp: "Played",
  s_minutes: "Played",
  s_goals: "Scoring",
  s_assists: "Scoring",
  s_points: "Scoring",
  s_gwg: "Scoring",
  s_pk_goals: "Scoring",
  s_shots: "Shooting",
  s_sog: "Shooting",
  s_yellow: "Cards",
  s_red: "Cards",
  s_wins: "Goalkeeper",
  s_losses: "Goalkeeper",
  s_ties: "Goalkeeper",
  s_shots_faced: "Goalkeeper",
  s_saves: "Goalkeeper",
  s_goals_against: "Goalkeeper",
  s_shutouts: "Goalkeeper",
};

/** The review table's group heading for any number sport's column but football's, whose are columnGroups.ts's. */
export function sportGroupOf(sport: "basketball" | "volleyball" | "ice_hockey" | "soccer", key: StatKey): string {
  const groups: Record<string, string> =
    sport === "basketball" ? BASKETBALL_GROUP_OF : sport === "ice_hockey" ? HOCKEY_GROUP_OF : sport === "soccer" ? SOCCER_GROUP_OF : VOLLEYBALL_GROUP_OF;
  return groups[key] ?? "Other";
}
