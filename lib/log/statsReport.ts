import type { KeyedPlayer } from "@/lib/cards/playerKey";
import { FOOTBALL_STAT_KEYS, FOOTBALL_STAT_LABELS, type FootballStatKey } from "@/lib/cards/statKeys";
import { tallyChanges, type StatChange } from "@/lib/cards/tonight";
import { ALARM_WORDS, type AlarmReason, type ConnectionEventKind } from "@/lib/game/connectionWatch";
import { gapLabel, gapsOf, type HeardGap } from "./gaps";
import { clockTime, foldStats, isStatsRecord, type FoldedPlay } from "./statsLog";
import type { SheetData } from "write-excel-file/browser";

// =============================================================================
// The live stats report (the testrun branch): what Spotter thinks happened,
// play by play, and what it all came to for every player, in one workbook a
// box score can be laid beside.
//
//   Totals        every player with a counted stat, one column per stat, and
//                 each team's total
//   Play by play  every play read: where, what Spotter thinks happened, what
//                 it gave each player, what the rules dropped, and the words
//   Calls         every call to Claude: which lines it read and what came back
//   Transcript    everything said, numbered, with the play each line went into.
//                 A line with no play beside it is where to look for a miss.
//
// Pure: the browser log in, rows out. lib/log/download.ts writes the .xlsx.
// Plain shapes read structurally, like statsLog.ts, so nothing here reaches
// live stats: Past games downloads through this file.
//
// PRIVACY: names minors and holds the play-by-play. It leaves the browser
// only by the announcer's own Download, like the rest of the log.
// =============================================================================

export type ReportCell = string | number | null;

export interface ReportSheet {
  name: string;
  /** Lines above the table: the game, and what the sheet counts. */
  intro: string[];
  header: string[];
  rows: ReportCell[][];
  /** Column widths in characters, one per header column. */
  widths: number[];
}

export interface StatsReport {
  title: string;
  sheets: ReportSheet[];
}

type Side = "home" | "away";

interface Teams {
  home: string;
  away: string;
}

/** The report for one game, or null when it read no plays and said nothing. */
export function buildStatsReport(records: readonly { kind: string }[]): StatsReport | null {
  const plays = foldStats(records);
  const said = transcriptOf(records);
  if (plays.length === 0 && said.length === 0) return null;

  const players = new Map<string, KeyedPlayer>();
  let teams: Teams = { home: "Home", away: "Away" };
  for (const record of records) {
    if (record.kind !== "game") continue;
    const snapshot = (record as { snapshot?: { home?: { name?: unknown }; away?: { name?: unknown }; statsRoster?: unknown } })
      .snapshot;
    if (!snapshot) continue;
    teams = {
      home: typeof snapshot.home?.name === "string" ? snapshot.home.name : teams.home,
      away: typeof snapshot.away?.name === "string" ? snapshot.away.name : teams.away,
    };
    // The newest game record wins, so a Refresh rosters is what the report names.
    if (Array.isArray(snapshot.statsRoster)) {
      for (const player of snapshot.statsRoster as KeyedPlayer[]) players.set(player.playerId, player);
    }
  }

  const title = `${teams.away} at ${teams.home}`;
  const numbered = plays.map((play, index) => ({ number: index + 1, play }));
  return {
    title,
    sheets: [
      totalsSheet(title, plays, players, teams),
      playsSheet(title, numbered, players, teams, gapsOf(records)),
      callsSheet(title, records),
      eventsSheet(title, records),
      transcriptSheet(title, said, numbered),
    ],
  };
}

// -----------------------------------------------------------------------------
// Totals.
// -----------------------------------------------------------------------------

function totalsSheet(title: string, plays: FoldedPlay[], players: Map<string, KeyedPlayer>, teams: Teams): ReportSheet {
  const countedPlays = plays.filter((play) => play.status === "applied");
  const tallies = tallyChanges(countedPlays.flatMap((play) => play.changes));
  const used = FOOTBALL_STAT_KEYS.filter(
    (key) => key !== "gp" && [...tallies.values()].some((tally) => (tally.stats[key] ?? 0) !== 0),
  );

  const order = [...tallies.keys()].sort((a, b) => comparePlayers(players.get(a), players.get(b), a, b));
  const rows: ReportCell[][] = [];
  const teamTotals = new Map<Side, Partial<Record<FootballStatKey, number>>>();
  for (const playerId of order) {
    const tally = tallies.get(playerId)!;
    const player = players.get(playerId);
    const side = player?.side;
    if (side) {
      const total = teamTotals.get(side) ?? {};
      for (const key of used) {
        const value = tally.stats[key];
        if (value === undefined) continue;
        total[key] = key === "fg_long" ? Math.max(total[key] ?? 0, value) : (total[key] ?? 0) + value;
      }
      teamTotals.set(side, total);
    }
    rows.push([
      side ? teams[side] : "",
      player?.jersey ?? "",
      player ? fullName(player) : playerId,
      player?.position ?? "",
      ...used.map((key) => nonZero(tally.stats[key])),
      tally.estimated.filter((key) => used.includes(key)).map((key) => FOOTBALL_STAT_LABELS[key]).join(", "),
    ]);
  }
  for (const side of ["away", "home"] as const) {
    const total = teamTotals.get(side);
    if (!total) continue;
    rows.push([`${teams[side]} total`, "", "", "", ...used.map((key) => nonZero(total[key])), ""]);
  }

  const waitingCount = plays.filter((play) => play.status === "pending").length;
  const discarded = plays.filter((play) => play.status === "discarded").length;
  return {
    name: "Totals",
    intro: [
      title,
      `Counted plays only: ${countedPlays.length} counted, ${discarded} discarded, ${waitingCount} waiting, of ${plays.length} read.`,
      "Worked out (~ on the card): stats that include yards worked out from yard lines or phrasing, or anything from a play StatCast was unsure of.",
    ],
    header: ["Team", "#", "Player", "Pos", ...used.map((key) => FOOTBALL_STAT_LABELS[key]), "Worked out"],
    rows,
    widths: [18, 5, 22, 6, ...used.map((key) => Math.max(6, FOOTBALL_STAT_LABELS[key].length + 2)), 22],
  };
}

/** Away before home, the way the title reads, then by jersey number. Anybody on neither roster goes last. */
function comparePlayers(a: KeyedPlayer | undefined, b: KeyedPlayer | undefined, idA: string, idB: string): number {
  if (!a || !b) return a ? -1 : b ? 1 : idA.localeCompare(idB);
  if (a.side !== b.side) return a.side === "away" ? -1 : 1;
  const jersey = jerseyNumber(a.jersey) - jerseyNumber(b.jersey);
  return jersey !== 0 ? jersey : a.last.localeCompare(b.last);
}

function jerseyNumber(jersey: string | null): number {
  const number = Number((jersey ?? "").replace(/^#/, ""));
  return Number.isFinite(number) && (jersey ?? "") !== "" ? number : 999;
}

/** A blank rather than a 0, so the sheet reads like a box score. */
function nonZero(value: number | undefined): number | null {
  return value === undefined || value === 0 ? null : value;
}

// -----------------------------------------------------------------------------
// Play by play.
// -----------------------------------------------------------------------------

function playsSheet(
  title: string,
  numbered: Array<{ number: number; play: FoldedPlay }>,
  players: Map<string, KeyedPlayer>,
  teams: Teams,
  gaps: readonly HeardGap[] = [],
): ReportSheet {
  // A stretch with nothing heard goes where it fell, before the first play read after it (Oct 4).
  const rows: ReportCell[][] = [];
  const pending = [...gaps].sort((a, b) => a.from - b.from);
  const gapRow = (gap: HeardGap): ReportCell[] => [null, clockTime(gap.from), null, "", null, null, "", "", "nothing heard", gapLabel(gap), "", "", "", null, "", "", ""];
  for (const { number, play: folded } of numbered) {
    while (pending.length > 0 && pending[0].to <= folded.readAt) rows.push(gapRow(pending.shift()!));
    rows.push(playRow(number, folded, players, teams));
  }
  for (const gap of pending) rows.push(gapRow(gap));
  return {
    name: "Play by play",
    intro: [title, "Every play StatCast read, in the order it read them. Stats are as they stand, corrections included. A \"nothing heard\" line is a stretch of over a minute with no words, so the totals around it are incomplete."],
    header: [
      "#",
      "Time",
      "Q",
      "Clock",
      "Down",
      "To go",
      "Offense",
      "Play",
      "Status",
      "What it thinks happened",
      "Stats",
      "Dropped by a rule",
      "Heard",
      "Confidence",
      "Flags",
      "Corrected",
      "Lines",
    ],
    rows,
    widths: [5, 9, 4, 7, 6, 6, 16, 12, 10, 48, 60, 40, 60, 11, 18, 10, 9],
  };
}

function playRow(number: number, folded: FoldedPlay, players: Map<string, KeyedPlayer>, teams: Teams): ReportCell[] {
  {
    const { play } = folded;
    return [
      number,
      clockTime(folded.readAt),
      play.quarter === null ? null : play.quarter > 4 ? "OT" : play.quarter,
      play.clock ?? "",
      play.down,
      play.distance,
      play.offense ? teams[play.offense] : "",
      play.playType.replace(/_/g, " "),
      folded.status === "applied" ? "counted" : folded.status === "pending" ? "waiting" : "discarded",
      play.summary,
      folded.changes.map((change) => changeText(change, players)).join(", "),
      folded.dropped
        .map(
          (drop) =>
            `${drop.rule} ${drop.action} by ${drop.playerId ? label(drop.playerId, players) : "nobody"}` +
            `${drop.to ? ` -> ${label(drop.to, players)}` : ""}: ${drop.reason}`,
        )
        .join("; "),
      play.evidence,
      play.confidence,
      [play.touchdown ? "TD" : "", play.firstDown ? "1st down" : "", play.nullified ? "flag, wiped out" : ""]
        .filter(Boolean)
        .join(", "),
      folded.edited ? "yes" : "",
      lines(play.seqStart, play.seqEnd),
    ];
  }
}

/** "FENNIMORE #22 +8 Rush yds", "~8" when worked out, "?" when nobody said. */
function changeText(change: StatChange, players: Map<string, KeyedPlayer>): string {
  return `${label(change.playerId, players)} ${amountOf(change)} ${FOOTBALL_STAT_LABELS[change.key]}`;
}

function amountOf(change: StatChange): string {
  if (change.amount === null) return "?";
  if (change.estimated) return `~${change.amount}`;
  if (change.key === "fg_long") return String(change.amount);
  return change.amount >= 0 ? `+${change.amount}` : String(change.amount);
}

function label(playerId: string, players: Map<string, KeyedPlayer>): string {
  const player = players.get(playerId);
  if (!player) return playerId;
  return player.jersey ? `${player.last.toUpperCase()} #${player.jersey.replace(/^#/, "")}` : player.last.toUpperCase();
}

function fullName(player: KeyedPlayer): string {
  return [player.first, player.last].filter(Boolean).join(" ");
}

/** Transcript lines, numbered from 1 as the Transcript sheet numbers them. */
function lines(seqFrom: number | undefined, seqTo: number | undefined): string {
  if (seqFrom === undefined || seqTo === undefined) return "";
  return seqFrom === seqTo ? String(seqFrom + 1) : `${seqFrom + 1}-${seqTo + 1}`;
}

// -----------------------------------------------------------------------------
// Calls.
// -----------------------------------------------------------------------------

function callsSheet(title: string, records: readonly { kind: string }[]): ReportSheet {
  const rows: ReportCell[][] = [];
  for (const record of records) {
    if (!isStatsRecord(record) || record.kind !== "stats_reply") continue;
    rows.push([
      rows.length + 1,
      clockTime(record.at),
      record.ok ? "ok" : (record.code ?? "failed"),
      lines(record.seqFrom, record.seqTo),
      record.ok ? (record.plays?.length ?? 0) : null,
      record.tokensIn ?? null,
      record.tokensOut ?? null,
      record.tokensCached ?? null,
    ]);
  }
  return {
    name: "Calls",
    intro: [title, "Every time StatCast asked Claude to read the last plays. A failure counted nothing from those lines."],
    header: ["#", "Time", "Result", "Lines", "Plays returned", "Tokens in", "Tokens out", "Cached"],
    rows,
    widths: [5, 9, 22, 9, 14, 11, 11, 11],
  };
}

// -----------------------------------------------------------------------------
// Events: the connection record (Oct 4).
// -----------------------------------------------------------------------------

/** Plain words for each event the connection record carries. */
const EVENT_WORDS: Record<ConnectionEventKind, string> = {
  socket_open: "Speech recognition connected",
  socket_closed: "Speech recognition connection closed",
  reconnect: "Reconnect",
  mic_ended: "Mic stopped",
  mic_muted: "Mic muted",
  mic_unmuted: "Mic unmuted",
  tab_hidden: "Tab hidden",
  tab_visible: "Tab visible",
  wakelock_lost: "Screen wake lock lost",
  wakelock_regained: "Screen wake lock regained",
  alarm_on: "Not hearing you",
  alarm_off: "Hearing again",
  timer_jump: "Clock jumped",
  idle_stop: "Listening stopped on its own",
};

function eventsSheet(title: string, records: readonly { kind: string }[]): ReportSheet {
  const rows: ReportCell[][] = [];
  for (const record of records) {
    const any = record as {
      kind: string;
      at?: unknown;
      event?: unknown;
      code?: unknown;
      attempt?: unknown;
      ms?: unknown;
      reason?: unknown;
      idle?: unknown;
    };
    if (any.kind !== "connection" || typeof any.at !== "number" || typeof any.event !== "string") continue;
    const event = any.event as ConnectionEventKind;
    const detail = [
      typeof any.code === "number" ? `close code ${any.code}` : "",
      typeof any.attempt === "number" ? `attempt ${any.attempt}` : "",
      typeof any.ms === "number" ? `${Math.round(any.ms / 1000)} s` : "",
      typeof any.reason === "string" ? (ALARM_WORDS[any.reason as AlarmReason] ?? any.reason) : "",
      any.idle === "quiet" ? "no words for too long" : any.idle === "too_long" ? "listening for too long" : "",
    ]
      .filter(Boolean)
      .join(", ");
    rows.push([clockTime(any.at), EVENT_WORDS[event] ?? event, detail]);
  }
  return {
    name: "Events",
    intro: [title, "What happened to the connection: the socket, the mic, the tab, the screen wake lock and the silence alarm."],
    header: ["Time", "Event", "Detail"],
    rows,
    widths: [9, 30, 60],
  };
}

// -----------------------------------------------------------------------------
// Transcript.
// -----------------------------------------------------------------------------

/**
 * Everything said, numbered the way the live loop and the replay number it:
 * every non-blank final, in the order the log holds them.
 */
function transcriptOf(records: readonly { kind: string }[]): Array<{ at: number; text: string }> {
  const said: Array<{ at: number; text: string }> = [];
  for (const record of records) {
    const any = record as { kind: string; at?: unknown; text?: unknown };
    if (any.kind !== "utterance" || typeof any.text !== "string" || typeof any.at !== "number") continue;
    if (any.text.trim().length === 0) continue;
    said.push({ at: any.at, text: any.text });
  }
  return said;
}

function transcriptSheet(
  title: string,
  said: Array<{ at: number; text: string }>,
  numbered: Array<{ number: number; play: FoldedPlay }>,
): ReportSheet {
  const rows = said.map(({ at, text }, seq): ReportCell[] => {
    const into = numbered
      .filter(({ play }) => play.play.seqStart <= seq && seq <= play.play.seqEnd)
      .map(({ number }) => number);
    return [seq + 1, clockTime(at), text, into.join(", ")];
  });
  return {
    name: "Transcript",
    intro: [title, "Everything said. Play is the play-by-play # the line went into; a blank is a line no play came from."],
    header: ["Line", "Time", "Said", "Play"],
    rows,
    widths: [6, 9, 100, 8],
  };
}

// -----------------------------------------------------------------------------
// As workbook sheets, in the shape write-excel-file takes (browser and node
// alike): the intro lines, a blank line, the header in bold and kept in view
// while scrolling, then the rows.
// -----------------------------------------------------------------------------

export interface WorkbookSheet {
  sheet: string;
  data: SheetData;
  columns: Array<{ width: number }>;
  stickyRowsCount: number;
}

export function workbookSheets(report: StatsReport): WorkbookSheet[] {
  return report.sheets.map((sheet) => ({
    sheet: sheet.name,
    data: [
      ...sheet.intro.map((line, index) => [index === 0 ? { value: line, fontWeight: "bold" as const } : line]),
      [],
      sheet.header.map((name) => ({ value: name, fontWeight: "bold" as const })),
      ...sheet.rows,
    ],
    columns: sheet.widths.map((width) => ({ width })),
    stickyRowsCount: sheet.intro.length + 2,
  }));
}
