import type { ScheduleRow, ScheduleSaveGame } from "@/lib/schedule/types";
import { query, queryOne } from "../db";

// A team's schedule, always scoped to its owner (Production Standard API-1).
// Every function takes the signed-in user's id first, from the session, and
// every query filters by it, so another account's team simply finds nothing.

/** Who a schedule is for, as the model is told: the team's name, sport and season. Null when it is not this account's team. */
export async function getScheduleTeam(
  ownerId: string,
  teamId: string,
): Promise<{ school: string; mascot: string | null; sport: string; season: string | null } | null> {
  return queryOne("select school, mascot, sport, season from rosters where id = $1 and owner_id = $2", [teamId, ownerId]);
}

/** A team's saved games, oldest first. Empty for a team with none, or one that is not this account's. */
export async function getSchedule(ownerId: string, teamId: string): Promise<ScheduleRow[]> {
  return query<ScheduleRow>(
    `select team_id, game_date::text as game_date, opponent, site, team_score, opponent_score, is_league
       from schedule_games
      where owner_id = $1 and team_id = $2
      order by game_date asc, created_at asc`,
    [ownerId, teamId],
  );
}

/** Replaces a team's whole schedule through set_schedule (one transaction). Returns how many games it now has. */
export async function setSchedule(ownerId: string, teamId: string, games: readonly ScheduleSaveGame[]): Promise<number> {
  const row = await queryOne<{ saved: number }>("select public.set_schedule($1, $2, $3::jsonb) as saved", [
    ownerId,
    teamId,
    JSON.stringify(games),
  ]);
  return row?.saved ?? 0;
}
