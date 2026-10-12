import { STRIP_LABELS } from "./describe";
import type { FootballStatKey } from "@/lib/cards/statKeys";
import { tallyWithBooth, type BoothTotal, type StatChange } from "@/lib/cards/tonight";
import { nameIndex, namedIn } from "./names";
import type { BoothScope, BoothStatLine, StatsRosterPlayer } from "./types";

// =============================================================================
// The stat lines the booth reads on air (Oct 11, fix 6, Part 1). On the audited
// broadcast the booth read seven running totals ("he's 14 of 17 for 181 and a
// touchdown", "has now grabbed 5 for 114") and every one disagreed with
// Spotter, mostly on yards. A booth's stat line is the best evidence there is
// for a total, so an accepted line sets it (rule R41, tallyWithBooth in
// lib/cards/tonight.ts), and a count the plays disagree with queues a re-read
// of the plays behind it (rule R42, lib/livestats/controller.ts).
//
// Before a line is believed it is checked here: it is about tonight (or this
// half, while the first half is on), the player is named in its words, the
// numbers are possible, and no count goes down from a line the booth read
// before. A line that fails is refused with its reason and never applied.
// Pure: plain shapes in, a decision out.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/**
 * The most yards one completion, catch or carry can be worth: a 99-yard play
 * is the longest a football field allows. A yards total over the count times
 * this cannot be a running total for that count.
 */
export const MAX_YARDS_PER_PLAY = 99;

/**
 * How many lines after the booth's line its words may name the player
 * ("that's his 5th catch" ... "for Fennimore" a sentence later), the same
 * reach the name check gives a play (LATE_NAME_LINES in session.ts).
 */
export const BOOTH_NAME_LINES = 5;

// =============================================================================

/** The count stat each yards and touchdown stat rides on. */
const COUNT_OF: Partial<Record<FootballStatKey, FootballStatKey>> = {
  pass_yds: "pass_cmp",
  pass_td: "pass_cmp",
  rush_yds: "rush_att",
  rush_td: "rush_att",
  rec_yds: "rec",
  rec_td: "rec",
  kr_yds: "kr",
  kr_td: "kr",
  pr_yds: "pr",
  pr_td: "pr",
};

const YARDS_KEYS: ReadonlySet<FootballStatKey> = new Set(["pass_yds", "rush_yds", "rec_yds", "kr_yds", "pr_yds"]);
const TD_KEYS: ReadonlySet<FootballStatKey> = new Set(["pass_td", "rush_td", "rec_td", "kr_td", "pr_td"]);

/**
 * The count stats a booth line is checked against the plays for (R42): a
 * disagreement means a play is missing or wrong for that player.
 */
export const BOOTH_COUNT_KEYS: readonly FootballStatKey[] = ["pass_cmp", "pass_att", "rush_att", "rec", "kr", "pr"];

/** A booth line the code accepted, with what the plays had counted for that stat at its line. */
export interface BoothLine extends BoothTotal {
  scope: BoothScope;
  had: number;
}

export interface RefusedBoothLine {
  line: BoothStatLine;
  reason: string;
}

/** What the check needs to know about a play already read. */
export interface BoothCheckPlay {
  seqStart: number;
  status: string;
  changes: readonly StatChange[];
  quarter: number | null;
}

export interface BoothCheckContext {
  plays: readonly BoothCheckPlay[];
  /** Lines the booth read before, already accepted. */
  accepted: readonly BoothLine[];
  roster: ReadonlyMap<string, StatsRosterPlayer> | readonly StatsRosterPlayer[];
  /** Everything said, by seq, for the name check. Absent (a test), the name check is skipped. */
  utterances?: readonly { seq: number; text: string }[];
  /** The last line the reader has seen; the name check reads no further. */
  readThrough?: number;
  aliases?: ReadonlyMap<string, readonly string[]>;
}

export interface BoothCheck {
  accepted: BoothLine[];
  refused: RefusedBoothLine[];
  /** Accepted lines on a count stat whose number is not what the plays counted (R42). */
  mismatched: BoothLine[];
}

/**
 * Spotter's own total for a player and stat as of line `seq`: the counted
 * plays whose lines begin at or before it, with the booth lines accepted
 * before it.
 */
export function totalAt(plays: readonly BoothCheckPlay[], accepted: readonly BoothTotal[], playerId: string, key: FootballStatKey, seq: number): number {
  const before = plays.filter((play) => play.status === "applied" && play.seqStart <= seq);
  const lines = accepted.filter((line) => line.seq < seq || (line.seq === seq && !(line.playerId === playerId && line.key === key)));
  return tallyWithBooth(before, lines).get(playerId)?.stats[key] ?? 0;
}

/**
 * The lines, checked in the order they were said. Items said on one line
 * about one player are read together, so "14 of 17 for 181" is checked as a
 * whole: completions within attempts, yards within what the completions could
 * be worth.
 */
export function checkBoothLines(lines: readonly BoothStatLine[], context: BoothCheckContext): BoothCheck {
  const players: ReadonlyMap<string, StatsRosterPlayer> =
    context.roster instanceof Map ? context.roster : new Map((context.roster as readonly StatsRosterPlayer[]).map((player) => [player.playerId, player]));
  const secondHalf = context.plays.some((play) => play.status !== "discarded" && play.quarter !== null && play.quarter >= 3);
  const accepted: BoothLine[] = [];
  const refused: RefusedBoothLine[] = [];
  const mismatched: BoothLine[] = [];
  const all = () => [...context.accepted, ...accepted];
  const names = nameIndex(context.roster);

  const ordered = [...lines].sort((a, b) => a.seq - b.seq);
  // Items on one line about one player, together.
  const groups = new Map<string, BoothStatLine[]>();
  for (const line of ordered) {
    const id = `${line.seq}|${line.playerId}`;
    groups.set(id, [...(groups.get(id) ?? []), line]);
  }

  for (const group of groups.values()) {
    const { seq, playerId } = group[0];
    const player = players.get(playerId);
    const refuse = (reason: string) => {
      for (const line of group) refused.push({ line, reason });
    };
    if (!player) {
      refuse("not on either roster");
      continue;
    }
    // A total from another game, a season or a career says nothing about tonight.
    const scopes = new Set(group.map((line) => line.scope));
    if ([...scopes].some((scope) => scope !== "tonight" && !(scope === "this_half" && !secondHalf))) {
      refuse(secondHalf && scopes.has("this_half") ? "a first-half total read in the second half" : `not tonight's total (${[...scopes].filter((scope) => scope !== "tonight").join(", ")})`);
      continue;
    }
    // The booth's words must name the player, on the line or within a few lines after it.
    if (context.utterances && context.utterances.length > 0) {
      const last = Math.min(seq + BOOTH_NAME_LINES, context.readThrough ?? Number.POSITIVE_INFINITY);
      const text = context.utterances
        .filter((utterance) => utterance.seq >= seq && utterance.seq <= last)
        .map((utterance) => utterance.text)
        .join(" ");
      if (text.length > 0 && !namedIn(player, text, names, context.aliases?.get(playerId) ?? player.aliases ?? [])) {
        refuse("the player is not named in the words it was read from");
        continue;
      }
    }
    // Possible: completions within attempts, touchdowns within their count, yards within what the count could be worth.
    const value = (key: FootballStatKey): number | null => group.find((line) => line.key === key)?.value ?? null;
    const known = (key: FootballStatKey): number | null => {
      const inGroup = value(key);
      if (inGroup !== null) return inGroup;
      const earlier = all().filter((line) => line.playerId === playerId && line.key === key && line.seq <= seq).sort((a, b) => b.seq - a.seq)[0];
      return earlier ? earlier.value : null;
    };
    let fault: string | null = null;
    const cmp = value("pass_cmp");
    const att = known("pass_att");
    if (cmp !== null && att !== null && cmp > att) fault = "more completions than attempts";
    const attIn = value("pass_att");
    const cmpKnown = known("pass_cmp");
    if (attIn !== null && cmpKnown !== null && cmpKnown > attIn) fault = "more completions than attempts";
    for (const line of group) {
      const countKey = COUNT_OF[line.key];
      if (!countKey) continue;
      const count = known(countKey);
      if (count === null) continue;
      if (TD_KEYS.has(line.key) && line.value > count) fault = `more ${STRIP_LABELS[line.key]} than ${STRIP_LABELS[countKey]}`;
      if (YARDS_KEYS.has(line.key) && Math.abs(line.value) > count * MAX_YARDS_PER_PLAY) fault = `${line.value} ${STRIP_LABELS[line.key]} on ${count} ${STRIP_LABELS[countKey]} is not possible`;
    }
    if (fault) {
      refuse(fault);
      continue;
    }
    // A count never goes down from a line the booth read before.
    const down = group.find((line) => {
      if (YARDS_KEYS.has(line.key)) return false;
      const earlier = all().filter((each) => each.playerId === playerId && each.key === line.key && each.seq < seq).sort((a, b) => b.seq - a.seq)[0];
      return earlier !== undefined && line.value < earlier.value;
    });
    if (down) {
      refuse(`${STRIP_LABELS[down.key]} ${down.value} is below the ${STRIP_LABELS[down.key]} the booth read before`);
      continue;
    }
    for (const line of group) {
      const had = totalAt(context.plays, all(), playerId, line.key, seq);
      const entry: BoothLine = { seq, playerId, key: line.key, value: line.value, scope: line.scope, had };
      accepted.push(entry);
      if (BOOTH_COUNT_KEYS.includes(line.key) && had !== line.value) mismatched.push(entry);
    }
  }
  return { accepted, refused, mismatched };
}

/**
 * The strip's one quiet line for a booth line that changed a total (fix 6,
 * Part 1): "Booth: FENNIMORE 14/17 181 yds (had 115)". One player's items from
 * one line together, completions and attempts as a pair, yards with their
 * word, and what Spotter had for the first stat that changed. Null when the
 * booth agreed with every number.
 */
export function boothText(group: readonly BoothLine[], roster: ReadonlyMap<string, StatsRosterPlayer> | readonly StatsRosterPlayer[]): string | null {
  if (group.length === 0) return null;
  const changed = group.find((line) => line.value !== line.had);
  if (!changed) return null;
  const players: ReadonlyMap<string, StatsRosterPlayer> = roster instanceof Map ? roster : new Map((roster as readonly StatsRosterPlayer[]).map((player) => [player.playerId, player]));
  const player = players.get(group[0].playerId);
  const who = player ? player.last.toUpperCase() : group[0].playerId;
  const parts: string[] = [];
  const by = (key: FootballStatKey) => group.find((line) => line.key === key);
  const cmp = by("pass_cmp");
  const att = by("pass_att");
  const used = new Set<FootballStatKey>();
  if (cmp && att) {
    parts.push(`${cmp.value}/${att.value}`);
    used.add("pass_cmp");
    used.add("pass_att");
  }
  for (const line of group) {
    if (used.has(line.key)) continue;
    used.add(line.key);
    parts.push(YARDS_KEYS.has(line.key) ? `${line.value} yds` : `${line.value} ${STRIP_LABELS[line.key]}`);
  }
  return `Booth: ${who} ${parts.join(" ")} (had ${changed.had})`;
}
