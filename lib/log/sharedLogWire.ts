// =============================================================================
// What the browser sends to share a game log in pieces (Oct 12), and the
// checks the route runs on it: the same rules on both sides, so a piece the
// browser makes is a piece the route takes. The database holds them too
// (db/migrations/0020_shared_log_pieces.sql). Pure; imports nothing.
//
// A piece is the scrubbed records past the last piece sent (lib/log/scrub.ts),
// gzipped and base64 encoded. `header` and `counts` are flat lists of
// settings and numbers, never text anybody said: a value is a number, a
// boolean, null or a short string, so a transcript cannot ride along.
// =============================================================================

// =============================================================================
// TUNING (the database's own limits are the same numbers)
// =============================================================================

/** Characters in one piece's gzipped, base64 log. */
export const MAX_PIECE_CHARS = 2_000_000;

/** Pieces in one share: part runs 0 to MAX_PIECES - 1. */
export const MAX_PIECES = 300;

/** Keys in a header or the counts. */
const MAX_FLAT_KEYS = 60;

/** Characters in a string value of a header or the counts. */
const MAX_FLAT_STRING = 40;

// =============================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const BASE64 = /^[A-Za-z0-9+/=]+$/;

/** Settings and counts: flat, short, no free text. */
export type FlatValues = Record<string, string | number | boolean | null>;

/** One piece as POST /api/game-logs/pieces takes it, and share_game_log_piece's arguments after the owner. */
export interface PieceRow {
  share_id: string;
  part: number;
  sport: string | null;
  stats_enabled: boolean;
  scrub_version: number;
  records: number;
  masked: number;
  log_gz_b64: string;
  /** NEXT_PUBLIC_GIT_COMMIT of the build that wrote it, when known. */
  app_commit: string | null;
  /** Settings and environment, sent with the first piece. */
  header: FlatValues | null;
}

const count = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** A flat object of short values, or null when `value` is not one. */
export function flatValues(value: unknown): FlatValues | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_FLAT_KEYS) return null;
  const out: FlatValues = {};
  for (const [key, item] of entries) {
    if (!KEY.test(key)) return null;
    if (typeof item === "number" && !Number.isFinite(item)) return null;
    if (typeof item === "string" && item.length > MAX_FLAT_STRING) return null;
    if (item !== null && !["string", "number", "boolean"].includes(typeof item)) return null;
    out[key] = item as string | number | boolean | null;
  }
  return out;
}

/** The piece in a request body, or null when anything about it is wrong. `isSport` is the roster's own check. */
export function readPiece(value: unknown, isSport: (sport: string) => boolean): PieceRow | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.share_id !== "string" || !UUID.test(v.share_id)) return null;
  if (!count(v.part) || v.part >= MAX_PIECES) return null;
  if (!(v.sport === null || (typeof v.sport === "string" && isSport(v.sport)))) return null;
  if (typeof v.stats_enabled !== "boolean") return null;
  if (!count(v.scrub_version) || v.scrub_version < 1) return null;
  if (!count(v.records) || !count(v.masked)) return null;
  if (typeof v.log_gz_b64 !== "string" || v.log_gz_b64.length === 0 || v.log_gz_b64.length > MAX_PIECE_CHARS || !BASE64.test(v.log_gz_b64)) {
    return null;
  }
  const commit = v.app_commit ?? null;
  if (!(commit === null || (typeof commit === "string" && COMMIT.test(commit)))) return null;
  const header = v.header === undefined || v.header === null ? null : flatValues(v.header);
  if (v.header !== undefined && v.header !== null && header === null) return null;
  return {
    share_id: v.share_id.toLowerCase(),
    part: v.part,
    sport: v.sport,
    stats_enabled: v.stats_enabled,
    scrub_version: v.scrub_version,
    records: v.records,
    masked: v.masked,
    log_gz_b64: v.log_gz_b64,
    app_commit: commit,
    header,
  };
}

/** A share id from the path, lowercased, or null. */
export function readShareId(value: string): string | null {
  return UUID.test(value) ? value.toLowerCase() : null;
}
