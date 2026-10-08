import type { JerseyIndex, RosterSlot } from "@/lib/rosters/buildWatchlist";
import { compileWatchlist, normalizeWord, phoneticKeys, scoreAgainst, type CompiledEntry } from "./matcher";

// =============================================================================
// Which teammates a card is about, when more than one could be (Jed, Oct 3).
//
// A first name said right before a shared surname is that player: "Jeremiah
// Smith" is not every Smith. Heard alone, a shared surname, or a jersey two
// teammates both wear, goes to the players called most (the call rate on each
// card's player, lib/cards/callRate.ts): best first, and everyone close to the
// best stays up beside them, so two starters named Smith both show. A team
// with no stats shows everyone, exactly as before.
//
// Synchronous and read-only on the hot path: every rate and every first name
// is compiled when the engine is built, before the mic turns on. First names
// are scored with the matcher's own scoreAgainst and thresholds; matcher.ts is
// not changed.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/**
 * A teammate stays up beside the most called one when called at least this
 * share as often. 0.5: a starter at 20 a game keeps one at 10, and drops a
 * backup at 3.
 */
export const STAR_KEEP_RATIO = 0.5;

// =============================================================================

/**
 * The players to show out of several who fit, per team and per group (the
 * shared surname, or the shared jersey): the most called first, and anyone at
 * STAR_KEEP_RATIO of them or more. A group where nobody has a call rate keeps
 * everyone in roster order. Groups keep the order they arrived in.
 */
export function preferStars(slots: readonly RosterSlot[], groupOf: (slot: RosterSlot) => string): RosterSlot[] {
  const groups = new Map<string, RosterSlot[]>();
  for (const slot of slots) {
    const key = `${slot.player.side}|${groupOf(slot)}`;
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }
  const kept: RosterSlot[] = [];
  for (const group of groups.values()) {
    const best = Math.max(...group.map(rate));
    if (group.length < 2 || best <= 0) {
      kept.push(...group);
      continue;
    }
    kept.push(...group.filter((slot) => rate(slot) >= best * STAR_KEEP_RATIO).sort((a, b) => rate(b) - rate(a)));
  }
  return kept;
}

function rate(slot: RosterSlot): number {
  const value = slot.player.priority;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The first names of players who share a surname with a teammate or an
 * opponent, compiled once per game.
 */
export class FirstNames {
  /** Entry name to its players' keys and compiled first names. */
  private readonly byEntry = new Map<string, Array<{ key: string; first: CompiledEntry }>>();

  constructor(index: JerseyIndex) {
    for (const [entry, keys] of index.byEntry) {
      if (keys.length < 2) continue;
      const members: Array<{ key: string; first: CompiledEntry }> = [];
      for (const key of keys) {
        const first = (index.byKey.get(key)?.player.first_name ?? "").trim();
        if (!normalizeWord(first)) continue;
        members.push({ key, first: compileWatchlist([{ name: first, aliases: [] }])[0] });
      }
      if (members.length > 0) this.byEntry.set(entry, members);
    }
  }

  /**
   * The players of a shared surname whose first name is the word heard right
   * before it, or null when it is nobody's, or everybody's (nothing narrowed).
   */
  match(entry: string, heard: string, everyone: number): string[] | null {
    const members = this.byEntry.get(entry);
    const text = normalizeWord(heard);
    if (!members || !text) return null;
    const keys = phoneticKeys(text);
    const named = members
      .filter(({ first }) => {
        const { score, minScore } = scoreAgainst(text, keys, first);
        return score >= minScore;
      })
      .map(({ key }) => key);
    return named.length > 0 && named.length < everyone ? named : null;
  }
}
