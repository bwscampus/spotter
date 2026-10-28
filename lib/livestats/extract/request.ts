import type { Candidate } from "../candidates";
import { CANDIDATE_MIN_SCORE, MAX_CANDIDATES, NOT_NAMED } from "../candidates";
import { isTerritory, type FieldSpot, type Score, type Side } from "../types";
import { EXTRACT_CONFIDENCES, EXTRACT_PENALTIES, EXTRACT_PLAY_TYPES, validateAnswer, type ExtractAnswer } from "./schema";

// =============================================================================
// What one per-play request carries (v7, Part 5), on the wire from the
// browser to POST /api/livestats/segment and from the replay harness straight
// to the reader: the game state, the segment's lines marked PRE, PLAY and
// POST, and the candidate list. No roster block and no previous plays: the
// candidates are the roster the model may pick from. Rendered below the
// cached prefix; checked field by field on the server (readSegmentRequest)
// before any of it goes near a model. Pure.
// =============================================================================

// =============================================================================
// TUNING: what one request may carry.
// =============================================================================

/** A segment is a play and a few lines each side; a re-read sends the same. */
export const MAX_SEGMENT_LINES = 40;
export const MAX_SEGMENT_LINE_LENGTH = 400;
export const MAX_SEGMENT_CANDIDATES = MAX_CANDIDATES + 1;
export const MAX_LABEL_LENGTH = 80;
export const MAX_HEARD_AS = 4;
export const MAX_NOTE_LENGTH = 300;

// =============================================================================

export const SEGMENT_LOOKS = ["segment", "second", "reread", "gap"] as const;
export type SegmentLook = (typeof SEGMENT_LOOKS)[number];

export interface SegmentLine {
  seq: number;
  text: string;
  role: "pre" | "play" | "post";
}

export interface SegmentFacts {
  id: string;
  lines: SegmentLine[];
  /** The down and distance called before the play, when one was. */
  dd: { down: number; distance: number | null; isGoal: boolean } | null;
}

/** What the extractor is told about the game: only what the code believes, nothing guessed. */
export interface V7GameState {
  teams?: { home: string; away: string };
  offense?: Side;
  down?: number;
  distance?: number;
  spot?: FieldSpot;
  spotSaid?: boolean;
  quarter?: number;
  score?: Score;
  qbs?: Partial<Record<Side, string>>;
}

export interface SegmentBudget {
  spentUsd: number;
  maxCostUsd: number | null;
}

export interface SegmentRequest {
  look: SegmentLook;
  segment: SegmentFacts;
  candidates: Candidate[];
  gameState: V7GameState;
  /** What the game has spent so far, for the cost guard (Part 8). */
  budget?: SegmentBudget;
  /** On a re-read: the answer as it stands, for a correction or a repeat. */
  current?: ExtractAnswer;
  /** One sentence of context: the missing snap a gap re-read is about, what a second look is for. */
  note?: string;
}

/** "1: #22 Reed Fennimore RB HOME [prior:qb] (heard as fenimore)". */
export function candidateLine(candidate: Candidate): string {
  const tags = candidate.tags.length > 0 ? ` [${candidate.tags.join(", ")}]` : "";
  const heard = candidate.heardAs.length > 0 ? ` (heard as ${candidate.heardAs.join(", ")})` : "";
  return `${candidate.idx}: ${candidate.label}${tags}${heard}`;
}

function ordinal(down: number): string {
  return down === 1 ? "1st" : down === 2 ? "2nd" : down === 3 ? "3rd" : `${down}th`;
}

export function renderV7GameState(state: V7GameState): string {
  const lines: string[] = [];
  const name = (side: Side) => state.teams?.[side] ?? `the ${side} team`;
  if (state.teams) lines.push(`Home: ${state.teams.home}. Away: ${state.teams.away}.`);
  if (state.quarter !== undefined) lines.push(`Quarter: ${state.quarter > 4 ? "overtime" : state.quarter}.`);
  if (state.score) lines.push(`Score: ${name("home")} (home) ${state.score.home}, ${name("away")} (away) ${state.score.away}.`);
  if (state.offense) {
    const parts = [`${name(state.offense)} (${state.offense}) has the ball`];
    if (state.down !== undefined) parts.push(state.distance !== undefined ? `${ordinal(state.down)} and ${state.distance}` : `${ordinal(state.down)} down`);
    if (state.spot) {
      parts.push(state.spot.territory === "midfield" || state.spot.yardLine === 50 ? "at midfield" : state.spot.territory === "unknown" ? `at the ${state.spot.yardLine}` : `at the ${name(state.spot.territory)} ${state.spot.yardLine}`);
    }
    lines.push(`Ball: ${parts.join(", ")}${state.down !== undefined || state.spot ? (state.spotSaid ? " (said)" : " (worked out)") : ""}.`);
  }
  if (state.qbs) {
    const who = (["home", "away"] as const).filter((side) => state.qbs?.[side]).map((side) => `${side} ${state.qbs![side]}`);
    if (who.length > 0) lines.push(`Quarterback on the field: ${who.join(", ")}.`);
  }
  return lines.length === 0 ? "GAME STATE\nNothing known yet." : `GAME STATE\n${lines.join("\n")}`;
}

/** The user message: the game state, the lines and the candidates, in a fixed order. */
export function renderSegmentUser(request: SegmentRequest): string {
  const parts: string[] = [renderV7GameState(request.gameState)];
  const dd = request.segment.dd;
  const call = dd ? `The call before the play: ${ordinal(dd.down)} and ${dd.isGoal ? "goal" : (dd.distance ?? "?")}.` : "No down and distance was called before the play.";
  parts.push(`THE PLAY\n${call}\nEach line is: its part (PRE before the play, PLAY the play, POST after it), the line number, what was said.\n${request.segment.lines.map((line) => `${line.role.toUpperCase()}\t${line.seq}\t${line.text}`).join("\n")}`);
  parts.push(`CANDIDATES\n${request.candidates.map(candidateLine).join("\n")}`);
  if (request.current) parts.push(`CURRENT ANSWER\n${JSON.stringify(request.current)}`);
  if (request.note) parts.push(`NOTE\n${request.note}`);
  parts.push(
    request.look === "second"
      ? "SECOND LOOK: the first read said these lines held no play or named nobody, but a candidate is named in them. Read them again and answer for the play if there is one."
      : request.look === "reread"
        ? "RE-READ: the current answer is what was entered for this play. With the lines before and after it now in, return the corrected answer, or the same answer when it stands."
        : request.look === "gap"
          ? "MISSING SNAP: the downs say a snap was run in these lines and never entered. Answer for that snap if the lines describe it, else not_a_play."
          : "Enter this play.",
  );
  return parts.join("\n\n");
}

/** The texts of the PLAY and POST lines, where a credit must be named. */
export function playAndPostText(request: Pick<SegmentRequest, "segment">): string[] {
  return request.segment.lines.filter((line) => line.role !== "pre").map((line) => line.text);
}

// -----------------------------------------------------------------------------
// The request, checked field by field (the route).
// -----------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function whole(value: unknown, low: number, high: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= low && rounded <= high ? rounded : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function isSide(value: unknown): value is Side {
  return value === "home" || value === "away";
}

export function readV7GameState(value: unknown): V7GameState {
  const state: V7GameState = {};
  if (!isRecord(value)) return state;
  if (isRecord(value.teams)) {
    const home = text(value.teams.home, 80);
    const away = text(value.teams.away, 80);
    if (home && away) state.teams = { home, away };
  }
  if (isSide(value.offense)) state.offense = value.offense;
  const down = whole(value.down, 1, 4);
  if (down !== null) state.down = down;
  const distance = whole(value.distance, 0, 99);
  if (distance !== null) state.distance = distance;
  if (isRecord(value.spot)) {
    const yardLine = whole(value.spot.yardLine, 0, 50);
    if (yardLine !== null && isTerritory(value.spot.territory)) state.spot = { yardLine, territory: value.spot.territory };
  }
  if (typeof value.spotSaid === "boolean") state.spotSaid = value.spotSaid;
  const quarter = whole(value.quarter, 1, 5);
  if (quarter !== null) state.quarter = quarter;
  if (isRecord(value.score)) {
    const home = whole(value.score.home, 0, 150);
    const away = whole(value.score.away, 0, 150);
    if (home !== null && away !== null) state.score = { home, away };
  }
  if (isRecord(value.qbs)) {
    const qbs: Partial<Record<Side, string>> = {};
    for (const side of ["home", "away"] as const) {
      const id = text(value.qbs[side], 80);
      if (id) qbs[side] = id;
    }
    if (Object.keys(qbs).length > 0) state.qbs = qbs;
  }
  return state;
}

/** The request, or null when it is not one. Lines, candidates and labels are cut to their caps rather than refused. */
export function readSegmentRequest(body: unknown): SegmentRequest | null {
  if (!isRecord(body)) return null;
  const look = typeof body.look === "string" && (SEGMENT_LOOKS as readonly string[]).includes(body.look) ? (body.look as SegmentLook) : null;
  if (!look || !isRecord(body.segment) || !Array.isArray(body.candidates)) return null;
  const segment = body.segment;
  const id = text(segment.id, 60);
  if (!id || !Array.isArray(segment.lines) || segment.lines.length === 0 || segment.lines.length > MAX_SEGMENT_LINES) return null;
  const lines: SegmentLine[] = [];
  for (const entry of segment.lines) {
    if (!isRecord(entry)) return null;
    const seq = whole(entry.seq, 0, 1_000_000);
    if (seq === null || typeof entry.text !== "string") return null;
    const role = entry.role === "pre" || entry.role === "play" || entry.role === "post" ? entry.role : null;
    if (!role) return null;
    lines.push({ seq, text: entry.text.slice(0, MAX_SEGMENT_LINE_LENGTH), role });
  }
  if (!lines.some((line) => line.role === "play")) return null;
  let dd: SegmentFacts["dd"] = null;
  if (isRecord(segment.dd)) {
    const down = whole(segment.dd.down, 1, 4);
    if (down !== null) dd = { down, distance: whole(segment.dd.distance, 0, 99), isGoal: segment.dd.isGoal === true };
  }
  if (body.candidates.length > MAX_SEGMENT_CANDIDATES) return null;
  const candidates: Candidate[] = [];
  const seen = new Set<number>();
  for (const entry of body.candidates) {
    if (!isRecord(entry)) return null;
    const idx = whole(entry.idx, 0, MAX_CANDIDATES);
    const label = text(entry.label, MAX_LABEL_LENGTH);
    if (idx === null || !label || seen.has(idx)) return null;
    seen.add(idx);
    const playerId = idx === NOT_NAMED ? null : text(entry.playerId, 60);
    if (idx !== NOT_NAMED && !playerId) return null;
    const score = typeof entry.score === "number" && Number.isFinite(entry.score) ? Math.min(1, Math.max(0, entry.score)) : 0;
    const side = isSide(entry.side) ? entry.side : null;
    const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string" && tag.length <= 20).slice(0, 4) : [];
    const heardAs = Array.isArray(entry.heardAs) ? entry.heardAs.filter((word): word is string => typeof word === "string" && word.length <= 40).slice(0, MAX_HEARD_AS) : [];
    candidates.push({ idx, playerId, label, heardAs, score, side, tags });
  }
  if (!seen.has(NOT_NAMED)) return null;
  const gameState = readV7GameState(body.gameState);
  const request: SegmentRequest = { look, segment: { id, lines, dd }, candidates, gameState };
  if (isRecord(body.budget)) {
    const spent = typeof body.budget.spentUsd === "number" && Number.isFinite(body.budget.spentUsd) ? Math.max(0, body.budget.spentUsd) : 0;
    const cap = typeof body.budget.maxCostUsd === "number" && Number.isFinite(body.budget.maxCostUsd) && body.budget.maxCostUsd > 0 ? body.budget.maxCostUsd : null;
    request.budget = { spentUsd: spent, maxCostUsd: cap };
  }
  if (body.current !== undefined) {
    const current = validateAnswer(body.current, MAX_CANDIDATES);
    if (current) request.current = current;
  }
  const note = text(body.note, MAX_NOTE_LENGTH);
  if (note) request.note = note;
  return request;
}

/** The candidates a model may credit by name (score at or above the line), by index. */
export function namedCandidates(request: Pick<SegmentRequest, "candidates">): Set<number> {
  return new Set(request.candidates.filter((candidate) => candidate.playerId !== null && candidate.score >= CANDIDATE_MIN_SCORE).map((candidate) => candidate.idx));
}

export { EXTRACT_CONFIDENCES, EXTRACT_PENALTIES, EXTRACT_PLAY_TYPES };
