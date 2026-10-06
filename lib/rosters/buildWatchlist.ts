import { normalizeWord, scoreAgainst, compileWatchlist, phoneticKeys } from "@/lib/matching/matcher";
import { cardsFor, type WatchlistEntry, type WatchlistPlayer } from "@/lib/watchlist";
import { spokenForms } from "./spokenForms";
import type { SpotMode } from "./types";

// =============================================================================
// Turning two saved rosters into the list Spotter listens for.
//
// Announcers say surnames, so one entry per surname, not per player. When two
// players share one, the entry is still one name and the label carries the
// jerseys, because the engine matches the sound and only a human can tell which
// player it was.
// =============================================================================

/** Shown when a player has no jersey number on the roster. */
export const NO_JERSEY = "#?";

/** Separates jerseys in a shared label. */
const JERSEY_SEPARATOR = " · ";

export interface GamePlayer {
  jersey: string | null;
  last_name: string;
  spoken_forms: string[];
  // Card fields. Optional because nothing about matching needs them, and a
  // caller that only wants the watchlist should not have to supply them.
  first_name?: string | null;
  position?: string | null;
  grade?: string | null;
  height?: string | null;
  weight?: string | null;
  stat_lines?: string[];
  pronunciation?: string | null;
  as_of?: string | null;
  /**
   * How this player takes part in spotting. "off" leaves them out of the
   * watchlist entirely, so neither their surname nor their jersey can put a
   * card up. Absent means normal.
   */
  spot_mode?: SpotMode;
}

export interface DroppedPart {
  /** The surname that lost a form. */
  from: string;
  /** The form that was dropped. */
  part: string;
  /** The player whose whole surname it collided with. */
  collidesWith: string;
}

export interface GameWatchlist {
  entries: WatchlistEntry[];
  keyterms: string[];
  droppedParts: DroppedPart[];
}

interface Grouped {
  /** The surname as printed, from the first player in roster order. */
  printed: string;
  primary: string;
  forms: string[];
  members: WatchlistPlayer[];
  exactOnly: boolean;
}

/**
 * Builds the watchlist for one game.
 *
 * Home players come first so labels and keyterms follow roster order.
 */
export function buildGameWatchlist(home: GamePlayer[], away: GamePlayer[]): GameWatchlist {
  const groups = new Map<string, Grouped>();

  const addAll = (players: GamePlayer[], side: "H" | "A") => {
    for (const player of players) {
      // Saved, and creditable with a stat, but never a card: an offensive
      // lineman's surname or jersey must not put anybody up.
      if (player.spot_mode === "off") continue;
      const exactOnly = player.spot_mode === "exact_only";
      // Fall back to recomputing if a saved roster predates spoken_forms.
      // Pronunciations are already folded into spoken_forms at save time.
      const forms = player.spoken_forms.length > 0 ? player.spoken_forms : spokenForms(player.last_name);
      const primary = forms[0] ?? normalizeWord(player.last_name);
      if (!primary) continue;

      const existing = groups.get(primary);
      if (existing) {
        for (const form of forms) if (!existing.forms.includes(form)) existing.forms.push(form);
        existing.members.push(cardFor(player, side));
        if (exactOnly) existing.exactOnly = true;
        continue;
      }
      groups.set(primary, {
        printed: player.last_name,
        primary,
        forms: [...forms],
        members: [cardFor(player, side)],
        exactOnly,
      });
    }
  };

  addAll(home, "H");
  addAll(away, "A");

  // A hyphen part that is another player's whole surname would fire on both.
  // The full surname wins; the hyphenated player keeps their other forms.
  const droppedParts: DroppedPart[] = [];
  for (const group of groups.values()) {
    group.forms = group.forms.filter((form) => {
      if (form === group.primary) return true;
      const clash = groups.get(form);
      if (!clash || clash === group) return true;
      droppedParts.push({ from: group.printed, part: form, collidesWith: clash.printed });
      return false;
    });
  }

  const entries: WatchlistEntry[] = [];
  const keyterms: string[] = [];
  const seenKeyterms = new Set<string>();

  for (const group of groups.values()) {
    entries.push({
      name: group.printed,
      aliases: group.forms.filter((form) => form !== group.primary),
      label: buildLabel(group),
      keyterm: group.printed,
      players: group.members,
      // Only when set, so an entry without it is exactly what it was.
      ...(group.exactOnly ? { exactOnly: true } : {}),
    });
    const key = group.printed.toLowerCase();
    if (!seenKeyterms.has(key)) {
      seenKeyterms.add(key);
      keyterms.push(group.printed);
    }
  }

  return { entries, keyterms, droppedParts };
}

/** The player as the live screen's card needs them. Nulls where the roster said nothing. */
function cardFor(player: GamePlayer, side: "H" | "A"): WatchlistPlayer {
  return {
    jersey: player.jersey,
    first_name: player.first_name ?? null,
    last_name: player.last_name,
    position: player.position ?? null,
    grade: player.grade ?? null,
    height: player.height ?? null,
    weight: player.weight ?? null,
    side,
    stat_lines: player.stat_lines ?? [],
    // Only when there is one, so a card without either is exactly what it was.
    ...(player.pronunciation ? { pronunciation: player.pronunciation } : {}),
    ...(player.as_of ? { as_of: player.as_of } : {}),
  };
}

/**
 * One player is just the surname. Several need jerseys to tell apart, and a
 * surname on both teams needs the side too.
 *
 *   Tremaine
 *   Williams #10 · #23
 *   Williams #10 H · #4 A
 */
function buildLabel(group: Grouped): string {
  if (group.members.length === 1) return group.printed;

  const bothSides = group.members.some((m) => m.side === "H") && group.members.some((m) => m.side === "A");
  const jerseys = group.members.map((member) => {
    const jersey = (member.jersey ?? "").trim();
    const shown = jersey.length > 0 ? `#${jersey}` : NO_JERSEY;
    return bothSides ? `${shown} ${member.side}` : shown;
  });

  return `${group.printed} ${jerseys.join(JERSEY_SEPARATOR)}`;
}

// =============================================================================
// The jersey index: which players wear each number tonight.
//
// Built from the watchlist the game already carries, so a number costs the hot
// path a map lookup and nothing else. A game saved before cards existed has no
// players on its entries, so it simply has no numbers to listen for.
// =============================================================================

/** One player on one of tonight's rosters, with the key the engine tracks them by. */
export interface RosterSlot {
  /** Unique within the game: the entry's name and the player's place in it. */
  key: string;
  /** The watchlist entry this player belongs to, which is the surname the engine matches. */
  entry: string;
  player: WatchlistPlayer;
}

export interface JerseyIndex {
  byKey: Map<string, RosterSlot>;
  /** Entry name to the keys of its players, in roster order. */
  byEntry: Map<string, string[]>;
  /** Jersey as spoken to everyone wearing it, home before away. */
  byJersey: Map<string, RosterSlot[]>;
}

/** " 7 " and "7" are the same jersey. "#7" is too. "0" and "00" are not. */
export function jerseyKey(jersey: string | null | undefined): string | null {
  const trimmed = (jersey ?? "").trim().replace(/^#/, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildJerseyIndex(entries: WatchlistEntry[]): JerseyIndex {
  const byKey = new Map<string, RosterSlot>();
  const byEntry = new Map<string, string[]>();
  const byJersey = new Map<string, RosterSlot[]>();

  for (const entry of entries) {
    const keys: string[] = [];
    // cardsFor, so an entry from a game saved before cards existed still has
    // something to put on screen. It carries no jersey, so it adds no numbers.
    cardsFor(entry).forEach((player, index) => {
      const slot: RosterSlot = { key: `${entry.name}#${index}`, entry: entry.name, player };
      byKey.set(slot.key, slot);
      keys.push(slot.key);
      const jersey = jerseyKey(player.jersey);
      if (jersey === null) return;
      const wearers = byJersey.get(jersey);
      if (wearers) wearers.push(slot);
      else byJersey.set(jersey, [slot]);
    });
    byEntry.set(entry.name, keys);
  }

  return { byKey, byEntry, byJersey };
}

export interface Collision {
  a: string;
  b: string;
  score: number;
}

/**
 * Pairs of entries that would fire on each other, the Chen and Chin case.
 *
 * Informational: the announcer decides whether it matters. Scored with the
 * real matcher, so this is what would actually happen.
 *
 * `ratio` below 1 also reports pairs that come within that fraction of the
 * threshold. The roster review passes the same "close" ratio the common-word
 * check uses, because Bargas and Vargas score just under the line (the matcher
 * alone would not confuse them) and Deepgram still flipped between them ten
 * times on Sept 25. The default keeps V2's behaviour: only pairs that fire.
 */
export function findCrossPlayerCollisions(entries: WatchlistEntry[], ratio = 1): Collision[] {
  const compiled = compileWatchlist(entries);
  const collisions: Collision[] = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue;
      let best = 0;
      // Every form of i, scored against j's compiled entry.
      for (const form of [entries[i].name, ...entries[i].aliases]) {
        const text = form.split(/\s+/).map(normalizeWord).join("");
        if (!text) continue;
        const { score, minScore } = scoreAgainst(text, phoneticKeys(text), compiled[j]);
        if (score >= minScore * ratio) best = Math.max(best, score);
      }
      if (best > 0 && !collisions.some((c) => c.a === entries[j].name && c.b === entries[i].name)) {
        collisions.push({ a: entries[i].name, b: entries[j].name, score: best });
      }
    }
  }

  return collisions.sort((x, y) => y.score - x.score);
}
