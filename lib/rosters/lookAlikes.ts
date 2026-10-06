import { findCrossPlayerCollisions } from "./buildWatchlist";
import { CLOSE_RATIO } from "./commonWordHits";
import { spokenForms } from "./spokenForms";
import type { RosterPlayer } from "./types";

// =============================================================================
// Surnames on one roster that the matcher would confuse with each other, the
// Bargas #8 and Vargas #21 case: both Estancia, and Deepgram flipped between
// them ten times on Sept 25.
//
// V2's findCrossPlayerCollisions does the scoring with the real matcher, at the
// same "close" ratio the common-word check warns at: Bargas and Vargas score
// just under the line, so a fires-only check would miss the very pair this is
// for. This builds its input from one roster and maps the answer back onto rows.
// Players set to "off" are left out: they never put a card up, so they cannot
// be confused with anyone on screen.
// =============================================================================

/**
 * For each player, the printed surnames of the teammates they could be heard
 * as. Empty where there is nobody. Same order as the players given.
 */
export function findLookAlikes(players: RosterPlayer[]): string[][] {
  // One entry per surname, the way a game's watchlist groups them: two
  // Williamses are one name, not a collision.
  const byPrimary = new Map<string, { name: string; aliases: string[] }>();
  const primaryOf: Array<string | null> = players.map((player) => {
    if (player.spot_mode === "off") return null;
    const forms = spokenForms(player.last_name, player.pronunciations);
    const primary = forms[0];
    if (!primary) return null;
    const existing = byPrimary.get(primary);
    if (existing) {
      for (const form of forms.slice(1)) if (!existing.aliases.includes(form)) existing.aliases.push(form);
    } else {
      byPrimary.set(primary, { name: primary, aliases: forms.slice(1) });
    }
    return primary;
  });

  const entries = [...byPrimary.values()];
  const collisions = cachedCollisions(entries);

  // Primary form to the surnames it collides with, as printed.
  const printed = new Map<string, string>();
  players.forEach((player, index) => {
    const primary = primaryOf[index];
    if (primary && !printed.has(primary)) printed.set(primary, player.last_name);
  });
  const partners = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const name = printed.get(to) ?? to;
    const list = partners.get(from) ?? [];
    if (!list.includes(name)) list.push(name);
    partners.set(from, list);
  };
  for (const { a, b } of collisions) {
    link(a, b);
    link(b, a);
  }

  return primaryOf.map((primary) => (primary ? (partners.get(primary) ?? []) : []));
}

// The review screen recomputes on every keystroke and this is every pair on
// the roster, so remember the last answer: most keystrokes change no surname.
let lastKey = "";
let lastCollisions: ReturnType<typeof findCrossPlayerCollisions> = [];

function cachedCollisions(entries: Array<{ name: string; aliases: string[] }>) {
  const key = entries.map((entry) => [entry.name, ...entry.aliases].join(",")).join("|");
  if (key !== lastKey) {
    lastCollisions = findCrossPlayerCollisions(entries, CLOSE_RATIO);
    lastKey = key;
  }
  return lastCollisions;
}
