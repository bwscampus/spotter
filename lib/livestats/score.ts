import type { TonightTally } from "@/lib/cards/tonight";
import { surnameKey } from "./names";
import { TRUTH_KEYS, type Truth, type TruthKey, type TruthPlayer } from "./truth";
import type { StatsRosterPlayer } from "./types";

// =============================================================================
// Scoring one game's live stats against its box score (scripts/score-livestats.ts,
// Part 1 of the Oct 11 work): the measurements that used to take a night of
// reading an audit by hand, as numbers a run prints in one line.
//
//   COUNT  the share of count stats (attempts, completions, carries, catches,
//          touchdowns, interceptions, returns, kicks) that match exactly;
//   YARDS  the share of yard stats within max(3 yards, 10%) of the truth, and
//          the yards found as a share of the truth's total, for passing,
//          rushing and receiving;
//   WRONG  credits to players who have none of that stat in the truth.
//
// A truth player is matched to the roster by side and jersey, else by side and
// surname, never by a guess between two. Only stats the truth file lists are
// scored. Pure: the file reading, the fetch and the replay are the scorer's.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A yards figure within this many yards of the box score counts as right... */
export const YARD_TOLERANCE_YDS = 3;

/** ...or within this share of it, whichever is wider: 3 yards on a 20-yard night, 10% on a 300-yard one. */
export const YARD_TOLERANCE_SHARE = 0.1;

// =============================================================================

/** The truth keys that hold yards; the rest are counts. */
export const YARD_TRUTH_KEYS: readonly TruthKey[] = ["pass_yds", "rush_yds", "rec_yds", "kr_yds"];

export const COUNT_TRUTH_KEYS: readonly TruthKey[] = TRUTH_KEYS.filter((key) => !YARD_TRUTH_KEYS.includes(key));

export const YARD_GROUPS = [
  { label: "passing", key: "pass_yds" },
  { label: "rushing", key: "rush_yds" },
  { label: "receiving", key: "rec_yds" },
] as const;
export type YardGroup = (typeof YARD_GROUPS)[number]["label"];

export interface Ratio {
  hit: number;
  total: number;
}

export interface YardTotals {
  found: number;
  truth: number;
}

/** What one replay of the game did, for the score line. */
export interface RunFigures {
  calls: number;
  costUsd: number;
  playsRead: number;
  /** Seconds from each new play's last line to the moment its stats were applied. */
  latencies: number[];
}

/** One truth player beside what Spotter found for them, for the detail table. */
export interface PlayerDetail {
  side: "home" | "away";
  jersey: string | null;
  name: string;
  playerId: string | null;
  truth: Partial<Record<TruthKey, number>>;
  found: Partial<Record<TruthKey, number>>;
}

export interface GameScore {
  label: string;
  note?: string;
  count: Ratio;
  yards: { within: Ratio; groups: Record<YardGroup, YardTotals> };
  wrong: { credits: number; items: Array<{ playerId: string; key: TruthKey; amount: number }> };
  players: { truth: number; matched: number };
  run: RunFigures;
  detail: PlayerDetail[];
}

/** A bare jersey for matching: "#07" is "7". */
function bareJersey(jersey: string | null | undefined): string | null {
  if (!jersey) return null;
  const text = jersey.trim().replace(/^#/, "").replace(/^0+(?=\d)/, "");
  return text.length > 0 ? text : null;
}

/**
 * Which roster player each truth player is: the one player on that side with
 * the jersey, else the one player on that side with the surname, else null.
 * A roster player is matched at most once.
 */
export function matchTruth(truth: Truth, roster: readonly StatsRosterPlayer[]): Map<TruthPlayer, string | null> {
  const matches = new Map<TruthPlayer, string | null>();
  const taken = new Set<string>();
  const find = (player: TruthPlayer): string | null => {
    const side = roster.filter((each) => each.side === player.side && !taken.has(each.playerId));
    const jersey = bareJersey(player.jersey);
    if (jersey !== null) {
      const sameNumber = side.filter((each) => bareJersey(each.jersey) === jersey);
      if (sameNumber.length === 1) return sameNumber[0].playerId;
      if (sameNumber.length > 1) {
        const named = sameNumber.filter((each) => surnameKey(each.last) === surnameKey(player.last));
        return named.length === 1 ? named[0].playerId : null;
      }
    }
    const key = surnameKey(player.last);
    if (key.length === 0) return null;
    const sameName = side.filter((each) => surnameKey(each.last) === key);
    return sameName.length === 1 ? sameName[0].playerId : null;
  };
  // Jersey matches first, so a surname fallback never takes a player whose number is somebody else's.
  const ordered = [...truth.players].sort((a, b) => Number(bareJersey(a.jersey) === null) - Number(bareJersey(b.jersey) === null));
  for (const player of ordered) {
    const id = find(player);
    if (id) taken.add(id);
    matches.set(player, id);
  }
  return matches;
}

/** Within the tolerance of the truth: max(YARD_TOLERANCE_YDS, YARD_TOLERANCE_SHARE of the truth). */
export function yardsClose(found: number, truth: number): boolean {
  return Math.abs(found - truth) <= Math.max(YARD_TOLERANCE_YDS, YARD_TOLERANCE_SHARE * Math.abs(truth));
}

/** The game, scored. `totals` are Spotter's tonight tallies by playerId, as the replay left them. */
export function scoreGame(
  label: string,
  truth: Truth,
  totals: ReadonlyMap<string, TonightTally>,
  roster: readonly StatsRosterPlayer[],
  run: RunFigures,
): GameScore {
  const matches = matchTruth(truth, roster);
  const truthOf = new Map<string, TruthPlayer>();
  for (const [player, id] of matches) if (id) truthOf.set(id, player);
  // Only the stats the truth file lists are scored.
  const scored = new Set<TruthKey>();
  for (const player of truth.players) for (const key of Object.keys(player.stats)) scored.add(key as TruthKey);

  const count: Ratio = { hit: 0, total: 0 };
  const within: Ratio = { hit: 0, total: 0 };
  const groups: Record<YardGroup, YardTotals> = { passing: { found: 0, truth: 0 }, rushing: { found: 0, truth: 0 }, receiving: { found: 0, truth: 0 } };
  const detail: PlayerDetail[] = [];

  for (const player of truth.players) {
    const id = matches.get(player) ?? null;
    const found = id ? (totals.get(id)?.stats ?? {}) : {};
    const row: PlayerDetail = { side: player.side, jersey: player.jersey, name: player.name, playerId: id, truth: {}, found: {} };
    for (const key of TRUTH_KEYS) {
      const truthValue = player.stats[key];
      if (truthValue === undefined) continue;
      const foundValue = found[key] ?? 0;
      row.truth[key] = truthValue;
      row.found[key] = foundValue;
      if (YARD_TRUTH_KEYS.includes(key)) {
        within.total += 1;
        if (id && yardsClose(foundValue, truthValue)) within.hit += 1;
      } else {
        count.total += 1;
        if (id && foundValue === truthValue) count.hit += 1;
      }
    }
    for (const group of YARD_GROUPS) groups[group.label].truth += player.stats[group.key] ?? 0;
    detail.push(row);
  }

  // Yards found: everyone Spotter credited, matched or not, so a credit on the
  // wrong player still shows as yards found (and as WRONG below).
  for (const tally of totals.values()) for (const group of YARD_GROUPS) groups[group.label].found += tally.stats[group.key] ?? 0;

  const wrong: GameScore["wrong"] = { credits: 0, items: [] };
  for (const [playerId, tally] of totals) {
    const player = truthOf.get(playerId);
    for (const key of TRUTH_KEYS) {
      if (!scored.has(key)) continue;
      const amount = tally.stats[key];
      if (!amount) continue;
      if (!player || !(player.stats[key] ?? 0)) {
        wrong.credits += 1;
        wrong.items.push({ playerId, key, amount });
      }
    }
    if (!player) {
      const found: Partial<Record<TruthKey, number>> = {};
      for (const key of TRUTH_KEYS) if (scored.has(key) && tally.stats[key]) found[key] = tally.stats[key]!;
      if (Object.keys(found).length > 0) {
        const onRoster = roster.find((each) => each.playerId === playerId);
        detail.push({ side: onRoster?.side ?? "home", jersey: onRoster?.jersey ?? null, name: onRoster?.last ?? playerId, playerId, truth: {}, found });
      }
    }
  }

  return {
    label,
    ...(truth.note ? { note: truth.note } : {}),
    count,
    yards: { within, groups },
    wrong,
    players: { truth: truth.players.length, matched: [...matches.values()].filter(Boolean).length },
    run,
    detail,
  };
}

/** Every game's numbers added up, for the one combined line. */
export function combineScores(scores: readonly GameScore[]): GameScore {
  const sum = (pick: (score: GameScore) => Ratio): Ratio => ({
    hit: scores.reduce((total, score) => total + pick(score).hit, 0),
    total: scores.reduce((total, score) => total + pick(score).total, 0),
  });
  const groups: Record<YardGroup, YardTotals> = { passing: { found: 0, truth: 0 }, rushing: { found: 0, truth: 0 }, receiving: { found: 0, truth: 0 } };
  for (const score of scores) {
    for (const group of YARD_GROUPS) {
      groups[group.label].found += score.yards.groups[group.label].found;
      groups[group.label].truth += score.yards.groups[group.label].truth;
    }
  }
  return {
    label: `ALL (${scores.length} ${scores.length === 1 ? "game" : "games"})`,
    count: sum((score) => score.count),
    yards: { within: sum((score) => score.yards.within), groups },
    wrong: { credits: scores.reduce((total, score) => total + score.wrong.credits, 0), items: [] },
    players: {
      truth: scores.reduce((total, score) => total + score.players.truth, 0),
      matched: scores.reduce((total, score) => total + score.players.matched, 0),
    },
    run: {
      calls: scores.reduce((total, score) => total + score.run.calls, 0),
      costUsd: scores.reduce((total, score) => total + score.run.costUsd, 0),
      playsRead: scores.reduce((total, score) => total + score.run.playsRead, 0),
      latencies: scores.flatMap((score) => score.run.latencies),
    },
    detail: [],
  };
}

/** Seconds from each play's last line to when its stats were applied, for the plays whose line is known. */
export function latencySeconds(plays: ReadonlyArray<{ play: { seqEnd: number }; readAt: number }>, atOf: (seq: number) => number | undefined): number[] {
  const seconds: number[] = [];
  for (const play of plays) {
    const at = atOf(play.play.seqEnd);
    if (at === undefined || !Number.isFinite(play.readAt)) continue;
    seconds.push(Math.max(0, (play.readAt - at) / 1000));
  }
  return seconds;
}

function pct(ratio: Ratio): string {
  return ratio.total === 0 ? "n/a" : `${ratio.hit}/${ratio.total} (${Math.round((100 * ratio.hit) / ratio.total)}%)`;
}

function share(totals: YardTotals): string {
  return totals.truth === 0 ? `${totals.found}/0` : `${totals.found}/${totals.truth} (${Math.round((100 * totals.found) / totals.truth)}%)`;
}

function middle(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * One line per game, and the same shape for the combined line, so two runs can
 * be laid side by side. No player names: the line may go in a pull request.
 */
export function scoreLine(score: GameScore): string {
  const latency = middle(score.run.latencies);
  return (
    `${score.label}: COUNT ${pct(score.count)} · YARDS ${pct(score.yards.within)} within, ` +
    YARD_GROUPS.map((group) => `${group.label} ${share(score.yards.groups[group.label])}`).join(", ") +
    ` · WRONG ${score.wrong.credits} · ${score.run.calls} calls, $${score.run.costUsd.toFixed(2)}, ${score.run.playsRead} plays read` +
    (latency === null ? "" : `, ${latency.toFixed(1)} s median to stats`) +
    ` · ${score.players.matched}/${score.players.truth} truth players matched`
  );
}

/** The same numbers as JSON, without the detail table. */
export function scoreJson(score: GameScore): Record<string, unknown> {
  return {
    label: score.label,
    ...(score.note ? { note: score.note } : {}),
    count: score.count,
    yards: score.yards,
    wrong: score.wrong.credits,
    players: score.players,
    calls: score.run.calls,
    costUsd: Number(score.run.costUsd.toFixed(4)),
    playsRead: score.run.playsRead,
    latencyMedianS: middle(score.run.latencies),
  };
}

/** Whether `child` is `parent` or inside it, both as absolute paths with "/" separators. */
export function isInside(child: string, parent: string): boolean {
  const norm = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
  const a = norm(child);
  const b = norm(parent);
  return a === b || a.startsWith(`${b}/`);
}
