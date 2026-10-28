import { doubleMetaphone } from "double-metaphone";
import { closeLimit, editDistance, letters, squeeze, surnameTokens } from "../names";
import type { StatsRosterPlayer } from "../types";
import { lettersOf } from "./tokens";

// =============================================================================
// Who a line names (v7, Part 2): a phonetic index of both rosters, built once
// per roster, and for each line the players it may be talking about with a
// score from 0 to 1 and where in the line. The transcript misspells names,
// often badly ("fafitaga" for Fifita), so a surname is matched four ways,
// best first: the exact surname or a "heard as" form (1.0), a close spelling
// (0.85), the same double-metaphone code (0.8) or one within an edit or two
// of it (0.7, 0.6), and a jersey number with a cue beside it ("number 22",
// "tailback 22": 0.95 and 0.9). A first name beside the surname makes it 1.0;
// on its own it is 0.5, under the candidate line (lib/livestats/candidates.ts),
// so "Sam" alone never puts a player on the list.
//
// Two players who share a surname both come back on the bare surname, at the
// same score, with nothing to tell them apart: the candidate builder tags
// them and the extractor reads the position and the side.
//
// Pure and synchronous. The index holds every code it will compare against,
// so a line costs one metaphone call per word and a few map lookups; the
// edit-distance pass runs only against codes of the same first letter.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

export const SCORE_EXACT = 1;
export const SCORE_FIRST_LAST = 1;
export const SCORE_JERSEY_CUE = 0.95;
export const SCORE_JERSEY_POSITION = 0.9;
export const SCORE_SPELLING = 0.85;
export const SCORE_SOUND_EXACT = 0.8;
export const SCORE_SOUND_ONE_EDIT = 0.7;
export const SCORE_SOUND_TWO_EDITS = 0.6;
export const SCORE_FIRST_ALONE = 0.5;

/** A metaphone code shorter than this is too little sound to mean anyone ("Lee" is "L"). */
export const MIN_CODE = 3;

/** Two edits between codes only when the longer code is this long and the shorter at least TWO_EDIT_MIN_SHORT: a short code two edits off is another word. */
export const TWO_EDIT_MIN_CODE = 5;
export const TWO_EDIT_MIN_SHORT = 4;

/**
 * Words a broadcast is made of that never count as a near miss of a surname
 * (a close spelling or a sound-alike): "third" sounds like Duarte, "picks"
 * like Pellegrosso. A surname that is one of these ("Long", "Brown") still
 * matches exactly, because the exact path runs first.
 */
export const NOT_NAMES = new Set([
  "the", "and", "for", "with", "from", "into", "over", "under", "back", "out", "off", "on", "at", "to", "of", "in", "by", "up", "down",
  "he", "him", "his", "they", "them", "their", "there", "here", "that", "this", "what", "who", "now", "then", "again", "just", "gets",
  "got", "takes", "take", "took", "comes", "come", "goes", "go", "went", "had", "has", "have", "was", "were", "will", "would", "could",
  "can", "not", "but", "so", "as", "if", "or", "all", "big", "good", "great", "nice", "little", "long", "short", "left", "right",
  "middle", "side", "end", "deep", "wide", "open", "free", "loose", "clean", "fast", "quick", "slow", "late", "early", "high", "low",
  "inside", "outside", "across", "around", "through", "behind", "ahead", "toward", "towards", "forward", "straight", "hard", "well",
  "way", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "twenty", "thirty", "forty", "fifty", "hundred",
  "first", "second", "third", "fourth", "1st", "2nd", "3rd", "4th", "yard", "yards", "yarder", "ball", "field", "zone", "goal", "line",
  "flag", "flags", "play", "plays", "snap", "huddle", "half", "quarter", "time", "clock", "team", "teams", "home", "away", "offense",
  "defense", "touchdown", "punt", "punts", "kick", "kicks", "kicker", "catch", "catches", "caught", "tackle", "tackles", "tackled", "sack",
  "sacked", "pick", "picks", "picked", "pass", "passes", "throw", "throws", "threw", "run", "runs", "ran", "running", "carry", "carries",
  "carried", "hands", "hand", "handoff", "brought", "bring", "brings", "wraps", "wrapped", "stopped", "stops", "drops", "dropped",
  "complete", "incomplete", "fumble", "fumbles", "recovered", "recovers", "intercepted", "interception", "return", "returns", "returned",
  "gain", "gains", "gained", "loss", "lost", "loses", "bounces", "bounce", "breaks", "break", "broke", "broken", "fires", "fired",
  "tonight", "today", "night", "game", "season", "year", "week", "tonight's", "crowd", "band", "fans", "coach", "coaches", "referee",
  "official", "officials", "timeout", "huddles", "formation", "shotgun", "center", "guard", "tackle", "receiver", "receivers", "quarterback",
  "linebacker", "corner", "safety", "wearing", "wears", "uniforms", "uniform", "jersey", "jerseys", "number", "numbers", "score", "scores",
  "scored", "points", "point", "lead", "leads", "leading", "trail", "trails", "trailing", "tied", "drive", "drives", "series", "possession",
  "motion", "pressure", "blitz", "coverage", "route", "routes", "screen", "sweep", "draw", "option", "keeper", "scramble", "scrambles",
  "sideline", "sidelines", "bounds", "marker", "chains", "sticks", "whistle", "ruled", "review", "replay", "another", "other", "same",
  "every", "some", "any", "more", "most", "very", "really", "about", "almost", "near", "past", "still", "only", "even", "also", "too",
  "make", "makes", "made", "give", "gives", "gave", "get", "find", "finds", "found", "look", "looks", "looking", "see", "sees", "saw",
  "watch", "know", "think", "going", "coming", "trying", "tries", "try", "turn", "turns", "turned", "keep", "keeps", "kept", "move",
  "moves", "moved", "cut", "cuts", "step", "steps", "stepped", "spin", "spins", "slips", "falls", "fell", "hit", "hits", "stood", "stands",
  "stand", "sets", "set", "signal", "signals", "called", "calls", "call", "yellow", "laundry", "holding", "offside", "offsides",
  "interference", "roughing", "penalty", "yes", "oh", "wow", "boy", "man", "folks", "ladies", "gentlemen", "welcome", "thanks", "thank",
]);

/** A position a jersey number sits beside: "tailback 22", "22 the running back", "the receiver 22". */
const POSITION = "(?:quarterback|qb|running back|runningback|tail ?back|half ?back|full ?back|back|wide receiver|wideout|receiver|tight end|lineman|linebacker|backer|corner ?back|corner|safety|kicker|punter|returner|nickel|guard|center|defender|rusher|edge|nose|slot|flanker|end)";
const POSITION_AFTER = new RegExp(`^(?:the |their |his |a )?${POSITION}\\b`);
const POSITION_BEFORE = new RegExp(`${POSITION}$`);

/** "number 22", "numero 22", "jersey 22". */
const JERSEY_CUE_WORDS = new Set(["number", "numero", "jersey", "no"]);

// =============================================================================

export interface NameHit {
  playerId: string;
  score: number;
  /** Token indexes, inclusive. */
  span: [number, number];
  viaJersey: boolean;
  how: "exact" | "alias" | "first_last" | "spelling" | "sound" | "jersey" | "first";
}

interface IndexedPlayer {
  playerId: string;
  side: "home" | "away";
  jersey: string | null;
  /** Surname tokens, letters only, as said: the whole and each half. */
  tokens: string[];
  squeezed: string[];
  aliases: string[];
  first: string | null;
  codes: string[];
}

export interface PhoneticIndex {
  players: IndexedPlayer[];
  byToken: Map<string, IndexedPlayer[]>;
  byAlias: Map<string, IndexedPlayer[]>;
  byFirst: Map<string, IndexedPlayer[]>;
  byCode: Map<string, IndexedPlayer[]>;
  /** Every distinct code, grouped by its first letter, for the edit-distance pass. */
  codesByOnset: Map<string, string[]>;
  byJersey: Map<string, IndexedPlayer[]>;
  /** A word that is some player's exact surname token or alias: never a near miss of anyone else's. */
  exactWords: Set<string>;
  /** The near misses of each word seen, so the edit-distance passes run once per word. */
  nearCache: Map<string, Array<{ playerId: string; score: number; how: "spelling" | "sound" }>>;
}

const indexes = new WeakMap<object, PhoneticIndex>();

/** The metaphone codes of a word worth keeping: primary and alternate, at least MIN_CODE long, once. */
export function codesOf(word: string): string[] {
  if (word.length === 0) return [];
  const [primary, alternate] = doubleMetaphone(word);
  return [...new Set([primary, alternate])].filter((code) => code.length >= MIN_CODE);
}

function bareJersey(jersey: string | null): string | null {
  const text = (jersey ?? "").trim().replace(/^#/, "").replace(/^0+(?=\d)/, "");
  return text.length > 0 ? text : null;
}

/** The index for a roster, built once and remembered by the roster object. */
export function buildNameIndex(roster: readonly StatsRosterPlayer[]): PhoneticIndex {
  const known = indexes.get(roster);
  if (known) return known;
  const players: IndexedPlayer[] = roster.map((player) => {
    const tokens = surnameTokens(player.last);
    const codes = [...new Set(tokens.flatMap(codesOf))];
    return {
      playerId: player.playerId,
      side: player.side,
      jersey: bareJersey(player.jersey),
      tokens,
      squeezed: tokens.map(squeeze),
      aliases: (player.aliases ?? []).map(letters).filter((form) => form.length >= 3),
      first: player.first ? letters(player.first.split(/\s+/)[0] ?? "") || null : null,
      codes,
    };
  });
  const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  const index: PhoneticIndex = { players, byToken: new Map(), byAlias: new Map(), byFirst: new Map(), byCode: new Map(), codesByOnset: new Map(), byJersey: new Map(), exactWords: new Set(), nearCache: new Map() };
  for (const player of players) {
    for (const token of player.tokens) {
      add(index.byToken, token, player);
      index.exactWords.add(token);
    }
    for (const alias of player.aliases) {
      add(index.byAlias, alias, player);
      index.exactWords.add(alias);
    }
    if (player.first) add(index.byFirst, player.first, player);
    for (const code of player.codes) add(index.byCode, code, player);
    if (player.jersey) add(index.byJersey, player.jersey, player);
  }
  for (const code of index.byCode.keys()) add(index.codesByOnset, code[0], code);
  indexes.set(roster, index);
  return index;
}

/**
 * The players a line names, best first, each player once per span. `words`
 * are the line's tokens (lib/livestats/parse/tokens.ts). Only the words that
 * are letters are matched to names; digits go through the jersey cues.
 */
export function nameHits(words: readonly string[], index: PhoneticIndex, stop?: ReadonlySet<string>): NameHit[] {
  const hits: NameHit[] = [];
  const seen = new Set<string>();
  const push = (hit: NameHit) => {
    const key = `${hit.playerId}|${hit.span[0]}`;
    const held = hits.findIndex((each) => `${each.playerId}|${each.span[0]}` === key);
    if (held === -1) {
      hits.push(hit);
      seen.add(key);
    } else if (hits[held].score < hit.score) hits[held] = hit;
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const text = lettersOf(word);

    // A jersey number with a cue beside it.
    if (/^\d{1,2}$/.test(word)) {
      const before = words[i - 1];
      const after = words[i + 1];
      const after2 = words[i + 2];
      const players = index.byJersey.get(word.replace(/^0+(?=\d)/, "")) ?? [];
      if (players.length > 0) {
        if (before !== undefined && JERSEY_CUE_WORDS.has(before)) for (const player of players) push({ playerId: player.playerId, score: SCORE_JERSEY_CUE, span: [i - 1, i], viaJersey: true, how: "jersey" });
        else if (POSITION_BEFORE.test(words.slice(Math.max(0, i - 2), i).join(" ")) || POSITION_AFTER.test([after, after2, words[i + 3]].filter((word) => word !== undefined).join(" "))) {
          for (const player of players) push({ playerId: player.playerId, score: SCORE_JERSEY_POSITION, span: [i, i], viaJersey: true, how: "jersey" });
        }
      }
      continue;
    }
    if (text.length < 3) continue;

    // The surname or a heard-as form, as written.
    const exact = index.byToken.get(text);
    if (exact) {
      // A first name just before makes it certain, and tells two surnames apart: only the named one is pushed then.
      const first = i > 0 ? lettersOf(words[i - 1]) : "";
      const named = first.length > 0 ? exact.filter((player) => player.first === first) : [];
      if (named.length > 0) for (const player of named) push({ playerId: player.playerId, score: SCORE_FIRST_LAST, span: [i - 1, i], viaJersey: false, how: "first_last" });
      else for (const player of exact) push({ playerId: player.playerId, score: SCORE_EXACT, span: [i, i], viaJersey: false, how: "exact" });
    }
    const alias = index.byAlias.get(text);
    if (alias) for (const player of alias) push({ playerId: player.playerId, score: SCORE_EXACT, span: [i, i], viaJersey: false, how: "alias" });
    // A two-word surname split in the transcript: "van tree", "de la cruz".
    if (i + 1 < words.length) {
      const joined = text + lettersOf(words[i + 1]);
      const pair = index.byToken.get(joined);
      if (pair) for (const player of pair) push({ playerId: player.playerId, score: SCORE_EXACT, span: [i, i + 1], viaJersey: false, how: "exact" });
    }
    if (exact || alias) continue;

    // A first name: 0.5 alone; certain when the next word sounds like the surname.
    const firsts = index.byFirst.get(text);
    if (firsts) {
      for (const player of firsts) {
        const next = i + 1 < words.length ? lettersOf(words[i + 1]) : "";
        const nextNames = next.length >= 3 && (player.tokens.includes(next) || player.aliases.includes(next) || soundScore(next, player, index) > 0 || spellingScore(next, player, index) > 0);
        if (nextNames) push({ playerId: player.playerId, score: SCORE_FIRST_LAST, span: [i, i + 1], viaJersey: false, how: "first_last" });
        else push({ playerId: player.playerId, score: SCORE_FIRST_ALONE, span: [i, i], viaJersey: false, how: "first" });
      }
    }
    // A word that is exactly someone's name is nobody else's near miss, and an ordinary word is nobody's.
    if (index.exactWords.has(text) || NOT_NAMES.has(text) || stop?.has(text)) continue;

    for (const near of nearMisses(text, index)) push({ playerId: near.playerId, score: near.score, span: [i, i], viaJersey: false, how: near.how });
  }
  return hits.sort((a, b) => b.score - a.score || a.span[0] - b.span[0]);
}

interface NearMiss {
  playerId: string;
  score: number;
  how: "spelling" | "sound";
}

/** Most words a line can add to the cache before it starts over: a game's vocabulary is a few thousand words. */
const NEAR_CACHE_SIZE = 8_000;

/**
 * The near misses of one word, remembered per index: a close spelling first,
 * else the sound-alikes. The same words come up all game ("fennimore",
 * "quillon", "throws"), so the edit-distance passes run once per word.
 */
function nearMisses(text: string, index: PhoneticIndex): NearMiss[] {
  const cached = index.nearCache.get(text);
  if (cached) return cached;
  let found: NearMiss[] = spellingHits(text, index).map((player) => ({ playerId: player.playerId, score: SCORE_SPELLING, how: "spelling" as const }));
  if (found.length === 0) found = soundHits(text, index).map(({ player, score }) => ({ playerId: player.playerId, score, how: "sound" as const }));
  if (index.nearCache.size >= NEAR_CACHE_SIZE) index.nearCache.clear();
  index.nearCache.set(text, found);
  return found;
}

/** The players whose surname is within closeLimit edits of the word, the nearest only. */
function spellingHits(text: string, index: PhoneticIndex): IndexedPlayer[] {
  const said = squeeze(text);
  let best = Number.POSITIVE_INFINITY;
  let players: IndexedPlayer[] = [];
  for (const player of index.players) {
    const off = spellingDistance(said, player);
    if (off === null) continue;
    if (off < best) {
      best = off;
      players = [player];
    } else if (off === best) players.push(player);
  }
  return players;
}

function spellingDistance(said: string, player: IndexedPlayer): number | null {
  let best: number | null = null;
  for (let t = 0; t < player.tokens.length; t++) {
    const token = player.squeezed[t];
    const limit = closeLimit(player.tokens[t].length);
    if (limit === 0) continue;
    if (Math.abs(token.length - said.length) > limit) continue;
    // A slip keeps the first letter far more often than not; "fafitaga" starts like "fifita".
    if (token[0] !== said[0]) continue;
    const off = editDistance(said, token, limit);
    if (off <= limit && (best === null || off < best)) best = off;
  }
  return best;
}

function spellingScore(text: string, player: IndexedPlayer, index: PhoneticIndex): number {
  if (index.exactWords.has(text)) return 0;
  return spellingDistance(squeeze(text), player) === null ? 0 : SCORE_SPELLING;
}

/** The players whose surname sounds like the word, nearest first; the nearest only. */
function soundHits(text: string, index: PhoneticIndex): Array<{ player: IndexedPlayer; score: number }> {
  const codes = codesOf(text);
  if (codes.length === 0) return [];
  let best = Number.POSITIVE_INFINITY;
  const found = new Map<string, { player: IndexedPlayer; score: number }>();
  for (const code of codes) {
    const exact = index.byCode.get(code);
    if (exact) {
      if (0 < best) {
        best = 0;
        found.clear();
      }
      for (const player of exact) found.set(player.playerId, { player, score: SCORE_SOUND_EXACT });
    }
    if (best === 0) continue;
    for (const other of index.codesByOnset.get(code[0]) ?? []) {
      const longer = Math.max(code.length, other.length);
      const shorter = Math.min(code.length, other.length);
      const allowed = longer >= TWO_EDIT_MIN_CODE && shorter >= TWO_EDIT_MIN_SHORT ? 2 : longer > MIN_CODE ? 1 : 0;
      if (allowed === 0) continue;
      const off = editDistance(code, other, allowed);
      if (off > allowed || off === 0) continue;
      if (off < best) {
        best = off;
        found.clear();
      }
      if (off === best) for (const player of index.byCode.get(other) ?? []) found.set(player.playerId, { player, score: off === 1 ? SCORE_SOUND_ONE_EDIT : SCORE_SOUND_TWO_EDITS });
    }
  }
  return [...found.values()];
}

function soundScore(text: string, player: IndexedPlayer, index: PhoneticIndex): number {
  return soundHits(text, index).find((hit) => hit.player.playerId === player.playerId)?.score ?? 0;
}

/** The best hit per player in a list of hits. */
export function bestHits(hits: readonly NameHit[]): NameHit[] {
  const best = new Map<string, NameHit>();
  for (const hit of hits) {
    const held = best.get(hit.playerId);
    if (!held || held.score < hit.score) best.set(hit.playerId, hit);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.span[0] - b.span[0]);
}
