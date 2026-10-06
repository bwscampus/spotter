import type { BlockIdentity, LineBlock, StatsPlayer } from "./types";

// =============================================================================
// Attaching what Claude read off a stats sheet to the players already saved on
// a roster. The same for football numbers and other sports' lines: the block's
// payload rides along untouched.
//
// The jersey number is the link. A stats sheet abbreviates the name to an
// initial and a surname ("8 B. Mikail"), so the surname alone is weaker, and
// the number is what both documents print the same way.
//
// Nothing here guesses. A block that cannot be placed with confidence is
// returned unmatched with the reason, because the wrong stat under the right
// name is read on air as fact.
// =============================================================================

export type { StatsPlayer };
/** One player's lines. The shape the other sports' stats arrive in. */
export type StatBlock = LineBlock;

export interface StatsMatch<B extends BlockIdentity = LineBlock> {
  player: StatsPlayer;
  block: B;
  /** Set when the jersey placed this block but the surname did not agree. */
  mismatchedName?: string;
}

export interface UnmatchedBlock<B extends BlockIdentity = LineBlock> {
  block: B;
  reason: string;
}

export interface StatsMatchResult<B extends BlockIdentity = LineBlock> {
  matched: StatsMatch<B>[];
  /** Blocks that belong to nobody on the roster. */
  unmatched: UnmatchedBlock<B>[];
  /** Roster players the sheet had nothing to say about. Not a problem, just a fact. */
  silent: StatsPlayer[];
}

/**
 * Lowercased letters only, so "O'Brien" and "OBrien" are the same surname. A
 * leading initial goes first: a stats sheet prints "T. Wright" for the roster's
 * Wright, and that is the same player, not a name worth questioning.
 */
function fold(name: string): string {
  return name
    .replace(/^(\p{L}\.?\s+)+(?=\p{L}{2})/u, "")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "");
}

/** Jerseys are text, not numbers: "0" and "00" are different players. */
function jerseyOf(value: string | null): string | null {
  const trimmed = value?.trim().replace(/^#/, "").trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function matchStats<B extends BlockIdentity>(players: StatsPlayer[], blocks: B[]): StatsMatchResult<B> {
  const byJersey = new Map<string, StatsPlayer[]>();
  const bySurname = new Map<string, StatsPlayer[]>();
  for (const player of players) {
    const jersey = jerseyOf(player.jersey);
    if (jersey) push(byJersey, jersey, player);
    push(bySurname, fold(player.last_name), player);
  }

  const matched: StatsMatch<B>[] = [];
  const unmatched: UnmatchedBlock<B>[] = [];
  const taken = new Set<string>();

  for (const block of blocks) {
    const jersey = jerseyOf(block.jersey);
    const surname = fold(block.last_name);
    const onJersey = jersey ? (byJersey.get(jersey) ?? []) : [];
    const onSurname = bySurname.get(surname) ?? [];

    // The jersey is the link, so try it first, and narrow by surname when the
    // roster has two players wearing it.
    let player: StatsPlayer | null = null;
    let reason = "";
    if (onJersey.length === 1) {
      player = onJersey[0];
    } else if (onJersey.length > 1) {
      const both = onJersey.filter((candidate) => fold(candidate.last_name) === surname);
      if (both.length === 1) player = both[0];
      else reason = `Two players wear #${jersey}, and the surname did not settle it.`;
    } else if (onSurname.length === 1) {
      player = onSurname[0];
    } else if (onSurname.length > 1) {
      reason = `More than one ${block.last_name} on the roster, and #${jersey ?? "?"} is not one of them.`;
    } else {
      reason = jersey
        ? `No #${jersey} ${block.last_name} on the roster.`
        : `No ${block.last_name} on the roster.`;
    }

    if (!player) {
      unmatched.push({ block, reason });
      continue;
    }
    if (taken.has(player.id)) {
      unmatched.push({ block, reason: `${block.last_name} already has stats from an earlier row.` });
      continue;
    }

    taken.add(player.id);
    const mismatched = fold(player.last_name) !== surname ? block.last_name : undefined;
    matched.push({ player, block, ...(mismatched ? { mismatchedName: mismatched } : {}) });
  }

  return {
    matched,
    unmatched,
    silent: players.filter((player) => !taken.has(player.id)),
  };
}

/**
 * Every row that landed on nobody, as a warning that names its jersey, so the
 * announcer can find it on the sheet: "#44 Nobody: No #44 Nobody on the roster."
 * Shown on the review screen only. It names a player, so it never goes to analytics.
 */
export function unmatchedWarnings<B extends BlockIdentity>(result: StatsMatchResult<B>): string[] {
  return result.unmatched.map(
    ({ block, reason }) => `#${jerseyOf(block.jersey) ?? "?"} ${block.last_name}: ${reason}`,
  );
}

/**
 * One key per row on the sheet: the same jersey and the same surname (by the
 * same fold the matcher uses) are the same row, however the sheet spelled it.
 * Used to join the pieces of one player read by separate calls.
 */
export function rowKey(block: BlockIdentity): string {
  return `${jerseyOf(block.jersey) ?? ""}|${fold(block.last_name)}`;
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}
