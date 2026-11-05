import { daysBetween, STALE_STATS_DAYS } from "@/lib/game/staleStats";
import { staleAge } from "@/lib/game/setupWarnings";
import { isSport, type Sport, type TeamSummary } from "@/lib/rosters/types";
import { weekdayOf } from "@/lib/schedule/record";
import { dayLabel } from "@/lib/ui/format";

// =============================================================================
// Draft games (Nov 3, Jed): a game set up but not started. It lives in the
// account (a called_games row with status 'draft', db/migrations/0025), so it
// can be prepped on one computer and started on another. It points at the two
// teams and never copies a player: Start builds the game from the rosters as
// they are then.
//
// Pure: what a draft is called, where it stands and when it is, so Home, the
// Games page and the walkthrough say the same thing and it is tested.
// Dates are "YYYY-MM-DD" in the announcer's own time zone (useToday), read
// from the string so no time zone moves a day.
// =============================================================================

export type DraftSide = "away" | "home";

export interface Draft {
  id: string;
  /** "YYYY-MM-DD". */
  gameDate: string;
  sport: Sport | null;
  awayId: string | null;
  homeId: string | null;
  /** The saved team's school, or null with no team (or a team since deleted). */
  awaySchool: string | null;
  homeSchool: string | null;
  wearing: { away: string | null; home: string | null };
  /** Share a scrubbed copy of the game's log at the end (lib/log/shareLog.ts). */
  share: boolean;
}

/** A row as lib/server/repo/games.ts reads it. */
export interface DraftRow {
  id: string;
  game_date: string;
  sport: string | null;
  home_roster_id: string | null;
  away_roster_id: string | null;
  home_school: string | null;
  away_school: string | null;
  wearing_home: string | null;
  wearing_away: string | null;
  share_log: boolean;
}

export function toDraft(row: DraftRow): Draft {
  return {
    id: row.id,
    gameDate: row.game_date,
    sport: isSport(row.sport) ? row.sport : null,
    awayId: row.away_roster_id,
    homeId: row.home_roster_id,
    // A team id whose team is gone reads as no team.
    awaySchool: row.away_roster_id ? row.away_school : null,
    homeSchool: row.home_roster_id ? row.home_school : null,
    wearing: { away: row.wearing_away, home: row.wearing_home },
    share: row.share_log,
  };
}

/** What the browser sends to save a draft. Every field optional on an update; roster ids may be null to clear a side. */
export interface DraftFields {
  game_date?: string;
  sport?: Sport | null;
  away_roster_id?: string | null;
  home_roster_id?: string | null;
  wearing_away?: string | null;
  wearing_home?: string | null;
  share_log?: boolean;
}

/** At most this many characters of "what they're wearing" (the column's check). */
export const MAX_WEARING_CHARS = 40;

export type DraftStatus = { kind: "needs_team"; side: DraftSide } | { kind: "stale"; weeks: number; text: string } | { kind: "ready" };

/**
 * Where a draft stands, from what is already on the page: a missing team (the
 * only thing that stops Start), else the older team's stats once they are a
 * week old (a heads-up), else ready. No paid call is made to say it.
 */
export function draftStatus(draft: Draft, teams: ReadonlyArray<Pick<TeamSummary, "id" | "statsAsOf">>, today: string): DraftStatus {
  const team = (id: string | null) => (id ? (teams.find((each) => each.id === id) ?? null) : null);
  const away = team(draft.awayId);
  const home = team(draft.homeId);
  if (!away) return { kind: "needs_team", side: "away" };
  if (!home) return { kind: "needs_team", side: "home" };
  let oldest: number | null = null;
  for (const side of [away, home]) {
    const days = side.statsAsOf ? daysBetween(side.statsAsOf, today) : null;
    if (days !== null && days >= STALE_STATS_DAYS && (oldest === null || days > oldest)) oldest = days;
  }
  if (oldest !== null) return { kind: "stale", weeks: Math.max(1, Math.floor(oldest / 7)), text: `Stats ${staleAge(oldest)}` };
  return { kind: "ready" };
}

/** The status in plain words: "Ready", "Needs the away team", "Stats 3 weeks old". */
export function statusText(status: DraftStatus): string {
  if (status.kind === "needs_team") return `Needs the ${status.side} team`;
  if (status.kind === "stale") return status.text;
  return "Ready";
}

/** Start is allowed with both teams; old stats are a heads-up, never a block. */
export function canStart(status: DraftStatus): boolean {
  return status.kind !== "needs_team";
}

/** "Serra at St. John Bosco", with "?" for a side not picked yet. */
export function draftTitle(draft: Pick<Draft, "awaySchool" | "homeSchool">): string {
  return `${draft.awaySchool ?? "?"} at ${draft.homeSchool ?? "?"}`;
}

/** "Fri Nov 6" for "2026-11-06". */
export function gameDay(date: string): string {
  const weekday = weekdayOf(date);
  return weekday ? `${weekday} ${dayLabel(date)}` : dayLabel(date);
}

export function datePassed(draft: Pick<Draft, "gameDate">, today: string): boolean {
  return draft.gameDate < today;
}

export function isTonight(draft: Pick<Draft, "gameDate">, today: string): boolean {
  return draft.gameDate === today;
}

/** The soonest draft dated today or later, or null. Drafts come soonest first already; this does not rely on it. */
export function nextDraft(drafts: readonly Draft[], today: string): Draft | null {
  let next: Draft | null = null;
  for (const draft of drafts) {
    if (draft.gameDate < today) continue;
    if (!next || draft.gameDate < next.gameDate) next = draft;
  }
  return next;
}

/** The coming Friday, or today when today is a Friday: when most high school games are. */
export function comingFriday(today: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!match) return today;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const ahead = (5 - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + ahead);
  return date.toISOString().slice(0, 10);
}
