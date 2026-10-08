import {
  isAction,
  isPenaltyOn,
  isPlayType,
  isTerritory,
  isYardsSource,
  NO_PENALTY,
  type Action,
  type ExtractStatsRequest,
  type FieldSpot,
  type Penalty,
  type Score,
  type StatsEvent,
  type StatsPlay,
} from "./types";

// =============================================================================
// Trusting none of Claude's answer. Its own file, with nothing from the
// Anthropic SDK in it, so the server (lib/livestats/extract.ts) and the
// browser (which checks the route's reply again) run the same checks.
// =============================================================================

// =============================================================================
// TUNING: what counts as a well-formed play.
// =============================================================================

/** Longest summary kept. The prompt asks for under 60; this is the slack before cutting. */
const MAX_SUMMARY = 80;

/** The evidence quote is at most this many words (spec 8.2). */
export const MAX_EVIDENCE_WORDS = 20;

/** Longest clock text kept: "under a minute", "2 30", "about 4 minutes". */
const MAX_CLOCK = 24;

/** Longest playerId kept. Real ones are "H22-LANGAN"; anything much longer is not one. */
const MAX_PLAYER_ID = 60;

/** Most events kept on one play. A real play has four or five people in it. */
const MAX_EVENTS = 12;

/** Past this, a yards figure is not a football play on a 100 yard field. */
const MAX_YARDS = 110;

/** Longest `updates` id kept. Real ones are "12-14" or "12-14-2". */
const MAX_UPDATES_ID = 40;

/** Past this, a number is not a football score. */
const MAX_SCORE = 150;

/** The actions a play may carry with nobody read for them (playerId ""). A tackle by nobody is nothing. */
const NOBODY_ALLOWED: ReadonlySet<Action> = new Set(["rush", "reception", "pass_complete", "pass_incomplete", "pass_intercepted", "sacked"]);

// =============================================================================

/**
 * Trusts the schema for shape and nothing for content.
 *
 * The schema says the fields exist and the enums are enums. It cannot say that
 * seqEnd is inside the window, that a down is between one and four, or that a
 * yards figure fits on a field. Those are checked here, where a bad answer
 * costs a dropped field or play rather than a wrong stat.
 *
 * A playerId that is on neither roster is kept on purpose. Dropping it is rule
 * R9, which lives in ./apply.ts with the other rules, so the browser log can
 * say which rule threw the event away.
 */
export function validatePlays(raw: unknown, request: Pick<ExtractStatsRequest, "utterances">): StatsPlay[] {
  if (!isRecord(raw) || !Array.isArray(raw.plays) || request.utterances.length === 0) return [];

  const seqs = request.utterances.map((utterance) => utterance.seq);
  const lowest = Math.min(...seqs);
  const highest = Math.max(...seqs);

  const plays: StatsPlay[] = [];
  for (const candidate of raw.plays) {
    if (!isRecord(candidate)) continue;

    // seqEnd is the whole of deduplication. A play without a usable one would
    // come back every window for the rest of the game.
    const seqEnd = integer(candidate.seqEnd);
    if (seqEnd === null || seqEnd < lowest || seqEnd > highest) continue;
    const seqStart = clamp(integer(candidate.seqStart) ?? seqEnd, lowest, seqEnd);

    const summary = typeof candidate.summary === "string" ? candidate.summary.trim() : "";
    if (summary.length === 0) continue;

    plays.push({
      seqStart,
      seqEnd,
      quarter: inRange(integer(candidate.quarter), 1, 5),
      clock: text(candidate.clock, MAX_CLOCK),
      down: inRange(integer(candidate.down), 1, 4),
      distance: inRange(integer(candidate.distance), 0, 99),
      offense: candidate.offense === "home" || candidate.offense === "away" ? candidate.offense : null,
      playType: isPlayType(candidate.playType) ? candidate.playType : "other",
      nullified: candidate.nullified === true,
      touchdown: candidate.touchdown === true,
      firstDown: candidate.firstDown === true,
      confidence: clamp(number(candidate.confidence) ?? 0, 0, 1),
      summary: summary.slice(0, MAX_SUMMARY),
      evidence: evidence(candidate.evidence),
      events: events(candidate.events),
      updates: text(candidate.updates, MAX_UPDATES_ID) ?? "",
      startSpot: spot(candidate.startSpot),
      endSpot: spot(candidate.endSpot),
      shortBy: inRange(integer(candidate.shortBy), 0, 99),
      score: score(candidate.score),
      penalty: penalty(candidate.penalty),
    });
  }
  return plays;
}

/** Well-formed events only, each (player, action) once. */
function events(value: unknown): StatsEvent[] {
  if (!Array.isArray(value)) return [];
  const kept: StatsEvent[] = [];
  for (const entry of value) {
    if (kept.length >= MAX_EVENTS) break;
    if (!isRecord(entry)) continue;
    const playerId = typeof entry.playerId === "string" ? entry.playerId.trim() : "";
    if (playerId.length > MAX_PLAYER_ID) continue;
    if (!isAction(entry.action)) continue;
    const action = entry.action;
    // Nobody read for it: kept for a pass (the quarterback on the field takes
    // it) and for a carry or a catch (shown as unknown, credited to nobody).
    if (playerId.length === 0 && !NOBODY_ALLOWED.has(action)) continue;
    if (kept.some((already) => already.playerId === playerId && already.action === action)) continue;

    // Yards and where they came from go together (rule R8): a number with no
    // source is a number nobody can vouch for, and a source with no number is
    // nothing to show.
    let yards = inRange(integer(entry.yards), -MAX_YARDS, MAX_YARDS);
    let yardsSource = isYardsSource(entry.yardsSource) ? entry.yardsSource : null;
    if (yards === null || yardsSource === null) {
      yards = null;
      yardsSource = null;
    }

    const kick = action === "field_goal" || action === "extra_point";
    kept.push({
      playerId,
      action,
      yards,
      yardsSource,
      made: kick && typeof entry.made === "boolean" ? entry.made : null,
    });
  }
  return kept;
}

/** The score as stated: two whole numbers that could be a football score. Null for anything else. */
function score(value: unknown): Score | null {
  if (!isRecord(value)) return null;
  const home = inRange(integer(value.home), 0, MAX_SCORE);
  const away = inRange(integer(value.away), 0, MAX_SCORE);
  return home === null || away === null ? null : { home, away };
}

/** The flag as described; no flag when the field is malformed. */
function penalty(value: unknown): Penalty {
  if (!isRecord(value)) return NO_PENALTY;
  const noPlay = value.noPlay === true;
  const beforeSnap = value.beforeSnap === true;
  const on = isPenaltyOn(value.on) ? value.on : noPlay || beforeSnap ? "unknown" : "none";
  return { on, noPlay, beforeSnap };
}

/** A yard line 0 to 50 with whose half it is in; the 50 is always midfield. Null for anything else. */
function spot(value: unknown): FieldSpot | null {
  if (!isRecord(value)) return null;
  const yardLine = inRange(integer(value.yardLine), 0, 50);
  if (yardLine === null) return null;
  if (yardLine === 50) return { yardLine, territory: "midfield" };
  return { yardLine, territory: isTerritory(value.territory) && value.territory !== "midfield" ? value.territory : "unknown" };
}

/** The quote, whitespace tidied, cut to MAX_EVIDENCE_WORDS words. */
function evidence(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().split(/\s+/).filter(Boolean).slice(0, MAX_EVIDENCE_WORDS).join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inRange(value: number | null, low: number, high: number): number | null {
  return value !== null && value >= low && value <= high ? value : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
