import type { FootballStatKey } from "@/lib/cards/statKeys";

// =============================================================================
// The stats review table's group row: which heading each stat column sits
// under. Pure, so the grouping is tested.
// =============================================================================

const GROUP_OF: Record<FootballStatKey, string> = {
  gp: "Games",
  rush_att: "Rushing",
  rush_yds: "Rushing",
  rush_td: "Rushing",
  pass_cmp: "Passing",
  pass_att: "Passing",
  pass_yds: "Passing",
  pass_td: "Passing",
  pass_int: "Passing",
  rec: "Receiving",
  rec_yds: "Receiving",
  rec_td: "Receiving",
  tkl: "Defence",
  sacks: "Defence",
  sack_yds: "Defence",
  def_int: "Defence",
  int_ret_yds: "Defence",
  int_td: "Defence",
  pbu: "Defence",
  ff: "Defence",
  fr: "Defence",
  fr_ret_yds: "Defence",
  fr_td: "Defence",
  fum: "Fumbles",
  fum_lost: "Fumbles",
  kr: "Returns",
  kr_yds: "Returns",
  kr_td: "Returns",
  pr: "Returns",
  pr_yds: "Returns",
  pr_td: "Returns",
  fgm: "Kicking",
  fga: "Kicking",
  fg_long: "Kicking",
  xpm: "Kicking",
  xpa: "Kicking",
  punts: "Punting",
  punt_yds: "Punting",
};

export interface ColumnGroup {
  label: string;
  keys: FootballStatKey[];
}

/** The columns, in the order given, gathered into runs under one heading each. */
export function columnGroups(columns: readonly FootballStatKey[]): ColumnGroup[] {
  const groups: ColumnGroup[] = [];
  for (const key of columns) {
    const label = GROUP_OF[key];
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.keys.push(key);
    else groups.push({ label, keys: [key] });
  }
  return groups;
}
