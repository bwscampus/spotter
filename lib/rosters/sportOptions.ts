import { SPORT_LABELS, SPORTS, isSport, type Sport } from "@/lib/rosters/types";

// =============================================================================
// The Sport list on a new team (Nov 3): the sports the announcer said they
// call in "About you" come first, and "Other sports..." opens the rest. With
// exactly one, a new team starts with it picked. Pure, so the order is tested.
// =============================================================================

/** The option that opens the full list. Never a sport, never saved. */
export const MORE_SPORTS = "__more";

export interface SportOption {
  value: Sport | typeof MORE_SPORTS;
  label: string;
}

const option = (sport: Sport): SportOption => ({ value: sport, label: SPORT_LABELS[sport] });

/**
 * The options, in order. `mine` is the announcer's sports; `current` is what
 * the team has picked now, which is always listed so the select can show it;
 * `expanded` is whether "Other sports..." was chosen.
 */
export function sportOptions(mine: readonly Sport[], current: string, expanded: boolean): SportOption[] {
  const first = SPORTS.filter((sport) => mine.includes(sport));
  if (first.length === 0) return SPORTS.map(option);
  const rest = SPORTS.filter((sport) => !first.includes(sport));
  if (expanded) return [...first, ...rest].map(option);
  const shown = isSport(current) && !first.includes(current) ? [...first, current] : first;
  return shown.length < SPORTS.length ? [...shown.map(option), { value: MORE_SPORTS, label: "Other sports..." }] : shown.map(option);
}

/** A new team's sport before anything is picked: the announcer's one sport, else none. */
export function startingSport(mine: readonly Sport[]): Sport | "" {
  const known = SPORTS.filter((sport) => mine.includes(sport));
  return known.length === 1 ? known[0] : "";
}
