import { teenTyPartner } from "@/lib/rosters/similarJerseys";
import type { JerseyIndex, RosterSlot } from "@/lib/rosters/buildWatchlist";
import type { JerseyMention } from "./numbers";

// =============================================================================
// TUNING: turning a number someone said into the players it puts on screen.
//
// Never a guess. When a number could be two players, both cards go up labelled
// by side, the same as two players sharing a surname, because only a person in
// the booth can tell which one it was.
// =============================================================================

/**
 * Show the teen/ty partner too: "number 15" puts up #15 and #50 when both are
 * playing tonight. On, because the pair is genuinely hard to hear and an extra
 * card costs a glance while a missed player costs the call. Off shows only what
 * was heard.
 */
export const TEEN_TY_SHOW_BOTH = true;

/**
 * What a number match scores, by what cued it. These are not the matcher's
 * scores: nothing about a number is phonetic, so they say how much the context
 * is trusted rather than how close a sound was.
 *
 * explicit ("number 23") is certain, so 1. A surname next to it corroborates
 * the number with a name that scored on its own, so it sits just under. A team
 * cue is the weakest of the three: school names are ordinary words and get said
 * for other reasons.
 */
export const NUMBER_CUE_SCORES = { explicit: 1, surname: 0.95, team: 0.9 } as const;

/** The threshold a number row logs against. Numbers pass or fail on rules, not on a score. */
export const NUMBER_THRESHOLD = 1;

// =============================================================================

export type JerseyResolution =
  | { kind: "show"; slots: RosterSlot[] }
  /** The surname and the number point at different players. The caller shows the surname's. */
  | { kind: "conflict" }
  | { kind: "not_on_roster"; reason: "not_on_roster" | "not_on_team" };

/**
 * Who a heard number is, resolved against tonight's two rosters.
 *
 * In order: a surname in the same phrase wins, then a team cue, and otherwise
 * every player wearing that number goes up.
 */
export function resolveJersey(
  mention: JerseyMention,
  index: JerseyIndex,
  { teenTy = TEEN_TY_SHOW_BOTH }: { teenTy?: boolean } = {},
): JerseyResolution {
  const wearers = index.byJersey.get(mention.number) ?? [];
  const partner = teenTy ? teenTyPartner(mention.number) : null;
  const partners = partner ? (index.byJersey.get(partner) ?? []) : [];
  const candidates = [...wearers, ...partners];

  // A surname in the same phrase settles it, and narrows a shared surname to
  // the one player wearing the number.
  if (mention.surname !== null) {
    const named = candidates.filter((slot) => slot.entry === mention.surname);
    if (named.length === 0) return { kind: "conflict" };
    // The side is only ever a narrowing here. A team cue that disagrees with
    // the surname is not a reason to show nobody.
    const sided = bySide(named, mention.side);
    return { kind: "show", slots: sided.length > 0 ? sided : named };
  }

  if (candidates.length === 0) return { kind: "not_on_roster", reason: "not_on_roster" };

  const sided = bySide(candidates, mention.side);
  if (sided.length === 0) return { kind: "not_on_roster", reason: "not_on_team" };
  return { kind: "show", slots: sided };
}

/** A team cue narrows to that side. With nobody on it, the caller hears about it. */
function bySide(slots: RosterSlot[], side: "H" | "A" | null): RosterSlot[] {
  if (side === null) return slots;
  return slots.filter((slot) => slot.player.side === side);
}
