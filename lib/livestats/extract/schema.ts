// =============================================================================
// What the per-play extractor answers (v7, Part 5): one object, nine fields,
// nothing nested. The player fields are indexes into the candidate list the
// request carried (lib/livestats/candidates.ts), 0 for NOT_NAMED, so the model
// picks from a short numbered list rather than copying a playerId. Five
// fields are nullable, under the API's limit of sixteen; the three enums are
// never null, so no anyOf is needed (the trap in CLAUDE.md: a nullable enum
// written as a type list is rejected before the model reads anything).
// Mirrors ExtractAnswer below. Change one and change the other.
// =============================================================================

export const EXTRACT_PLAY_TYPES = ["rush", "pass_complete", "pass_incomplete", "sack", "interception", "fumble_lost", "punt", "kick", "penalty_only", "no_play", "not_a_play"] as const;
export type ExtractPlayType = (typeof EXTRACT_PLAY_TYPES)[number];

export const EXTRACT_PENALTIES = ["none", "offense", "defense", "unclear"] as const;
export type ExtractPenalty = (typeof EXTRACT_PENALTIES)[number];

export const EXTRACT_CONFIDENCES = ["high", "medium", "low"] as const;
export type ExtractConfidence = (typeof EXTRACT_CONFIDENCES)[number];

export interface ExtractAnswer {
  playType: ExtractPlayType;
  /** The ball carrier on a rush, the quarterback on a sack, the fumbler, the punter, the kicker. */
  carrierIdx: number | null;
  passerIdx: number | null;
  /** The catcher; the target on an incompletion when named; the interceptor; the returner. */
  receiverIdx: number | null;
  /** The defender who brought the carrier down, broke the pass up, made the sack or recovered the fumble. */
  tacklerIdx: number | null;
  /** Only a number the announcer said for THIS play's gain (a loss negative). */
  yardsSaid: number | null;
  touchdown: boolean;
  penalty: ExtractPenalty;
  confidence: ExtractConfidence;
}

/** The fields that may be null. The schema test counts them against the API's limit of sixteen. */
export const NULLABLE_FIELDS = ["carrierIdx", "passerIdx", "receiverIdx", "tacklerIdx", "yardsSaid"] as const;

/**
 * Structured outputs schema: every property required, nothing nested deeper
 * than the one object, no minimum or maximum (the ranges are checked in
 * validateAnswer, where a bad value costs a null rather than a refused
 * request).
 */
export const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    playType: { type: "string", enum: [...EXTRACT_PLAY_TYPES], description: "What the play was, or not_a_play for a replay, a recap or talk between plays" },
    carrierIdx: { type: ["integer", "null"], description: "Candidate index of the ball carrier on a rush, the quarterback on a sack, the fumbler, the punter or the kicker; 0 for NOT_NAMED; null when the play has no carrier" },
    passerIdx: { type: ["integer", "null"], description: "Candidate index of the passer on a pass or interception; 0 for NOT_NAMED; null when no pass was thrown" },
    receiverIdx: { type: ["integer", "null"], description: "Candidate index of the catcher, the target on an incompletion, the interceptor, or the returner; 0 for NOT_NAMED; null when there is none" },
    tacklerIdx: { type: ["integer", "null"], description: "Candidate index of the defender who brought the carrier down, broke up the pass, made the sack or recovered the fumble; null when none is named" },
    yardsSaid: { type: ["integer", "null"], description: "Only a number the announcer said for this play's gain or loss (a loss negative); null otherwise" },
    touchdown: { type: "boolean", description: "True only when these lines say this play scored" },
    penalty: { type: "string", enum: [...EXTRACT_PENALTIES], description: "none, offense, defense, or unclear when there was a flag and nobody said whose" },
    confidence: { type: "string", enum: [...EXTRACT_CONFIDENCES], description: "high when the lines say it plainly, medium when one thing is unclear, low when guessing" },
  },
  required: ["playType", "carrierIdx", "passerIdx", "receiverIdx", "tacklerIdx", "yardsSaid", "touchdown", "penalty", "confidence"],
  additionalProperties: false,
} as const;

/** Past this, a yards figure is not a football play on a 100 yard field. */
const MAX_YARDS = 110;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function index(value: unknown, most: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const whole = Math.round(value);
  return whole >= 0 && whole <= most ? whole : null;
}

/**
 * The answer, trusting the schema for shape and nothing for content: an index
 * off the candidate list is NOT_NAMED, yards past a field's length are null,
 * an unknown enum value makes the whole answer unreadable (null), which the
 * caller retries once.
 */
export function validateAnswer(raw: unknown, candidateCount: number): ExtractAnswer | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.playType !== "string" || !(EXTRACT_PLAY_TYPES as readonly string[]).includes(raw.playType)) return null;
  if (typeof raw.penalty !== "string" || !(EXTRACT_PENALTIES as readonly string[]).includes(raw.penalty)) return null;
  if (typeof raw.confidence !== "string" || !(EXTRACT_CONFIDENCES as readonly string[]).includes(raw.confidence)) return null;
  const most = Math.max(0, candidateCount);
  const idx = (value: unknown) => (value === null || value === undefined ? null : (index(value, most) ?? 0));
  const yards = typeof raw.yardsSaid === "number" && Number.isFinite(raw.yardsSaid) && Math.abs(raw.yardsSaid) <= MAX_YARDS ? Math.round(raw.yardsSaid) : null;
  return {
    playType: raw.playType as ExtractPlayType,
    carrierIdx: idx(raw.carrierIdx),
    passerIdx: idx(raw.passerIdx),
    receiverIdx: idx(raw.receiverIdx),
    tacklerIdx: idx(raw.tacklerIdx),
    yardsSaid: yards,
    touchdown: raw.touchdown === true,
    penalty: raw.penalty as ExtractPenalty,
    confidence: raw.confidence as ExtractConfidence,
  };
}

/** The answer that credits nobody and says nothing happened. */
export const NOT_A_PLAY: ExtractAnswer = { playType: "not_a_play", carrierIdx: null, passerIdx: null, receiverIdx: null, tacklerIdx: null, yardsSaid: null, touchdown: false, penalty: "none", confidence: "high" };
