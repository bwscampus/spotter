// =============================================================================
// A shared game log (lib/log/scrub.ts, "spotter-v3-shared-log") turned back
// into the browser log shape the replays read ("spotter-v3-log" version 1), so
// `npm run check:cards`, `replay:stats` and `score:stats` run on a log pulled
// from shared_game_logs exactly as on a downloaded one.
//
// The scrub put a tag where each first name and school word was ([H22],
// [H4|A18], [HOME1], [name]), the same tag in the transcript, Deepgram's words
// and the game record. The matcher reads only letters, so "[HOME1]" would read
// as the word "homeb" and "[H22]" as "h". Each tag becomes one made-up word
// instead (tagWord), letters only, the same word everywhere it appears: a team cue the game heard is a team cue the replay hears, and the
// word before a shared surname still names the same player.
//
// What a replay of a shared log cannot reproduce: a first name the scrub left
// as said (an everyday word like "will", a two-letter name) is a tag on the
// roster and a word in the transcript, so it no longer tells two players who
// share a surname apart. Logs scrubbed before version 3 carry no roster at all
// and cannot be replayed.
//
// Imports nothing, so the card path's replay and live stats' replay can both
// use it (test/cardPathIsolation.test.ts). Pure.
// =============================================================================

/** The first scrub whose game record carries what a replay needs. */
export const REPLAYABLE_SCRUB_VERSION = 3;

/** A scrub tag: "[H22]", "[H4|A18]", "[HOME1]", "[name]", "[H4|A18|H7|...]". */
const TAG = /\[([^[\]\s]{1,60})\]/g;

/** Letters in a tag's word: enough that no two tags, nor a tag and a real word, sound alike. */
const TAG_WORD_LETTERS = 10;

/**
 * The one word a tag becomes: letters only, worked out from the tag by a hash,
 * so [H2] and [H23] are as unlike each other as two random words. Spelled
 * alike, the matcher would score one first name against the other and narrow
 * a shared surname the game did not.
 */
export function tagWord(tag: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (const char of tag) {
    const code = char.charCodeAt(0);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  let word = "";
  for (let index = 0; index < TAG_WORD_LETTERS; index++) {
    word += String.fromCharCode(97 + (index % 2 === 0 ? a : b) % 26);
    if (index % 2 === 0) a = Math.floor(a / 26) ^ Math.imul(b, 31) >>> 0;
    else b = Math.floor(b / 26) ^ Math.imul(a, 17) >>> 0;
    a >>>= 0;
    b >>>= 0;
  }
  return word;
}

/** The scrub version of a shared log, or null when this is not one. */
export function sharedLogVersion(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const file = raw as Record<string, unknown>;
  if (file.format !== "spotter-v3-shared-log") return null;
  return typeof file.scrubVersion === "number" ? file.scrubVersion : 0;
}

/** Why a shared log cannot be replayed, or null when it can (or is not a shared log). */
export function sharedLogProblem(raw: unknown): string | null {
  const version = sharedLogVersion(raw);
  if (version === null || version >= REPLAYABLE_SCRUB_VERSION) return null;
  return `This shared log was scrubbed by version ${version}, which kept no roster, so it cannot be replayed. Read it by eye.`;
}

function untag(value: unknown): unknown {
  if (typeof value === "string") return value.replace(TAG, (tag) => tagWord(tag));
  if (Array.isArray(value)) return value.map(untag);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = untag(item);
    return out;
  }
  return value;
}

/**
 * The log as the replays read it, when `raw` is a shared log they can replay;
 * anything else comes back as it was, for the caller's own checks to refuse.
 */
export function replayableLog(raw: unknown): unknown {
  const version = sharedLogVersion(raw);
  if (version === null || version < REPLAYABLE_SCRUB_VERSION) return raw;
  const file = raw as { records?: unknown };
  const records = (Array.isArray(file.records) ? file.records : []).map(untag);
  return { format: "spotter-v3-log", version: 1, gameId: "shared", records };
}
