import type { CardView } from "@/lib/cards/factLayout";
import { keywordHits, matchWord, scoringOn, SECONDS_AFTER, WORDS_BEFORE } from "@/lib/cards/scoringKeywords";
import type { DeepgramResults, DeepgramWord } from "@/lib/deepgram/config";
import type { LogRow } from "@/lib/matching/matchLog";
import { buildJerseyIndex } from "@/lib/rosters/buildWatchlist";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// Which card leads with its scoring numbers (Nov 15). The engine has already
// decided which cards are up and who they are; this only listens beside it,
// for a scoring word near a name it spotted, and says what each player's card
// leads with: "scoring" or "facts". It never touches the engine or its
// answer, so it cannot change which card goes up, when, or for whom
// (test/scoringCue.test.ts replays the same calls with it on and off).
//
// A scoring word counts for a player when it is within WORDS_BEFORE words
// before the name (or before the cue of a cued number: "goal scored by number
// 9 Smith"), or starts within SECONDS_AFTER seconds after the name, in the
// same result or a later one ("Smith shoots, scores!"). Interim results count,
// so it feels instant; each result says again what its utterance holds, so
// when the final no longer has the word, the card goes back to its facts. A
// word that fits two names ("goal Smith, assisted by Jones") counts for both.
//
// A card in the scoring view stays there until its player is spotted again
// (a card going up, not a repeat the engine held back) with no scoring word.
// S turns the newest card either way, until its player is next spotted.
//
// Synchronous, no storage, no network: it runs in the hot path, beside
// engine.process. The log and analytics are written by the live screen, after
// paint, from what heard() returns.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A later result's word is the name's own when it starts this close to where the name was heard, in seconds. */
const SAME_WORD_SECONDS = 0.4;

/** Names kept listening for, per connection, after their window has passed (for a final that arrives late). */
const KEEP_SECONDS = 30;

/** The most names kept at once. */
const MAX_ANCHORS = 60;

// =============================================================================

/** A scoring word found for a player, as the browser log keeps it. */
export interface ScoringHit {
  /** The listed phrase: "scores", "assisted by". */
  word: string;
  where: "before" | "after";
}

/** Something the live screen writes to the log (and, for a new scoring view, analytics) after paint. */
export interface ScoringEvent {
  player: WatchlistPlayer;
  word: string;
  where: "before" | "after" | "key";
  /** A final took back a word an interim had: the hit no longer counts. */
  reverted: boolean;
}

/** A player whose card now leads with something else. */
export interface ViewChange {
  player: WatchlistPlayer;
  view: CardView;
}

export interface ScoringOutcome {
  /** Players whose view changed with this result. Empty with the feature off. */
  changes: ViewChange[];
  events: ScoringEvent[];
}

const NOTHING: ScoringOutcome = { changes: [], events: [] };

/** One name the engine spotted: who it put up, and where in the audio the name was. */
interface Anchor {
  players: WatchlistPlayer[];
  /** "match": a card went up (or was narrowed). "repeat": the engine held it back as one already up. */
  kind: "match" | "repeat";
  connectionId: number;
  /** The result's start: the utterance the name was heard in. */
  utterance: number;
  /** The name's words as matchWord writes them, and where they were. */
  tokens: string[];
  /** Where the words before it are counted from: the cue word's start when a number had one. */
  cueStart: number;
  start: number;
  end: number;
  /** The scoring words for it, by the utterance they were heard in. Each result of an utterance replaces its entry. */
  hits: Map<number, ScoringHit[]>;
}

export class ScoringCue {
  readonly on: boolean;
  private readonly sport: string | null;
  private readonly slots: Map<string, WatchlistPlayer>;
  private anchors: Anchor[] = [];
  /** Each player's newest anchor that put a card up: what the player's view is worked out from. */
  private readonly latest = new Map<WatchlistPlayer, Anchor>();
  /** S, since the player was last spotted. */
  private readonly manual = new Map<WatchlistPlayer, CardView>();
  private readonly current = new Map<WatchlistPlayer, CardView>();

  constructor(sport: string | null, entries: readonly WatchlistEntry[]) {
    this.sport = sport;
    this.on = scoringOn(sport);
    const index = buildJerseyIndex([...entries]);
    this.slots = new Map([...index.byKey].map(([key, slot]) => [key, slot.player]));
  }

  /** What each player's card leads with now. A player missing from it leads with their facts. */
  views(): ReadonlyMap<WatchlistPlayer, CardView> {
    return this.current;
  }

  viewOf(player: WatchlistPlayer): CardView {
    return this.current.get(player) ?? "facts";
  }

  /**
   * HOT PATH. One Deepgram result and the engine's rows for it. Records the
   * names the engine just spotted, re-reads this result's utterance for every
   * name still listening, and says whose view changed.
   */
  heard(results: DeepgramResults, connectionId: number, rows: readonly LogRow[]): ScoringOutcome {
    if (!this.on) return NOTHING;
    const words = results.channel.alternatives[0]?.words ?? [];
    const clean = words.map((word) => matchWord(word.word));
    const events: ScoringEvent[] = [];

    // The names the engine spotted in this result, in the order it gives them.
    const used = new Set<number>();
    const fresh: Anchor[] = [];
    for (const row of rows) {
      if (row.type !== "match" && row.type !== "repeat") continue;
      const players = (row.slots ?? []).map((key) => this.slots.get(key)).filter((player): player is WatchlistPlayer => player !== undefined);
      if (players.length === 0) continue;
      const span = locate(clean, row, used);
      if (!span) continue;
      const anchor: Anchor = {
        players,
        kind: row.type,
        connectionId,
        utterance: results.start,
        tokens: clean.slice(span.first, span.last + 1),
        cueStart: words[span.cue]!.start,
        start: words[span.first]!.start,
        end: words[span.last]!.end,
        hits: new Map(),
      };
      fresh.push(anchor);
      this.anchors.push(anchor);
      if (row.type === "match") {
        for (const player of players) {
          this.latest.set(player, anchor);
          this.manual.delete(player);
        }
      }
    }

    // Every name still listening on this connection reads this result again.
    const keywords = keywordHits(words.map((word) => word.word), this.sport);
    const touched = new Set<WatchlistPlayer>();
    for (const anchor of this.anchors) {
      if (anchor.connectionId !== connectionId) continue;
      const isNew = fresh.includes(anchor);
      if (!isNew && results.start > anchor.end + SECONDS_AFTER) continue;
      const found = this.hitsFor(anchor, words, clean, keywords, results.start);
      const before = anchor.hits.get(results.start) ?? [];
      anchor.hits.set(results.start, found);
      for (const hit of found) {
        if (!before.some((old) => old.word === hit.word && old.where === hit.where)) {
          for (const player of anchor.players) events.push({ player, word: hit.word, where: hit.where, reverted: false });
        }
      }
      if (results.is_final) {
        for (const old of before) {
          if (!found.some((hit) => hit.word === old.word && hit.where === old.where)) {
            for (const player of anchor.players) events.push({ player, word: old.word, where: old.where, reverted: true });
          }
        }
      }
      if (isNew || found.length > 0 || before.length > 0) for (const player of anchor.players) touched.add(player);
    }

    this.prune(connectionId, results.start);
    return { changes: this.settle(touched), events };
  }

  /** S on the newest card: facts to scoring or back, until the player is next spotted. Null with the feature off. */
  toggle(player: WatchlistPlayer): ViewChange | null {
    if (!this.on) return null;
    const view: CardView = this.viewOf(player) === "scoring" ? "facts" : "scoring";
    this.manual.set(player, view);
    this.current.set(player, view);
    return { player, view };
  }

  /** The scoring words in this result for one name: before it, in the same utterance, and after it, by time. */
  private hitsFor(anchor: Anchor, words: readonly DeepgramWord[], clean: readonly string[], keywords: ReturnType<typeof keywordHits>, utterance: number): ScoringHit[] {
    const found: ScoringHit[] = [];
    if (anchor.utterance === utterance) {
      // The name's own words in this result: where they were heard, give or take.
      const first = clean.findIndex(
        (word, index) => word === anchor.tokens[0] && Math.abs(words[index]!.start - anchor.start) <= SAME_WORD_SECONDS,
      );
      if (first >= 0) {
        const cue = words.findIndex((word) => Math.abs(word.start - anchor.cueStart) <= 0.01);
        const from = cue >= 0 && cue <= first ? cue : first;
        for (const hit of keywords) {
          if (hit.last < from && hit.last >= from - WORDS_BEFORE) found.push({ word: hit.phrase, where: "before" });
        }
      }
    }
    for (const hit of keywords) {
      const start = words[hit.first]!.start;
      if (start > anchor.end && start <= anchor.end + SECONDS_AFTER) found.push({ word: hit.phrase, where: "after" });
    }
    return found;
  }

  /** Each touched player's view, from their newest card and the repeats since; the ones that changed. */
  private settle(players: ReadonlySet<WatchlistPlayer>): ViewChange[] {
    const changes: ViewChange[] = [];
    for (const player of players) {
      const newest = this.latest.get(player);
      let view: CardView = "facts";
      const manual = this.manual.get(player);
      if (manual) view = manual;
      else if (newest) {
        const at = this.anchors.indexOf(newest);
        const since = at < 0 ? [newest] : this.anchors.slice(at).filter((anchor) => anchor.players.includes(player));
        if (since.some((anchor) => [...anchor.hits.values()].some((hits) => hits.length > 0))) view = "scoring";
      }
      if (view !== this.viewOf(player)) changes.push({ player, view });
      if (view === "facts") this.current.delete(player);
      else this.current.set(player, view);
    }
    return changes;
  }

  /** Names whose window and late final have long passed are let go; each player's newest card is kept. */
  private prune(connectionId: number, now: number) {
    const keep = new Set(this.latest.values());
    this.anchors = this.anchors.filter(
      (anchor) => keep.has(anchor) || (anchor.connectionId === connectionId && now - anchor.end <= KEEP_SECONDS),
    );
    if (this.anchors.length > MAX_ANCHORS) this.anchors = this.anchors.slice(-MAX_ANCHORS);
  }
}

/**
 * Where a row's name is in this result's words: its first and last word, and
 * the cue word just before a number ("number 9", "Lions 9"), or null. A word
 * already given to an earlier row in this result is skipped, so a name said
 * twice gets two places.
 */
function locate(clean: readonly string[], row: LogRow, used: Set<number>): { first: number; last: number; cue: number } | null {
  const tokens = row.word.split(/\s+/).map(matchWord).filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  const at: number[] = [];
  let from = 0;
  for (const token of tokens) {
    let index = -1;
    for (let next = from; next < clean.length; next++) {
      if (clean[next] === token && !used.has(next)) {
        index = next;
        break;
      }
    }
    // A number said before its surname ("9 smith") sits before the surname in the words.
    if (index < 0) index = clean.findIndex((word, next) => word === token && !used.has(next));
    if (index < 0) return null;
    at.push(index);
    from = index + 1;
  }
  for (const index of at) used.add(index);
  const first = Math.min(...at);
  const last = Math.max(...at);
  const cueWord = row.cueWord ? matchWord(row.cueWord) : "";
  let cue = first;
  for (let back = first - 1; back >= Math.max(0, first - 2); back--) {
    if (cueWord && clean[back] === cueWord) cue = back;
  }
  return { first, last, cue };
}
