import { normalizeWord } from "@/lib/matching/matcher";

/**
 * The same player across saves and imports: the normalized surname and the
 * jersey, "roberts|5". What a re-import keys a row by to keep its notes.
 * save_roster's public.roster_player_identity (migration
 * 20261007060100_v3_save_roster_whole.sql) builds the same key, to keep a
 * player's "heard as" forms when an older client does not send them.
 */
export function playerIdentity(player: { last_name: string; jersey: string | null }): string {
  const jersey = (player.jersey ?? "").trim().replace(/^#/, "");
  return `${player.last_name.split(/\s+/).map(normalizeWord).join("")}|${jersey}`;
}
