import type { CheckNote } from "./check";
import type { StatsEvent, StatsPlay, StatsRosterPlayer } from "./types";

// =============================================================================
// The id the reader meant (R33, Oct 10, after the college test).
//
// The reader sometimes copies more of the roster line than the id: "H7-SMITH
// Joe RB" for H7-SMITH, or "H-SMITH" with the number left off. Every such
// credit used to be thrown out as "not on either roster" (R9). This is a fill
// with one possible answer, like the passer rule, and nothing more:
//   a. the text before the first space, "|", "(" or comma is a roster id;
//   b. else it is side-hyphen-surname (with no number, or a number nobody on
//      that side has) and exactly one player on that side has that surname;
//   c. else the id stays as it was, and R9 drops it as before.
// Run once per read, before the check and the rules, on every event, so the
// passer is matched before the passer rule looks at him. Pure.
// =============================================================================

/** The text before the first space, bar, bracket or comma. */
function head(id: string): string {
  return id.split(/[\s|(,]/, 1)[0].trim();
}

/** The surname part of a playerId: everything after the first hyphen ("H22-DE_LA_CRUZ" is "DE_LA_CRUZ"). */
function surnameOf(playerId: string): string {
  const at = playerId.indexOf("-");
  return at === -1 ? "" : playerId.slice(at + 1);
}

/** The roster id a returned id means, or null when it cannot be told. */
export function resolvePlayerId(id: string, roster: ReadonlyMap<string, StatsRosterPlayer>): string | null {
  if (id === "" || roster.has(id)) return null;
  const first = head(id);
  if (first !== id && roster.has(first)) return first;
  const parts = /^([HA])\d*-(.+)$/i.exec(first);
  if (!parts) return null;
  const side = parts[1].toUpperCase() === "H" ? "home" : "away";
  const surname = parts[2].toUpperCase();
  const same = [...roster.values()].filter((player) => player.side === side && surnameOf(player.playerId).toUpperCase() === surname);
  return same.length === 1 ? same[0].playerId : null;
}

export interface ResolvedPlay {
  play: StatsPlay;
  notes: CheckNote[];
}

/**
 * The play with every id the reader wrote with extra words, or without its
 * number, replaced by the roster id it means, and a note (R33, "matched") for
 * each. A second event for the same player and action, which a match can make,
 * is dropped as validatePlays would have. The play itself when nothing changed.
 */
export function resolveIds(play: StatsPlay, roster: ReadonlyMap<string, StatsRosterPlayer> | readonly StatsRosterPlayer[]): ResolvedPlay {
  const players = roster instanceof Map ? roster : new Map((roster as readonly StatsRosterPlayer[]).map((player) => [player.playerId, player]));
  const notes: CheckNote[] = [];
  const events: StatsEvent[] = [];
  for (const event of play.events) {
    const to = resolvePlayerId(event.playerId, players);
    const next = to === null ? event : { ...event, playerId: to };
    if (to !== null) notes.push({ event, rule: "R33", kind: "matched", reason: `the id was written "${event.playerId}"`, to });
    if (events.some((kept) => kept.playerId === next.playerId && kept.action === next.action)) continue;
    events.push(next);
  }
  if (notes.length === 0) return { play, notes };
  return { play: { ...play, events }, notes };
}
