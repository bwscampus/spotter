// The only thing Spotter persists. Each row holds a matched name, the single
// transcript word that triggered it, and scores. Never transcripts, never audio.
//
// A number row is the same shape: the number in `word`, the one word that cued
// it in `cueWord`, and nothing of the sentence they were said in.

import type { NumberCue } from "./numbers";

export interface LogRow {
  /** ISO time the row was created. */
  at: string;
  type: "match" | "repeat" | "retracted" | "near_miss" | "conflict" | "wrong";
  name: string;
  /** Only the word(s) that scored, never the surrounding sentence. */
  word: string;
  score: number;
  threshold: number;
  /** Deepgram's per-word confidence. */
  confidence: number;
  source: "interim" | "final";
  /** Result arrival to the name painted on screen. match rows only. */
  latencyMs: number | null;
  /** Result arrival to the name written into the DOM. match rows only. */
  domMs: number | null;
  /** What made a number fire. Absent on rows about a name alone. */
  cue?: NumberCue | null;
  /** The single word that cued a number: "number", a team, or the surname. */
  cueWord?: string | null;
  /** Why a number did not fire: "veto:score", "not_on_roster", "no_cue". near_miss and conflict rows. */
  reason?: string | null;
  /**
   * Which game this row belongs to, so Past games can show one game's rows.
   * Absent on rows written before Past games existed, and on a game that was
   * never recorded.
   */
  gameId?: string | null;
  /**
   * The roster slots this row put on screen, as the jersey index keys them.
   * Written by the engine, read only when a game is being summarised: it is
   * what turns a row back into a player without parsing the label.
   */
  slots?: string[];
}

export interface LogCounts {
  matches: number;
  nearMisses: number;
}

const STORAGE_KEY = "spotter.matchLog.v1";
const MAX_ROWS = 5000; // oldest rows are dropped past this
const SAVE_DELAY_MS = 1000;
const EMPTY_COUNTS: LogCounts = { matches: 0, nearMisses: 0 };

const CSV_COLUMNS: Array<[header: string, key: keyof LogRow]> = [
  ["timestamp", "at"],
  ["type", "type"],
  ["name", "name"],
  ["word", "word"],
  ["match_score", "score"],
  ["threshold", "threshold"],
  ["deepgram_confidence", "confidence"],
  ["result", "source"],
  ["cue", "cue"],
  ["cue_word", "cueWord"],
  ["reason", "reason"],
  ["ms_to_paint", "latencyMs"],
  ["ms_to_dom", "domMs"],
];

let rows: LogRow[] | null = null;
let counts: LogCounts = EMPTY_COUNTS;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function countRows(list: LogRow[]): LogCounts {
  let matches = 0;
  let nearMisses = 0;
  for (const row of list) {
    if (row.type === "match") matches++;
    else if (row.type === "near_miss") nearMisses++;
  }
  return { matches, nearMisses };
}

function ensureLoaded(): LogRow[] {
  if (rows) return rows;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    rows = Array.isArray(parsed) ? (parsed as LogRow[]) : [];
  } catch {
    rows = [];
  }
  counts = countRows(rows);
  window.addEventListener("pagehide", flush);
  return rows;
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!rows) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch (err) {
    console.warn("[Spotter] Could not save the match log:", err);
  }
}

function notify() {
  counts = countRows(rows ?? []);
  listeners.forEach((listener) => listener());
}

export function appendLogRows(newRows: LogRow[]) {
  if (newRows.length === 0) return;
  const list = ensureLoaded();
  list.push(...newRows);
  if (list.length > MAX_ROWS) list.splice(0, list.length - MAX_ROWS);
  notify();
  saveTimer ??= setTimeout(flush, SAVE_DELAY_MS);
}

export function clearLog() {
  ensureLoaded();
  rows = [];
  flush();
  notify();
}

/** One game's rows, oldest first. Empty for a game called on another computer. */
export function logRowsForGame(gameId: string): LogRow[] {
  return ensureLoaded().filter((row) => row.gameId === gameId);
}

export function logToCsv(rows: LogRow[] = ensureLoaded()): string {
  const cell = (value: unknown) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const body = rows.map((row) => CSV_COLUMNS.map(([, key]) => cell(row[key])).join(","));
  return [header, ...body].join("\r\n");
}

// useSyncExternalStore bindings for the counts shown on screen.
export function subscribeLog(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLogCounts(): LogCounts {
  ensureLoaded();
  return counts;
}

export function getServerLogCounts(): LogCounts {
  return EMPTY_COUNTS;
}
