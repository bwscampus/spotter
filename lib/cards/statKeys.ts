// =============================================================================
// The football stat keys, docs/V3_DEFINITION.md section 9.2. One list for
// everything that touches a football number: the prompt that reads a season
// stats sheet, the review table, the card lines, and later tonight's totals.
//
// The database keeps the same list in clean_season_stats
// (supabase/migrations/20260928205542_v3_rosters.sql), and a test compares them.
// =============================================================================

export const FOOTBALL_STAT_KEYS = [
  "gp",
  "rush_att",
  "rush_yds",
  "rush_td",
  "pass_cmp",
  "pass_att",
  "pass_yds",
  "pass_td",
  "pass_int",
  "rec",
  "rec_yds",
  "rec_td",
  "tkl",
  "sacks",
  "sack_yds",
  "def_int",
  "int_ret_yds",
  "int_td",
  "pbu",
  "ff",
  "fr",
  "fr_ret_yds",
  "fr_td",
  "fum",
  "fum_lost",
  "kr",
  "kr_yds",
  "kr_td",
  "pr",
  "pr_yds",
  "pr_td",
  "fgm",
  "fga",
  "fg_long",
  "xpm",
  "xpa",
  "punts",
  "punt_yds",
] as const;

export type FootballStatKey = (typeof FOOTBALL_STAT_KEYS)[number];

/** A player's numbers. A missing key means the sheet had nothing for it, which is not zero. */
export type FootballStats = Partial<Record<FootballStatKey, number>>;

/** Short column headings for the review table, in the words a stats sheet uses. */
export const FOOTBALL_STAT_LABELS: Record<FootballStatKey, string> = {
  gp: "GP",
  rush_att: "Car",
  rush_yds: "Rush yds",
  rush_td: "Rush TD",
  pass_cmp: "Cmp",
  pass_att: "Att",
  pass_yds: "Pass yds",
  pass_td: "Pass TD",
  pass_int: "INT thrown",
  rec: "Rec",
  rec_yds: "Rec yds",
  rec_td: "Rec TD",
  tkl: "Tkl",
  sacks: "Sacks",
  sack_yds: "Sack yds",
  def_int: "INT",
  int_ret_yds: "INT yds",
  int_td: "INT TD",
  pbu: "PBU",
  ff: "FF",
  fr: "FR",
  fr_ret_yds: "FR yds",
  fr_td: "FR TD",
  fum: "Fum",
  fum_lost: "Fum lost",
  kr: "KR",
  kr_yds: "KR yds",
  kr_td: "KR TD",
  pr: "PR",
  pr_yds: "PR yds",
  pr_td: "PR TD",
  fgm: "FGM",
  fga: "FGA",
  fg_long: "FG long",
  xpm: "XPM",
  xpa: "XPA",
  punts: "Punts",
  punt_yds: "Punt yds",
};

export function isFootballStatKey(value: unknown): value is FootballStatKey {
  return typeof value === "string" && (FOOTBALL_STAT_KEYS as readonly string[]).includes(value);
}

/**
 * Keeps only known keys holding finite numbers, the same rule clean_season_stats
 * applies in the database. Anything else is dropped rather than refused, so a
 * stray field from a reply or an old row never blocks a save. Null when nothing
 * is left, which the card reads as "no season stats".
 */
export function cleanFootballStats(raw: unknown): FootballStats | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const clean: FootballStats = {};
  let any = false;
  for (const key of FOOTBALL_STAT_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      clean[key] = value;
      any = true;
    }
  }
  return any ? clean : null;
}

/** True when every number is zero or there are none: nothing worth a card line. */
export function isEmptyStats(stats: FootballStats | null): boolean {
  if (!stats) return true;
  return FOOTBALL_STAT_KEYS.every((key) => !stats[key]);
}

/**
 * The keys split the way a stats sheet splits its sections, so each group can
 * be read by its own Claude call at the same time (lib/stats/extractStats.ts).
 * Every key is in exactly one group; a test holds that.
 */
export const FOOTBALL_KEY_GROUPS = [
  {
    name: "offense",
    sections: "Passing, Rushing, Receiving, and Offensive Fumbles",
    keys: [
      "gp",
      "pass_cmp",
      "pass_att",
      "pass_yds",
      "pass_td",
      "pass_int",
      "rush_att",
      "rush_yds",
      "rush_td",
      "rec",
      "rec_yds",
      "rec_td",
      "fum",
      "fum_lost",
    ],
  },
  {
    name: "defense",
    sections: "Tackles, Sacks, and Defensive Statistics (interceptions, passes defended, forced fumbles, fumble recoveries)",
    keys: ["tkl", "sacks", "sack_yds", "def_int", "int_ret_yds", "int_td", "pbu", "ff", "fr", "fr_ret_yds", "fr_td"],
  },
  {
    name: "special_teams",
    sections: "Kickoff and Punt Returns, Kicking (PATs and Field Goals), and Punts",
    keys: ["kr", "kr_yds", "kr_td", "pr", "pr_yds", "pr_td", "fgm", "fga", "fg_long", "xpm", "xpa", "punts", "punt_yds"],
  },
] as const satisfies ReadonlyArray<{ name: string; sections: string; keys: readonly FootballStatKey[] }>;

export type FootballKeyGroup = (typeof FOOTBALL_KEY_GROUPS)[number];
