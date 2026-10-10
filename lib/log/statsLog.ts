import type { KeyedPlayer } from "@/lib/cards/playerKey";
import { FOOTBALL_STAT_LABELS, isFootballStatKey, type FootballStatKey } from "@/lib/cards/statKeys";
import type { StatChange } from "@/lib/cards/tonight";

// =============================================================================
// Live stats in the browser log (docs/V3_DEFINITION.md 8.6 and 9.3): every
// Claude reply, every play read with what it would change and the words it
// was read from, and every decision the announcer made about it.
//
// PRIVACY: the play-by-play names minors. These records live in this
// browser's IndexedDB with the rest of the log and leave only by Download.
//
// Plain shapes, read structurally, so nothing here imports live stats: the
// card path writes the log too and may not reach lib/livestats/.
// =============================================================================

/** A play as read, in the shape lib/livestats/types.ts gives it. Kept whole for the log and the NFL comparison. */
export interface LoggedPlay {
  seqStart: number;
  seqEnd: number;
  quarter: number | null;
  clock: string | null;
  down: number | null;
  distance: number | null;
  offense: "home" | "away" | null;
  playType: string;
  nullified: boolean;
  touchdown: boolean;
  firstDown: boolean;
  confidence: number;
  summary: string;
  evidence: string;
  events: Array<{
    playerId: string;
    action: string;
    yards: number | null;
    yardsSource: string | null;
    made: boolean | null;
    estimated?: boolean;
  }>;
  /** Since Oct 4 (lib/livestats/types.ts). Absent on plays logged before. */
  updates?: string;
  startSpot?: { yardLine: number; territory: string } | null;
  endSpot?: { yardLine: number; territory: string } | null;
  shortBy?: number | null;
}

/**
 * An event a rule did something to, with the rule: thrown away (the default),
 * moved to another player (`to`), filled in by code, or changed. Every credit
 * code drops, moves or fills in is one of these (docs/V3_DEFINITION.md 8.3,
 * and the Oct 4 checks in lib/livestats/check.ts).
 */
export interface LoggedDrop {
  playerId: string;
  action: string;
  rule: string;
  reason: string;
  /** Absent on records written before Oct 4, which only ever dropped. */
  kind?: "dropped" | "moved" | "filled" | "changed" | "restored";
  /** The player the event went to, when it was moved or filled in. */
  to?: string;
}

/** One reply from POST /api/livestats/extract, or the failure instead of one. */
export interface StatsReplyRecord {
  kind: "stats_reply";
  gameId: string;
  at: number;
  ok: boolean;
  /** The failure code when it did not work. */
  code?: string;
  /** Every play the reply carried, before the seqEnd dedupe, exactly as validated. */
  plays?: LoggedPlay[];
  /** The window it was asked about, or, with code skipped_lines, the lines left unread. */
  seqFrom?: number;
  seqTo?: number;
  /** With code skipped_lines: how many lines of a backlog were never read (lib/plays/window.ts readingPlan). */
  skipped?: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
}

/** A new play, waiting for the announcer: what it would change, and what the rules dropped. */
export interface StatsPlayRecord {
  kind: "stats_play";
  gameId: string;
  at: number;
  playId: string;
  play: LoggedPlay;
  changes: StatChange[];
  dropped: LoggedDrop[];
}

/**
 * What the announcer did with a play. "edit" carries the play's changes as
 * they now stand, whole, so the log never has to replay a correction to know
 * what it came to.
 */
export interface StatsDecisionRecord {
  kind: "stats_decision";
  gameId: string;
  at: number;
  playId: string;
  decision: "ok" | "discard" | "undo" | "edit";
  changes?: StatChange[];
  /** On an edit (Oct 10): everything typed on the play so far, which a later read is laid under. Absent on older logs. */
  edits?: TypedEdit[];
}

/**
 * One thing the announcer typed on a play (Oct 10). A later read of the play
 * rebuilds its credits and these are laid on top, in order, so only what was
 * typed is locked: a player put in another's place, an item set to a number
 * or added, an item taken out. `keys` on a player change are the stats only
 * one player can hold that the old player had then.
 */
export type TypedEdit =
  | { type: "player"; from: string; to: string; keys: FootballStatKey[] }
  | { type: "set"; playerId: string; key: FootballStatKey; amount: number | null; estimated: boolean }
  | { type: "remove"; playerId: string; key: FootballStatKey };

/**
 * A play already read, added to by a later read (the rest of the call, a
 * replay, a recap) or by the code (yards back-filled from the next down and
 * distance): the play, its changes and its notes as they now stand. Its status
 * is whatever the decisions say; an update never counts or uncounts a play.
 */
export interface StatsUpdateRecord {
  kind: "stats_update";
  gameId: string;
  at: number;
  playId: string;
  play: LoggedPlay;
  changes: StatChange[];
  dropped: LoggedDrop[];
}

/** The stats switch on the live screen. */
export interface StatsSwitchRecord {
  kind: "stats_switch";
  gameId: string;
  at: number;
  on: boolean;
}

export type StatsRecord = StatsReplyRecord | StatsPlayRecord | StatsUpdateRecord | StatsDecisionRecord | StatsSwitchRecord;

export const STATS_RECORD_KINDS = ["stats_reply", "stats_play", "stats_update", "stats_decision", "stats_switch"] as const;

export function isStatsRecord(record: { kind: string }): record is StatsRecord {
  return (STATS_RECORD_KINDS as readonly string[]).includes(record.kind);
}

// -----------------------------------------------------------------------------
// Folding the records back into where each play stands. Shared by the live
// screen, which rebuilds its stats this way after a reload, and the download.
// -----------------------------------------------------------------------------

/** Waiting for the announcer, counted, or thrown away. Undo puts a counted play back to waiting. */
export type PlayStatus = "pending" | "applied" | "discarded";

export interface FoldedPlay {
  playId: string;
  play: LoggedPlay;
  /** As they stand now, corrections included. */
  changes: StatChange[];
  /** As the rules first worked them out. */
  original: StatChange[];
  dropped: LoggedDrop[];
  status: PlayStatus;
  edited: boolean;
  /** What the announcer typed, in order; absent when nothing was, or on a log from before Oct 10. */
  edits?: TypedEdit[];
  /** Times a later read or the code added to it. */
  updated: number;
  readAt: number;
  /** When it was last OK'd, discarded or taken back. Null while it has only ever waited. */
  decidedAt: number | null;
}

/** Every play read, in the order it was read, as the decisions in the log leave it. */
export function foldStats(records: readonly { kind: string }[]): FoldedPlay[] {
  const plays = new Map<string, FoldedPlay>();
  for (const record of records) {
    if (!isStatsRecord(record)) continue;
    if (record.kind === "stats_play") {
      if (plays.has(record.playId)) continue;
      plays.set(record.playId, {
        playId: record.playId,
        play: record.play,
        changes: record.changes,
        original: record.changes,
        dropped: record.dropped,
        status: "pending",
        edited: false,
        updated: 0,
        readAt: record.at,
        decidedAt: null,
      });
      continue;
    }
    if (record.kind === "stats_update") {
      const play = plays.get(record.playId);
      if (!play) continue;
      play.play = record.play;
      // What the announcer typed is already laid on the update's changes. A
      // log from before Oct 10 has no edits, and a correction there outlives
      // every later read, as it did then.
      if (!play.edited || play.edits) play.changes = record.changes;
      play.dropped = record.dropped;
      play.updated += 1;
      continue;
    }
    if (record.kind !== "stats_decision") continue;
    const play = plays.get(record.playId);
    if (!play) continue;
    if (record.decision === "edit") {
      if (record.changes) {
        play.changes = record.changes;
        play.edited = true;
        if (record.edits) play.edits = record.edits;
      }
      continue;
    }
    play.status = record.decision === "ok" ? "applied" : record.decision === "discard" ? "discarded" : "pending";
    play.decidedAt = record.at;
  }
  return [...plays.values()];
}

// -----------------------------------------------------------------------------
// The stats log download: one row per change, so a spreadsheet can sum it by
// player and stat, with what was heard beside it.
// -----------------------------------------------------------------------------

const CSV_COLUMNS = [
  "time",
  "quarter",
  "clock",
  "down",
  "distance",
  "play",
  "status",
  "corrected",
  "player",
  "side",
  "jersey",
  "stat",
  "amount",
  "worked_out",
  "summary",
  "heard",
  "dropped",
] as const;

/**
 * The stats log as a .csv: every play Spotter read, what it would change for
 * each player, what the announcer decided, and the words it was read from.
 * Player names come from the newest game record, which carries both rosters.
 * Null when the game read no plays, so the download can skip the file.
 */
export function toStatsCsv(records: readonly { kind: string }[]): string | null {
  const plays = foldStats(records);
  if (plays.length === 0) return null;

  const players = new Map<string, KeyedPlayer>();
  for (const record of records) {
    const roster = (record as { kind: string; snapshot?: { statsRoster?: unknown } }).snapshot?.statsRoster;
    if (record.kind !== "game" || !Array.isArray(roster)) continue;
    for (const player of roster as KeyedPlayer[]) players.set(player.playerId, player);
  }

  const lines: string[] = [CSV_COLUMNS.join(",")];
  for (const folded of plays) {
    const { play } = folded;
    const common = {
      time: clockTime(folded.readAt),
      quarter: play.quarter ?? "",
      clock: play.clock ?? "",
      down: play.down ?? "",
      distance: play.distance ?? "",
      play: folded.playId,
      status: folded.status === "applied" ? "counted" : folded.status === "pending" ? "waiting" : "discarded",
      corrected: folded.edited ? "yes" : "no",
      summary: play.summary,
      heard: play.evidence,
      dropped: folded.dropped.map((drop) => `${drop.rule} ${drop.action}${drop.to ? ` -> ${drop.to}` : ""}`).join("; "),
    };
    const rows = folded.changes.length > 0 ? folded.changes : [null];
    for (const change of rows) {
      const player = change ? players.get(change.playerId) : undefined;
      const row: Record<(typeof CSV_COLUMNS)[number], string | number> = {
        ...common,
        player: change ? (player ? [player.first, player.last].filter(Boolean).join(" ") : change.playerId) : "",
        side: player?.side ?? "",
        jersey: player?.jersey ?? "",
        stat: change ? statLabel(change.key) : "",
        amount: change ? (change.amount === null ? "?" : change.amount) : "",
        worked_out: change?.estimated && change.amount !== null ? "yes" : "",
      };
      lines.push(CSV_COLUMNS.map((column) => cell(row[column])).join(","));
    }
  }
  return lines.join("\n") + "\n";
}

function statLabel(key: string): string {
  return isFootballStatKey(key) ? FOOTBALL_STAT_LABELS[key] : key;
}

/** "19:03:12" in the browser's own time zone, which is the announcer's. */
export function clockTime(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Quoted when it has to be, and never read as a formula by a spreadsheet. */
function cell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
