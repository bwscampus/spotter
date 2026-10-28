import { pageUser } from "@/lib/server/pageUser";
import { getSchedule, getScheduleTeam } from "@/lib/server/repo/schedule";
import { scheduleFor, type ScheduleGame } from "./types";

// =============================================================================
// Reading one team's saved schedule for the Schedule page, for the signed-in
// user. Server only. A failed read is an error, never an empty schedule: a
// table opened empty over a schedule that did not load would save that
// emptiness over it.
// =============================================================================

export interface ScheduleTeamInfo {
  school: string;
  mascot: string | null;
  sport: string;
  season: string | null;
}

export type ScheduleLoad =
  | { status: "ok"; team: ScheduleTeamInfo; games: ScheduleGame[] }
  | { status: "missing" }
  | { status: "error" };

export async function loadScheduleState(teamId: string): Promise<ScheduleLoad> {
  const user = await pageUser();
  try {
    const team = await getScheduleTeam(user.id, teamId);
    if (!team) return { status: "missing" };
    return { status: "ok", team, games: scheduleFor(await getSchedule(user.id, teamId), teamId) };
  } catch {
    return { status: "error" };
  }
}
