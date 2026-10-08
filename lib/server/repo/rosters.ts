import type { GamePlayerRow, GameRosterRow } from "@/lib/game/buildGame";
import type { Json } from "@/lib/json";
import type { SavedSeason, TeamDraft } from "@/lib/rosters/editor";
import { newestAsOf } from "@/lib/game/staleStats";
import { isGender, isLevel, isSport, isSpotMode, type RosterPlayer, type TeamSummary } from "@/lib/rosters/types";
import { query, queryOne } from "../db";

// Rosters, always scoped to their owner (Production Standard API-1). Every
// function takes the signed-in user's id first, from the session, and every
// query filters by it, so another account's id simply finds nothing.

export interface LoadedRoster {
  id: string;
  team: TeamDraft;
  players: Array<{ player: RosterPlayer; season: SavedSeason | null }>;
}

/** Every team this account has saved, by school, with how many players each has. */
export async function listRosters(ownerId: string): Promise<TeamSummary[]> {
  const rows = await query<{
    id: string;
    school: string;
    mascot: string | null;
    sport: string;
    gender: string | null;
    level: string | null;
    season: string | null;
    updated_at: Date;
    player_count: number;
    stats_as_of: string[] | null;
  }>(
    `select r.id, r.school, r.mascot, r.sport, r.gender, r.level, r.season, r.updated_at,
            (select count(*) from roster_players p where p.roster_id = r.id)::int as player_count,
            (select array_agg(p.stats_as_of::text) from roster_players p where p.roster_id = r.id) as stats_as_of
       from rosters r
      where r.owner_id = $1
      order by r.school asc, r.season desc`,
    [ownerId],
  );
  return rows.map(({ player_count, updated_at, stats_as_of, ...roster }) => ({
    ...roster,
    updated_at: updated_at.toISOString(),
    playerCount: player_count,
    statsAsOf: newestAsOf(stats_as_of ?? []),
  }));
}

/** The id of this account's team with this roster key, if it has one. */
export async function rosterIdForKey(ownerId: string, rosterKey: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>("select id from rosters where owner_id = $1 and roster_key = $2", [ownerId, rosterKey]);
  return row?.id ?? null;
}

/** One team and its players in roster order, or null if it is not this account's. */
export async function getRoster(ownerId: string, id: string): Promise<LoadedRoster | null> {
  const roster = await queryOne<{
    id: string;
    school: string;
    mascot: string | null;
    sport: string;
    gender: string | null;
    level: string | null;
    season: string | null;
    primary_color: string | null;
  }>("select id, school, mascot, sport, gender, level, season, primary_color from rosters where id = $1 and owner_id = $2", [id, ownerId]);
  if (!roster) return null;

  const rows = await query<{
    jersey: string | null;
    first_name: string | null;
    last_name: string;
    position: string | null;
    grade: string | null;
    height: string | null;
    weight: string | null;
    pronunciations: string[];
    heard_as: string[];
    storyline: string;
    spot_mode: string;
    season_stats: Json | null;
    season_lines: string[];
    stats_as_of: string | null;
  }>(
    `select jersey, first_name, last_name, position, grade, height, weight, pronunciations, heard_as, storyline,
            spot_mode, season_stats, season_lines, stats_as_of
       from roster_players
      where roster_id = $1 and owner_id = $2
      order by sort_order asc`,
    [id, ownerId],
  );

  return {
    id: roster.id,
    team: {
      school: roster.school,
      mascot: roster.mascot ?? "",
      sport: isSport(roster.sport) ? roster.sport : "",
      gender: isGender(roster.gender) ? roster.gender : "",
      level: isLevel(roster.level) ? roster.level : "",
      season: roster.season ?? "",
      color: roster.primary_color ?? "",
    },
    players: rows.map((row) => ({
      player: {
        jersey: row.jersey,
        first_name: row.first_name,
        last_name: row.last_name,
        position: row.position,
        grade: row.grade,
        height: row.height,
        weight: row.weight,
        pronunciations: row.pronunciations,
        heard_as: row.heard_as,
        storyline: row.storyline,
        spot_mode: isSpotMode(row.spot_mode) ? row.spot_mode : "normal",
        flags: [],
      },
      season:
        row.season_stats !== null || row.season_lines.length > 0 || row.stats_as_of !== null
          ? { season_stats: row.season_stats, season_lines: row.season_lines, stats_as_of: row.stats_as_of }
          : null,
    })),
  };
}

/** A team's sport and its players' ids and names, for matching a stats sheet. */
export async function getRosterForStats(
  ownerId: string,
  id: string,
): Promise<{ sport: string; players: Array<{ id: string; jersey: string | null; first_name: string | null; last_name: string }> } | null> {
  const roster = await queryOne<{ sport: string }>("select sport from rosters where id = $1 and owner_id = $2", [id, ownerId]);
  if (!roster) return null;
  const players = await query<{ id: string; jersey: string | null; first_name: string | null; last_name: string }>(
    `select id, jersey, first_name, last_name from roster_players
      where roster_id = $1 and owner_id = $2 order by sort_order asc`,
    [id, ownerId],
  );
  return { sport: roster.sport, players };
}

/** One player as the sound check and the heard-as suggestions read them. */
export type HeardAsPlayerRow = {
  id: string;
  roster_id: string;
  jersey: string | null;
  first_name: string | null;
  last_name: string;
  pronunciations: string[];
  heard_as: string[];
};

/** Every player on up to two of this account's rosters, for the heard-as writers. */
export async function listPlayersForHeardAs(ownerId: string, rosterIds: string[]): Promise<HeardAsPlayerRow[]> {
  return query<HeardAsPlayerRow>(
    `select id, roster_id, jersey, first_name, last_name, pronunciations, heard_as
       from roster_players
      where owner_id = $1 and roster_id = any($2::uuid[])
      order by roster_id, sort_order`,
    [ownerId, rosterIds],
  );
}

/**
 * Changes one player's heard-as forms and/or spotting setting; a field left
 * out is kept. False when the player is not this account's.
 */
export async function updatePlayer(
  ownerId: string,
  playerId: string,
  change: { heard_as?: string[]; spot_mode?: string },
): Promise<boolean> {
  const rows = await query(
    `update roster_players
        set heard_as = coalesce($3::text[], heard_as), spot_mode = coalesce($4, spot_mode)
      where id = $1 and owner_id = $2
      returning id`,
    [playerId, ownerId, change.heard_as ?? null, change.spot_mode ?? null],
  );
  return rows.length > 0;
}

/** Both teams of a game and all their players, for lib/game/buildGame.ts. */
export async function getGameRosters(
  ownerId: string,
  ids: string[],
): Promise<{ rosters: GameRosterRow[]; players: GamePlayerRow[] }> {
  const rosters = await query<GameRosterRow>(
    "select id, school, mascot, sport, primary_color from rosters where owner_id = $1 and id = any($2::uuid[])",
    [ownerId, ids],
  );
  const players = await query<GamePlayerRow>(
    `select id, roster_id, jersey, first_name, last_name, position, grade, height, weight, pronunciations,
            heard_as, storyline, spoken_forms, spot_mode, season_stats, season_lines, stats_as_of, sort_order
       from roster_players
      where owner_id = $1 and roster_id = any($2::uuid[])
      order by sort_order asc`,
    [ownerId, ids],
  );
  return { rosters, players };
}

/** Saves a whole roster through save_roster (one transaction). Returns its id. */
export async function saveRoster(ownerId: string, roster: Json, players: Json): Promise<string> {
  const row = await queryOne<{ id: string }>("select public.save_roster($1, $2::jsonb, $3::jsonb) as id", [
    ownerId,
    JSON.stringify(roster),
    JSON.stringify(players),
  ]);
  return row!.id;
}

/** Replaces a team's season stats through set_season_stats. Returns how many players matched. */
export async function setSeasonStats(ownerId: string, rosterId: string, stats: Json): Promise<number> {
  const row = await queryOne<{ matched: number }>("select public.set_season_stats($1, $2, $3::jsonb) as matched", [
    ownerId,
    rosterId,
    JSON.stringify(stats),
  ]);
  return row!.matched;
}

/** Deletes a team and its players. False when it is not this account's. */
export async function deleteRoster(ownerId: string, id: string): Promise<boolean> {
  const rows = await query("delete from rosters where id = $1 and owner_id = $2 returning id", [id, ownerId]);
  return rows.length > 0;
}
