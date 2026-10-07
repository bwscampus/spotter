import { cardsFor, type WatchlistEntry } from "@/lib/watchlist";

// =============================================================================
// What changed when a live game pulled the rosters again.
//
// A refresh during a dead ball is worth about four seconds of the announcer's
// attention, so what comes back is one line: "2 added · 1 renumbered". Enough
// to know the fix landed, and not enough to read instead of the game.
//
// Both sides are compared as watchlist entries, because that is what a game
// carries: there is no roster in a snapshot to compare against.
// =============================================================================

export interface RosterChanges {
  added: number;
  removed: number;
  renumbered: number;
  statLines: number;
  pronunciations: number;
}

/** What one line of the summary is called. Order is the order they are said in. */
const PARTS: Array<[keyof RosterChanges, (count: number) => string]> = [
  ["added", (n) => `${n} added`],
  ["removed", (n) => `${n} removed`],
  ["renumbered", (n) => `${n} renumbered`],
  ["statLines", (n) => `${n} with new stats`],
  ["pronunciations", (n) => `${n} ${n === 1 ? "pronunciation" : "pronunciations"} added`],
];

/** A player, as the two watchlists can be lined up by. Side and name: a jersey is what changes. */
function identity(side: string, first: string | null, last: string): string {
  return `${side}|${last.trim().toLowerCase()}|${(first ?? "").trim().toLowerCase()}`;
}

interface Seen {
  jersey: string;
  statLines: string;
}

function playersIn(entries: WatchlistEntry[]): Map<string, Seen> {
  const players = new Map<string, Seen>();
  for (const entry of entries) {
    // cardsFor, so an entry from a game built before cards existed still lines
    // up rather than counting as a whole roster being replaced.
    for (const player of cardsFor(entry)) {
      players.set(identity(player.side, player.first_name, player.last_name), {
        jersey: (player.jersey ?? "").trim(),
        statLines: (player.stat_lines ?? []).join("\n"),
      });
    }
  }
  return players;
}

/** Spoken forms per surname, so a pronunciation typed on the teams screen shows up as one. */
function formsIn(entries: WatchlistEntry[]): Map<string, Set<string>> {
  const forms = new Map<string, Set<string>>();
  for (const entry of entries) forms.set(entry.name, new Set(entry.aliases));
  return forms;
}

export function compareWatchlists(before: WatchlistEntry[], after: WatchlistEntry[]): RosterChanges {
  const was = playersIn(before);
  const now = playersIn(after);

  const changes: RosterChanges = { added: 0, removed: 0, renumbered: 0, statLines: 0, pronunciations: 0 };

  for (const [key, player] of now) {
    const previous = was.get(key);
    if (!previous) {
      changes.added++;
      continue;
    }
    if (previous.jersey !== player.jersey) changes.renumbered++;
    if (previous.statLines !== player.statLines) changes.statLines++;
  }
  for (const key of was.keys()) if (!now.has(key)) changes.removed++;

  const oldForms = formsIn(before);
  for (const [name, aliases] of formsIn(after)) {
    const previous = oldForms.get(name);
    if (!previous) continue; // a whole new surname is already counted as added
    for (const alias of aliases) if (!previous.has(alias)) changes.pronunciations++;
  }

  return changes;
}

/** "2 added · 1 renumbered", or "No changes." when the rosters are the same as they were. */
export function describeRosterChanges(before: WatchlistEntry[], after: WatchlistEntry[]): string {
  const changes = compareWatchlists(before, after);
  const said = PARTS.filter(([key]) => changes[key] > 0).map(([key, say]) => say(changes[key]));
  return said.length === 0 ? "No changes." : said.join(" · ");
}
