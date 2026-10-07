// =============================================================================
// The analytics vocabulary and the privacy filter, shared by the browser queue
// (lib/analytics/track.ts) and the server route that inserts batches
// (app/api/events/route.ts). Both run every event through the same functions,
// so the rule holds even for a request that did not come from Spotter's code.
//
// PRIVACY: codes and counts only. Never a player name, a jersey, a heard word,
// transcript, or anything read from a file. docs/V3_DEFINITION.md section 10.1.
//
// A string prop is kept only when it is one of the values declared for that
// event and key in ENUM_PROPS below. That is what "enum" means here: a surname
// in lowercase is short and looks like a code, so a length or pattern check
// alone could not tell them apart. When you add an event with a string prop,
// declare its values here or the prop is dropped.
// =============================================================================

import { REMOVAL_KEYS } from "@/lib/keys";
import { EXTRACT_FAILURE_CODES } from "@/lib/rosters/extractErrors";
import { IMPORT_FORMATS, SPORTS } from "@/lib/rosters/types";

// =============================================================================
// TUNING: how much an event may carry. app_events.props is capped at 2048
// bytes in the database; these keep a well-formed event far below that.
// =============================================================================

/** A string longer than this is prose or a name, not an enum. */
export const MAX_STRING_LENGTH = 40;

/** Keys are snake_case codes of at most this many characters. */
export const MAX_KEY_LENGTH = 40;

/** Serialized props stop growing at this many characters. */
export const MAX_PROPS_CHARS = 1200;

/** Events accepted in one request. The browser sends at most MAX_BATCH_SIZE. */
export const MAX_EVENTS_PER_REQUEST = 50;

/** A client timestamp further off than this is replaced with the server's clock. */
const MAX_PAST_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

// =============================================================================

/** What was imported: a roster now, season stats from item 5. */
export const IMPORT_KINDS = ["roster", "stats"] as const;

/** How big an import was, in buckets so the size itself never identifies a file. */
export const SIZE_BUCKETS = ["under_100kb", "under_1mb", "under_4mb", "4mb_plus"] as const;

export function sizeBucket(bytes: number): (typeof SIZE_BUCKETS)[number] {
  if (bytes < 100 * 1024) return "under_100kb";
  if (bytes < 1024 * 1024) return "under_1mb";
  if (bytes < 4 * 1024 * 1024) return "under_4mb";
  return "4mb_plus";
}

/**
 * Why an import failed: every guard's code, the approval gate's codes, and the
 * two failures only the browser sees (the request never arrived, or Vercel
 * refused its size before the route did).
 */
export const IMPORT_FAIL_CODES = [
  ...EXTRACT_FAILURE_CODES,
  "not_approved",
  "approval_unavailable",
  "network",
  "payload_too_large",
] as const;

/** What put a card up that was taken down: a surname, or a number and the cue beside it. */
export const CARD_CUES = ["name", "number_explicit", "number_surname", "number_team"] as const;

/** Whether the card's match was the name itself or a near sound of it. */
export const MATCH_KINDS = ["exact", "near"] as const;

/**
 * A match score, bucketed so a correction can be read against the thresholds
 * without carrying the score of one particular name. The matcher's bar is 0.85
 * for most names and 0.95 for short ones; 1 is the name said exactly.
 */
export const SCORE_BUCKETS = ["under_0_85", "0_85_to_0_9", "0_9_to_0_95", "0_95_to_1", "exact"] as const;

export function scoreBucket(score: number): (typeof SCORE_BUCKETS)[number] {
  if (score >= 1) return "exact";
  if (score >= 0.95) return "0_95_to_1";
  if (score >= 0.9) return "0_9_to_0_95";
  if (score >= 0.85) return "0_85_to_0_9";
  return "under_0_85";
}

/**
 * Every event in docs/V3_DEFINITION.md section 10.2. The check constraint on
 * app_events.name lists the same names; adding one here needs a migration too.
 */
export const EVENT_NAMES = [
  "account.signed_up",
  "prep.import_started",
  "prep.import_finished",
  "prep.roster_saved",
  "prep.cards_previewed",
  "game.started",
  "game.mic_started",
  "game.mic_stopped",
  "game.ended",
  "names.card_removed",
  "names.roster_refreshed",
  "stats.play_applied",
  "stats.play_undone",
  "stats.toggled",
  "stats.call_failed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/**
 * The string values each event may carry, by prop key. Numbers and booleans
 * need no entry. Items that add events declare their enums here.
 */
export const ENUM_PROPS: Partial<Record<EventName, Record<string, readonly string[]>>> = {
  "account.signed_up": { method: ["google", "email"] },
  "prep.import_started": { kind: IMPORT_KINDS, format: IMPORT_FORMATS, size_bucket: SIZE_BUCKETS },
  "prep.import_finished": {
    kind: IMPORT_KINDS,
    format: IMPORT_FORMATS,
    route: ["text", "vision"],
    fail_code: IMPORT_FAIL_CODES,
  },
  // prep.roster_saved is counts only.
  "game.started": { sport: SPORTS },
  "names.card_removed": { key: REMOVAL_KEYS, cue: CARD_CUES, match: MATCH_KINDS, score_bucket: SCORE_BUCKETS },
  // game.mic_started, game.mic_stopped, names.roster_refreshed and game.ended are counts only.
};

export type PropValue = number | boolean | string;
export type SafeProps = Record<string, PropValue>;

/** What a caller may hand in. Anything that does not fit is dropped, not rejected. */
export type EventProps = Record<string, PropValue | null | undefined>;

const KEY_PATTERN = new RegExp(`^[a-z][a-z0-9_]{0,${MAX_KEY_LENGTH - 1}}$`);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/;

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENT_NAMES as readonly string[]).includes(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** A git commit, or "unknown" when the build could not tell. */
export function appVersionOrUnknown(value: unknown): string {
  return typeof value === "string" && COMMIT_PATTERN.test(value) ? value : "unknown";
}

export type DroppedProp = { key: string; reason: "key" | "type" | "not_enum" | "size" };

/**
 * Keeps finite numbers, booleans, and declared enum strings of at most
 * MAX_STRING_LENGTH characters. Drops everything else: null, objects, arrays,
 * free text, and any key that is not a short snake_case code. Stops adding
 * keys once the serialized props would pass MAX_PROPS_CHARS.
 *
 * onDrop hears the key and why, never the value, so a caller can warn a
 * developer without echoing what was dropped.
 */
export function sanitizeProps(
  name: EventName,
  props: unknown,
  onDrop?: (dropped: DroppedProp) => void,
): SafeProps {
  const safe: SafeProps = {};
  if (!props || typeof props !== "object" || Array.isArray(props)) return safe;

  const enums = ENUM_PROPS[name] ?? {};
  let size = 2; // "{}"

  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (!KEY_PATTERN.test(key)) {
      onDrop?.({ key: key.slice(0, MAX_KEY_LENGTH), reason: "key" });
      continue;
    }

    let kept: PropValue;
    if (typeof value === "number" && Number.isFinite(value)) {
      kept = Math.round(value * 1000) / 1000;
    } else if (typeof value === "boolean") {
      kept = value;
    } else if (typeof value === "string") {
      const allowed = enums[key];
      if (value.length === 0 || value.length > MAX_STRING_LENGTH || !allowed?.includes(value)) {
        onDrop?.({ key, reason: "not_enum" });
        continue;
      }
      kept = value;
    } else {
      if (value !== null && value !== undefined) onDrop?.({ key, reason: "type" });
      continue;
    }

    // Comma, quotes and colon around each pair.
    const added = JSON.stringify(key).length + JSON.stringify(kept).length + 2;
    if (size + added > MAX_PROPS_CHARS) {
      onDrop?.({ key, reason: "size" });
      continue;
    }
    size += added;
    safe[key] = kept;
  }

  return safe;
}

/** One event as the browser queues it and the wire carries it. */
export type WireEvent = {
  name: EventName;
  at: string;
  game_id: string | null;
  props: SafeProps;
};

/** One request to POST /api/events. */
export type WireBatch = {
  session_id: string;
  app_version: string;
  events: WireEvent[];
};

/** A batch after the server has checked it. env and owner_id are added by the route. */
export type ParsedBatch = {
  sessionId: string;
  appVersion: string;
  events: WireEvent[];
};

/**
 * Checks a request body that claims to be a WireBatch. Returns null when the
 * batch as a whole is unusable (no session id, no events list); otherwise
 * keeps the events that are valid and re-filters their props, because the body
 * may not have come from Spotter's own queue.
 */
export function parseBatch(body: unknown, now: Date): ParsedBatch | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  if (!isUuid(raw.session_id) || !Array.isArray(raw.events)) return null;

  const events: WireEvent[] = [];
  for (const entry of raw.events.slice(0, MAX_EVENTS_PER_REQUEST)) {
    if (!entry || typeof entry !== "object") continue;
    const event = entry as Record<string, unknown>;
    if (!isEventName(event.name)) continue;
    events.push({
      name: event.name,
      at: clampTimestamp(event.at, now),
      game_id: isUuid(event.game_id) ? event.game_id.toLowerCase() : null,
      props: sanitizeProps(event.name, event.props),
    });
  }

  return {
    sessionId: raw.session_id.toLowerCase(),
    appVersion: appVersionOrUnknown(raw.app_version),
    events,
  };
}

/** The client's time when it is plausible, the server's otherwise. */
function clampTimestamp(value: unknown, now: Date): string {
  if (typeof value === "string") {
    const at = Date.parse(value);
    if (Number.isFinite(at) && at >= now.getTime() - MAX_PAST_MS && at <= now.getTime() + MAX_FUTURE_MS) {
      return new Date(at).toISOString();
    }
  }
  return now.toISOString();
}
