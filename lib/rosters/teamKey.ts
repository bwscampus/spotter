/** The five fields a team is identified by. Plain strings: this is text joining, not validation. */
export interface TeamIdentity {
  school: string | null;
  sport: string | null;
  gender: string | null;
  level: string | null;
  season: string | null;
}

/**
 * Mirrors the roster_key built inside save_roster. Used to look up an
 * existing team before saving, so the announcer can be warned that this
 * replaces a roster, and to rebuild the key when a team is renamed. The
 * database remains the source of truth: if these ever disagree, the upsert
 * still does the right thing.
 */
export function teamKey(team: TeamIdentity): string {
  const part = (value: string | null | undefined) => (value ?? "").trim();
  return [part(team.school), part(team.sport), part(team.gender), part(team.level), part(team.season)]
    .join("|")
    .toLowerCase();
}
