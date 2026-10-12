import { MAX_PLAY_UTTERANCES } from "@/lib/rosters/extractErrors";
import { isReadLook, isTerritory, type ExtractStatsRequest, type ReaderGameState, type RecentPlay, type Side, type StatsRosterPlayer, type StatsUtterance } from "./types";

// =============================================================================
// What POST /api/livestats/extract accepts, checked field by field before any
// of it goes near Claude. Pure, so a test can hand it anything.
// =============================================================================

// =============================================================================
// TUNING: what one request may carry. Enough for a real game, and small
// enough that a crafted or buggy request costs a 400 rather than a large bill
// (docs/PRE_LAUNCH_AUDIT.md H2: 400 players, 60 lines of 2,000 characters and
// 8 aliases each let one call reach about 120,000 input tokens).
// =============================================================================

/** Two rosters (Oct 7: back to 300 from testrun's 400, for H2). */
export const MAX_ROSTER_PLAYERS = 300;

/** The loop sends the last five applied plays (docs/V3_DEFINITION.md 8.1). */
const MAX_RECENT_PLAYS = 5;

/** Longest line kept for one applied play's summary. */
const MAX_RECENT_LENGTH = 120;

/** Longest play id on a recent play. */
const MAX_RECENT_ID = 40;

/**
 * Longest single utterance kept. Deepgram finals run a sentence or two, well
 * under this; a longer one is cut here rather than refused, so one long
 * final never costs the whole read.
 */
export const MAX_UTTERANCE_LENGTH = 400;

/** Longest name, id or position field on a roster line. */
const MAX_FIELD_LENGTH = 80;

/** "Heard as" forms kept per player, the first ones saved. More than this is noise on every call. */
export const MAX_ALIASES = 4;

/** Longest "heard as" form kept (lib/rosters/heardAs.ts MAX_HEARD_AS_LENGTH). Longer ones are dropped. */
export const MAX_ALIAS_LENGTH = 40;

// =============================================================================

/** The request, checked field by field. Null when it is not one; "too_long" when the window is too big. */
export function readRequest(body: unknown): ExtractStatsRequest | "too_long" | null {
  if (!isRecord(body)) return null;
  if (!Array.isArray(body.utterances) || !Array.isArray(body.rosters)) return null;
  if (body.utterances.length > MAX_PLAY_UTTERANCES) return "too_long";
  if (body.rosters.length > MAX_ROSTER_PLAYERS) return null;

  const utterances: StatsUtterance[] = [];
  for (const entry of body.utterances) {
    if (!isRecord(entry)) return null;
    if (typeof entry.seq !== "number" || !Number.isFinite(entry.seq)) return null;
    if (typeof entry.text !== "string") return null;
    const offsetMs = typeof entry.offsetMs === "number" && Number.isFinite(entry.offsetMs) ? entry.offsetMs : 0;
    const text = entry.text.slice(0, MAX_UTTERANCE_LENGTH);
    utterances.push({ seq: Math.round(entry.seq), text, offsetMs: Math.max(0, offsetMs) });
  }

  const rosters: StatsRosterPlayer[] = [];
  for (const entry of body.rosters) {
    if (!isRecord(entry)) return null;
    const playerId = field(entry.playerId);
    const last = field(entry.last);
    if (!playerId || !last) return null;
    if (entry.side !== "home" && entry.side !== "away") return null;
    const aliases = Array.isArray(entry.aliases)
      ? entry.aliases
          .map(field)
          .filter((form): form is string => form !== null && form.length <= MAX_ALIAS_LENGTH)
          .slice(0, MAX_ALIASES)
      : [];
    rosters.push({
      playerId,
      side: entry.side,
      jersey: field(entry.jersey),
      first: field(entry.first),
      last,
      position: field(entry.position),
      ...(aliases.length > 0 ? { aliases } : {}),
    });
  }

  // With ids since Oct 4; a bare summary (an older tab) is a play with no id.
  const recentPlays: RecentPlay[] = Array.isArray(body.recentPlays)
    ? body.recentPlays
        .map((entry): RecentPlay | null => {
          if (typeof entry === "string") {
            return entry.trim().length > 0 ? { playId: "", summary: entry.trim().slice(0, MAX_RECENT_LENGTH) } : null;
          }
          if (!isRecord(entry) || typeof entry.summary !== "string" || entry.summary.trim().length === 0) return null;
          const playId = typeof entry.playId === "string" ? entry.playId.trim().slice(0, MAX_RECENT_ID) : "";
          return { playId, summary: entry.summary.trim().slice(0, MAX_RECENT_LENGTH) };
        })
        .filter((entry): entry is RecentPlay => entry !== null)
        .slice(-MAX_RECENT_PLAYS)
    : [];

  const gameState = readGameState(body.gameState);
  const look = isReadLook(body.look) && body.look !== "first" ? body.look : undefined;
  return { utterances, rosters, recentPlays, ...(gameState ? { gameState } : {}), ...(look ? { look } : {}) };
}

/** Most players a game state may list as out: both rosters. */
const MAX_OUT = MAX_ROSTER_PLAYERS;

/** The game state block (Part 2), field by field; anything malformed is simply left out. Null when nothing usable is there. */
export function readGameState(value: unknown): ReaderGameState | null {
  if (!isRecord(value)) return null;
  const state: ReaderGameState = {};
  if (isRecord(value.teams)) {
    const home = field(value.teams.home);
    const away = field(value.teams.away);
    if (home && away) state.teams = { home, away };
  }
  const quarter = whole(value.quarter, 1, 5);
  if (quarter !== null) state.quarter = quarter;
  if (isRecord(value.score)) {
    const home = whole(value.score.home, 0, 150);
    const away = whole(value.score.away, 0, 150);
    if (home !== null && away !== null) state.score = { home, away };
  }
  if (isSide(value.possession)) state.possession = value.possession;
  const down = whole(value.down, 1, 4);
  if (down !== null) state.down = down;
  const distance = whole(value.distance, 0, 99);
  if (distance !== null) state.distance = distance;
  if (isRecord(value.spot)) {
    const yardLine = whole(value.spot.yardLine, 0, 50);
    if (yardLine !== null && isTerritory(value.spot.territory)) state.spot = { yardLine, territory: value.spot.territory };
  }
  for (const key of ["qbs", "kickers", "punters"] as const) {
    const given = value[key];
    if (!isRecord(given)) continue;
    const ids: Partial<Record<Side, string>> = {};
    for (const side of ["home", "away"] as const) {
      const id = field(given[side]);
      if (id) ids[side] = id;
    }
    if (Object.keys(ids).length > 0) state[key] = ids;
  }
  if (Array.isArray(value.out)) {
    const out = value.out.map(field).filter((id): id is string => id !== null).slice(0, MAX_OUT);
    if (out.length > 0) state.out = out;
  }
  return Object.keys(state).length > 0 ? state : null;
}

function isSide(value: unknown): value is Side {
  return value === "home" || value === "away";
}

function whole(value: unknown, low: number, high: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= low && rounded <= high ? rounded : null;
}

/** A trimmed, non-empty string of sensible length, or null. */
function field(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_FIELD_LENGTH ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

