import { pageUser } from "@/lib/server/pageUser";
import { getRoster, listRosters, type LoadedRoster } from "@/lib/server/repo/rosters";
import type { TeamSummary } from "./types";

// =============================================================================
// Reading saved teams for the pages: V3's API (same names and shapes, so V3's
// pages port unchanged), served from lib/server/repo/rosters.ts for the
// signed-in user. Server only.
//
// A failed read is never an empty list (V3 audit M12): an editor opened on a
// roster whose players did not load would save that emptiness over them, and
// "No teams yet" over a failed read sends the announcer to import a team they
// already have.
// =============================================================================

export type { LoadedRoster };

/** The team list, or that it could not be read. */
export type TeamList = { status: "ok"; teams: TeamSummary[] } | { status: "error" };

/** One team, that it is not this account's (or not there), or that it could not be read. */
export type RosterLoad = { status: "ok"; roster: LoadedRoster } | { status: "missing" } | { status: "error" };

/** What a page says when a read failed. */
export const TEAM_LOAD_ERROR = "Couldn't load this team. Reload to try again.";
export const TEAMS_LOAD_ERROR = "Couldn't load your teams. Reload to try again.";

/** Thrown by loadRoster when a read failed, so no page mistakes it for a team with no players. */
export class RosterLoadError extends Error {
  constructor() {
    super(TEAM_LOAD_ERROR);
    this.name = "RosterLoadError";
  }
}

/** Every team this account has saved, by school, with player counts and how new their season stats are. */
export async function loadTeamList(): Promise<TeamList> {
  const user = await pageUser();
  try {
    return { status: "ok", teams: await listRosters(user.id) };
  } catch {
    return { status: "error" };
  }
}

/**
 * The team list for screens that only offer teams to pick (the menu, game
 * setup), where a failed read shows as none. /teams uses loadTeamList and says
 * the read failed.
 */
export async function loadRosters(): Promise<TeamSummary[]> {
  const list = await loadTeamList();
  return list.status === "ok" ? list.teams : [];
}

/** One saved team and its players in roster order. A failed read is an error, never an empty roster. */
export async function loadRosterState(id: string): Promise<RosterLoad> {
  const user = await pageUser();
  try {
    const roster = await getRoster(user.id, id);
    return roster ? { status: "ok", roster } : { status: "missing" };
  } catch {
    return { status: "error" };
  }
}

/**
 * One saved team, or null if it is not this account's. A failed read throws
 * RosterLoadError rather than returning a team with no players.
 */
export async function loadRoster(id: string): Promise<LoadedRoster | null> {
  const load = await loadRosterState(id);
  if (load.status === "error") throw new RosterLoadError();
  return load.status === "ok" ? load.roster : null;
}
