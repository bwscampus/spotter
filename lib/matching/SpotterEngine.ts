import type { DeepgramResults } from "@/lib/deepgram/config";
import type { LogRow } from "@/lib/matching/matchLog";
import { buildJerseyIndex, jerseyKey, type JerseyIndex, type RosterSlot } from "@/lib/rosters/buildWatchlist";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";
import {
  compileWatchlist,
  REPEAT_SUPPRESSION_MS,
  scanWords,
  type Candidate,
  type CompiledEntry,
} from "./matcher";
import {
  normalizeNumbers,
  parseJerseyMentions,
  type JerseyMention,
  type NumberContext,
  type NumberCue,
} from "./numbers";
import { afterDeterminer, DETERMINER_VETO } from "./determiners";
import { compileJerseySounds, jerseyFromSound, type CompiledJersey } from "./jerseySound";
import { NUMBER_CUE_SCORES, NUMBER_THRESHOLD, resolveJersey } from "./resolveJersey";
import { FirstNames, preferStars } from "./stars";

/**
 * Most players on screen at once: the most recently matched, newest first.
 *
 * Three, not four. The newest card takes half the stage and the two behind it
 * take a quarter each, which is the smallest a card can be and still be read
 * from arm's length in a press box. A fourth card made all three older ones
 * too small to be worth showing.
 */
export const MAX_NAMES_ON_SCREEN = 3;

// Interim and final results can shift a word's timing a little. Two sightings
// of a name this close together in the audio are the same utterance.
const SAME_UTTERANCE_SECONDS = 0.4;
// How long occurrences are remembered for repeat suppression and corrections.
const MEMORY_MS = 60_000;
const PRUNE_EVERY_MS = 5000;
// Kept regardless of age: the latest match of this many recent players, so a
// correction can bring back a player it pushed off screen, and the newest
// matches for the recent-matches list.
const KEEP_PLAYERS = MAX_NAMES_ON_SCREEN * 2;
const KEEP_RECENT_MATCHES = 10;

/** Separates players when one trigger puts up more than one card. */
const LABEL_SEPARATOR = " · ";

/** Shown for a player the roster gave no jersey. */
const NO_JERSEY = "#?";

interface Occurrence {
  /** What this is a sighting of: a surname entry, or "#23". Two sightings with one key are one utterance. */
  key: string;
  /** What the log and the recent list call it. */
  label: string;
  word: string;
  score: number;
  minScore: number;
  confidence: number;
  connectionId: number;
  start: number;
  detectedAt: number;
  wallTime: number;
  status: "fired" | "repeat" | "retracted";
  /** Seen only in interim results so far; the segment's final can still retract it. */
  provisional: boolean;
  /** Which players are on screen because of this. Roster slot keys. */
  players: string[];
  /**
   * Everyone it could have been, when fewer went up (stars.ts): a later number
   * or first name can still narrow to any of them, not just to who is showing.
   */
  pool?: string[];
  /** Set when a number was involved. */
  cue: NumberCue | null;
  cueWord: string | null;
  /** The number was heard as words rather than read as digits. */
  sounded: boolean;
}

export interface RecentMatch {
  name: string;
  word: string;
  score: number;
  wallTime: number;
}

/**
 * The shape of a correction, for the usage log.
 *
 * PRIVACY: deliberately says nothing about who. No surname, no jersey, no words
 * that scored. Those stay in the browser's match log. What is here is what a
 * threshold is tuned on: which kind of cue fired, how well it scored, and how
 * much it put on screen.
 */
export interface WrongShape {
  /** Whether a name or a number put the card up. */
  kind: "name" | "number";
  cue: NumberCue | null;
  score: number;
  threshold: number;
  confidence: number;
  /** How many cards that one trigger put up. More cards is more ambiguity. */
  cards: number;
  /** Digits in the jersey, for a number. Null for a name. */
  digits: number | null;
  /** True when the number was heard as words rather than read as digits. */
  sound: boolean;
  /** Matches fired before this one, so corrections can be read as a rate. */
  matchesBefore: number;
}

export interface SpotOutcome {
  /** Present when the cards on screen must be (re)written. Newest first; empty means none. */
  display?: { players: WatchlistPlayer[] };
  rows: LogRow[];
}

/** What taking a card down produced. Nothing at all when there was no card to take down. */
export interface WrongOutcome extends SpotOutcome {
  wrong?: WrongShape;
  /**
   * What came off, as the screen named it. Shown to the announcer and nowhere
   * else: it says who, so it never reaches track() or anything that leaves the
   * browser.
   */
  removed?: string;
}

/** One candidate to put on screen, from a surname, a number, or both together. */
interface Spot {
  key: string;
  label: string;
  word: string;
  score: number;
  minScore: number;
  confidence: number;
  start: number;
  players: string[];
  /** Everyone it could have been, when fewer went up. See Occurrence. */
  pool?: string[];
  cue: NumberCue | null;
  cueWord: string | null;
  sounded: boolean;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Everything a row needs, which a spot, an occurrence and a near miss all have. */
interface Loggable {
  label: string;
  word: string;
  score: number;
  minScore: number;
  confidence: number;
  cue?: NumberCue | null;
  cueWord?: string | null;
  /** Roster slot keys, on the rows that put someone on screen. */
  players?: string[];
}

function toRow(type: LogRow["type"], spot: Loggable, source: LogRow["source"], wallTime: number): LogRow {
  return {
    at: new Date(wallTime).toISOString(),
    type,
    name: spot.label,
    word: spot.word,
    score: round3(spot.score),
    threshold: spot.minScore,
    confidence: round3(spot.confidence),
    source,
    latencyMs: null,
    domMs: null,
    cue: spot.cue ?? null,
    cueWord: spot.cueWord ?? null,
    // Who this row put up, by roster slot. Cheap here and impossible later:
    // the label alone cannot be turned back into players without parsing it.
    slots: spot.players,
  };
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/** The same players, in any order. */
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key) => b.includes(key));
}

/** Every key in `inner` is in `outer`, and `outer` has something `inner` does not. */
function isNarrowerThan(inner: string[], outer: string[]): boolean {
  return inner.length < outer.length && inner.every((key) => outer.includes(key));
}

/**
 * Turns Deepgram results into display changes and log rows. Fully synchronous:
 * it runs inside the socket message handler, between result arrival and the
 * DOM write.
 *
 * Two ways in. A surname scores against the watchlist, as it always has. A
 * number only counts when something next to it says it is a jersey, and a
 * number in the same phrase as a surname narrows that surname to one player:
 * "Williams, number 23" shows the Williams wearing 23 rather than both of them.
 *
 * Interim results fire immediately. When the final for that stretch of audio
 * arrives, interim matches it does not contain are retracted and the screen
 * goes back to the players it showed before.
 */
export class SpotterEngine {
  private readonly entries: CompiledEntry[];
  private readonly labels = new Map<string, string>();
  private readonly index: JerseyIndex;
  private readonly sounds: CompiledJersey[];
  private readonly context: NumberContext;
  /** Entries whose players are spotted "exact only": a near sound of the surname never puts them up. */
  private readonly exactOnly = new Set<string>();
  /** First names of players who share a surname, so "Jeremiah Smith" is one Smith (stars.ts). */
  private readonly firstNames: FirstNames;
  private occurrences: Occurrence[] = [];
  private shown: string[] = [];
  private lastPruneAt = 0;

  constructor(watchlist: WatchlistEntry[], context: NumberContext = { sport: null, teamCues: [] }) {
    this.entries = compileWatchlist(watchlist);
    this.index = buildJerseyIndex(watchlist);
    this.firstNames = new FirstNames(this.index);
    // Tonight's numbers, compiled twice: as digits, so an interim only makes the
    // announcer wait when the number in hand could still grow into a different
    // one, and as sounds, for the times Deepgram never made a number at all.
    this.sounds = compileJerseySounds(this.index.byJersey.keys());
    this.context = {
      ...context,
      jerseys: new Set(this.index.byJersey.keys()),
      hearJersey: (text) => jerseyFromSound(text, this.sounds),
    };
    for (const entry of watchlist) {
      this.labels.set(entry.name, entry.label || entry.name);
      if (entry.exactOnly) this.exactOnly.add(entry.name);
    }
  }

  process(
    results: DeepgramResults,
    connectionId: number,
    now: number = performance.now(),
    wallTime: number = Date.now(),
  ): SpotOutcome {
    const rows: LogRow[] = [];
    const alternative = results.channel.alternatives[0];
    if (!alternative) return { rows };

    const isFinal = results.is_final;
    const source = isFinal ? "final" : "interim";
    const scanned = scanWords(alternative.words, this.entries);
    const nearMisses = scanned.nearMisses;
    // Exact-only spotting (docs/V3_DEFINITION.md 7.3): a surname that scored
    // below a perfect 1 is a near sound of the name, and for these players that
    // is not enough. Dropped here, after scoring and before anything can use it,
    // so a dropped surname is not a cue for the number beside it either. Synchronous
    // and a Set lookup; matcher.ts is untouched.
    const exactOnlyDrops: Candidate[] = [];
    const exactMatches =
      this.exactOnly.size === 0
        ? scanned.matches
        : scanned.matches.filter((match) => {
            if (match.score >= 1 || !this.exactOnly.has(match.name)) return true;
            exactOnlyDrops.push(match);
            return false;
          });
    // A surname right after "the", "his", "a" and the rest is not a name
    // (determiners.ts). Dropped here too, so it is not a cue for a number.
    const determinerDrops: Candidate[] = [];
    const matches = exactMatches.filter((match) => {
      if (!afterDeterminer(alternative.words, match.firstIndex)) return true;
      determinerDrops.push(match);
      return false;
    });

    // A first name right before a shared surname (stars.ts). Before the number
    // parse, so a first name that is also someone's surname is not a cue.
    const { kept: surnames, named } = this.withFirstNames(matches, alternative.words);

    // Numbers. The surname matches are passed in, because a number next to a
    // name means that player rather than everyone wearing the number.
    const tokens = normalizeNumbers(alternative.words);
    const scan = parseJerseyMentions(
      tokens,
      this.context,
      surnames.map((match) => ({ name: match.name, firstIndex: match.firstIndex, lastIndex: match.lastIndex })),
      !isFinal,
    );

    const { spots, conflicts, offRoster } = this.spotsFor(surnames, scan.mentions, named);
    let fired = false;
    let narrowed = false;
    let retractedFired = false;

    if (isFinal) {
      const from = results.start - SAME_UTTERANCE_SECONDS;
      const to = results.start + results.duration + SAME_UTTERANCE_SECONDS;
      for (const occurrence of this.occurrences) {
        if (!occurrence.provisional || occurrence.connectionId !== connectionId) continue;
        if (occurrence.start < from || occurrence.start > to) continue;
        if (spots.some((spot) => this.isSameUtterance(occurrence, spot, connectionId))) {
          occurrence.provisional = false;
          continue;
        }
        const wasFired = occurrence.status === "fired";
        const promoted = this.retract(occurrence);
        rows.push(toRow("retracted", occurrence, "final", wallTime));
        if (promoted) rows.push(toRow("match", promoted, "final", wallTime));
        if (wasFired) retractedFired = true;
      }
    }

    for (const spot of spots) {
      const existing = this.occurrences.find(
        (o) => o.status !== "retracted" && this.isSameUtterance(o, spot, connectionId),
      );
      if (existing) {
        // Same utterance seen again in a later interim, or confirmed by the
        // final. A number heard this time round narrows what it already shows.
        if (isFinal) existing.provisional = false;
        if (this.narrow(existing, spot)) {
          narrowed = true;
          rows.push(toRow("match", spot, source, wallTime));
        }
        continue;
      }

      // A number that narrows a card already on screen updates it in place
      // rather than triggering again.
      const wider = this.latest(
        (o) =>
          o.status === "fired" &&
          now - o.detectedAt < REPEAT_SUPPRESSION_MS &&
          isNarrowerThan(spot.players, o.pool ?? o.players) &&
          !sameSet(spot.players, o.players),
      );
      if (wider) {
        this.narrow(wider, spot);
        narrowed = true;
        this.remember(spot, connectionId, now, wallTime, isFinal, "repeat");
        rows.push(toRow("match", spot, source, wallTime));
        continue;
      }

      const repeat = spot.players.every((key) => {
        const previous = this.latest((o) => o.status !== "retracted" && o.players.includes(key));
        return previous !== undefined && now - previous.detectedAt < REPEAT_SUPPRESSION_MS;
      });
      this.remember(spot, connectionId, now, wallTime, isFinal, repeat ? "repeat" : "fired");
      rows.push(toRow(repeat ? "repeat" : "match", spot, source, wallTime));
      if (!repeat) fired = true;
    }

    // Near misses only from finals: interims would log the same word over and over.
    if (isFinal) {
      for (const miss of nearMisses) rows.push(toRow("near_miss", { ...miss, label: miss.name }, source, wallTime));
      for (const dropped of exactOnlyDrops) {
        rows.push({
          ...toRow("near_miss", { ...dropped, label: this.labels.get(dropped.name) ?? dropped.name }, source, wallTime),
          reason: "exact_only",
        });
      }
      for (const dropped of determinerDrops) {
        rows.push({
          ...toRow("near_miss", { ...dropped, label: this.labels.get(dropped.name) ?? dropped.name }, source, wallTime),
          reason: DETERMINER_VETO,
        });
      }
      for (const conflict of conflicts) rows.push(conflict(wallTime));
      for (const miss of offRoster) rows.push(miss(wallTime));
      for (const veto of scan.vetoed) {
        // A number nobody is wearing and nobody cued is just play-by-play. Only
        // numbers that could have been a player are worth a row.
        const onRoster = this.index.byJersey.has(veto.number);
        if (!onRoster && veto.cueWord === null) continue;
        rows.push({
          at: new Date(wallTime).toISOString(),
          type: "near_miss",
          name: veto.number,
          word: veto.number,
          score: 0,
          threshold: NUMBER_THRESHOLD,
          confidence: round3(veto.confidence),
          source,
          latencyMs: null,
          domMs: null,
          cue: null,
          cueWord: veto.cueWord,
          reason: veto.reason,
        });
      }
    }

    this.prune(now);

    if (fired || narrowed || retractedFired) {
      const keys = this.keysOnScreen();
      if (fired || narrowed || !sameKeys(keys, this.shown)) {
        this.shown = keys;
        return { display: { players: keys.map((key) => this.index.byKey.get(key)!.player) }, rows };
      }
    }
    return { rows };
  }

  /**
   * The announcer says the card on screen is wrong.
   *
   * Takes it down, puts back whatever it pushed off, and writes the row that
   * says so. That row is the only honest record of a false match: everything
   * else in the log is Spotter marking its own homework, and a threshold moved
   * without it is a guess.
   */
  markNewestWrong(wallTime: number = Date.now()): WrongOutcome {
    return this.markWrong(this.latest((o) => o.status === "fired"), wallTime);
  }

  /**
   * The same, for the card in a given slot: 0 is the newest, counting down the
   * screen. A number key is how the announcer says which one is wrong when the
   * bad card is not the one that just came up.
   *
   * One trigger can put two cards up, and taking either of them down takes down
   * the trigger: they were one mistake, not two.
   */
  markSlotWrong(slot: number, wallTime: number = Date.now()): WrongOutcome {
    const key = this.keysOnScreen()[slot];
    if (key === undefined) return { rows: [] };
    return this.markWrong(
      this.latest((o) => o.status === "fired" && o.players.includes(key)),
      wallTime,
    );
  }

  private markWrong(occurrence: Occurrence | undefined, wallTime: number): WrongOutcome {
    if (!occurrence) return { rows: [] };

    const wrong = this.shapeOf(occurrence);
    const removed = occurrence.label;
    const promoted = this.retract(occurrence);
    const rows: LogRow[] = [{ ...toRow("wrong", occurrence, "final", wallTime), reason: "announcer_said_wrong" }];
    if (promoted) rows.push(toRow("match", promoted, "final", wallTime));

    const keys = this.keysOnScreen();
    this.shown = keys;
    return { display: { players: keys.map((key) => this.index.byKey.get(key)!.player) }, rows, wrong, removed };
  }

  /** Describes a correction for the usage log, with nothing in it that says who. */
  private shapeOf(occurrence: Occurrence): WrongShape {
    const jerseys = occurrence.players
      .map((key) => (this.index.byKey.get(key)?.player.jersey ?? "").trim())
      .filter((jersey) => jersey.length > 0);
    return {
      kind: occurrence.cue === null ? "name" : "number",
      cue: occurrence.cue,
      score: occurrence.score,
      threshold: occurrence.minScore,
      confidence: occurrence.confidence,
      cards: occurrence.players.length,
      // The length of the number, never the number.
      digits: occurrence.cue === null ? null : (jerseys[0]?.length ?? null),
      sound: occurrence.sounded,
      matchesBefore: this.occurrences.filter((o) => o.status === "fired" && o !== occurrence).length,
    };
  }

  /** Most recent fired matches, newest first. */
  recentMatches(limit: number): RecentMatch[] {
    const recent: RecentMatch[] = [];
    for (let i = this.occurrences.length - 1; i >= 0 && recent.length < limit; i--) {
      const o = this.occurrences[i];
      if (o.status === "fired") recent.push({ name: o.label, word: o.word, score: o.score, wallTime: o.wallTime });
    }
    return recent;
  }

  /**
   * Pairs up the surnames and the numbers from one result.
   *
   * A number joined to a surname does not make a second card: it decides which
   * of that surname's players the card is. A number that disagrees with the
   * surname beside it loses, and says so in the log.
   */
  private spotsFor(matches: Candidate[], mentions: JerseyMention[], named: ReadonlyMap<Candidate, string[]>) {
    const spots: Spot[] = [];
    const conflicts: Array<(wallTime: number) => LogRow> = [];
    const offRoster: Array<(wallTime: number) => LogRow> = [];
    const used = new Set<JerseyMention>();

    for (const match of matches) {
      const mention = mentions.find((m) => !used.has(m) && m.surname === match.name);
      const players = this.index.byEntry.get(match.name) ?? [];
      const base: Spot = {
        key: match.name,
        label: this.labels.get(match.name) ?? match.name,
        word: match.word,
        score: match.score,
        minScore: match.minScore,
        confidence: match.confidence,
        start: match.start,
        players,
        cue: null,
        cueWord: null,
        sounded: false,
      };

      if (!mention) {
        spots.push(this.chosen(base, named.get(match) ?? null, match.name));
        continue;
      }
      used.add(mention);

      const resolved = resolveJersey(mention, this.index);
      if (resolved.kind === "show") {
        const keys = resolved.slots.map((slot) => slot.key);
        spots.push({
          ...base,
          label: this.labelFor(resolved.slots, match.name),
          word: `${match.word} ${mention.number}`,
          players: keys,
          cue: mention.cue,
          cueWord: mention.cueWord,
          sounded: mention.heard !== undefined,
        });
        continue;
      }

      // The surname wins, and the disagreement is worth a row of its own.
      spots.push(base);
      conflicts.push((wallTime) => ({
        at: new Date(wallTime).toISOString(),
        type: "conflict",
        name: base.label,
        word: `${match.word} ${mention.number}`,
        score: round3(match.score),
        threshold: match.minScore,
        confidence: round3(mention.confidence),
        source: "final",
        latencyMs: null,
        domMs: null,
        cue: mention.cue,
        cueWord: mention.cueWord,
        reason: "surname_disagrees",
      }));
    }

    for (const mention of mentions) {
      if (used.has(mention)) continue;
      const resolved = resolveJersey(mention, this.index);
      if (resolved.kind === "show") {
        // Teammates wearing the same number: the most called (stars.ts). A
        // teen/ty partner is another number, so it is never dropped for this.
        const all = resolved.slots.map((slot) => slot.key);
        const slots = preferStars(resolved.slots, (slot) => jerseyKey(slot.player.jersey) ?? slot.key);
        resolved.slots = slots;
        spots.push({
          ...(slots.length < all.length ? { pool: all } : {}),
          key: `#${mention.number}`,
          label: this.labelFor(resolved.slots, null),
          // A number heard as words logs the words that scored, which is what
          // says why it fired and what to change if it should not have.
          word: mention.heard?.word ?? mention.number,
          score: mention.heard?.score ?? NUMBER_CUE_SCORES[mention.cue],
          minScore: NUMBER_THRESHOLD,
          confidence: mention.confidence,
          start: mention.start,
          players: resolved.slots.map((slot) => slot.key),
          cue: mention.cue,
          cueWord: mention.cueWord,
          sounded: mention.heard !== undefined,
        });
        continue;
      }
      if (resolved.kind === "conflict") continue;
      offRoster.push((wallTime) => ({
        at: new Date(wallTime).toISOString(),
        type: "near_miss",
        name: `#${mention.number}`,
        word: mention.number,
        score: NUMBER_CUE_SCORES[mention.cue],
        threshold: NUMBER_THRESHOLD,
        confidence: round3(mention.confidence),
        source: "final",
        latencyMs: null,
        domMs: null,
        cue: mention.cue,
        cueWord: mention.cueWord,
        reason: resolved.reason,
      }));
    }

    return { spots: spots.sort((a, b) => a.start - b.start), conflicts, offRoster };
  }

  /**
   * Shared surnames with a first name right before them, narrowed to that
   * player. A one-word match on that first name is dropped: "Jordan Smith"
   * said Smith's first name, not the surname of a player called Jordan.
   */
  private withFirstNames(matches: Candidate[], words: ReadonlyArray<{ word: string }>) {
    const named = new Map<Candidate, string[]>();
    const firstNameAt = new Set<number>();
    for (const match of matches) {
      const everyone = this.index.byEntry.get(match.name)?.length ?? 0;
      const before = match.firstIndex > 0 ? words[match.firstIndex - 1] : undefined;
      if (everyone < 2 || !before) continue;
      const keys = this.firstNames.match(match.name, before.word, everyone);
      if (!keys) continue;
      named.set(match, keys);
      firstNameAt.add(match.firstIndex - 1);
    }
    if (firstNameAt.size === 0) return { kept: matches, named };
    const kept = matches.filter(
      (match) => named.has(match) || match.firstIndex !== match.lastIndex || !firstNameAt.has(match.firstIndex),
    );
    return { kept, named };
  }

  /**
   * A surname heard without a number: the player its first name said, or,
   * for a shared surname, the most called (stars.ts). A surname nobody shares,
   * or one where nobody has a call rate, is the whole entry, as it always was.
   */
  private chosen(base: Spot, named: string[] | null, entry: string): Spot {
    const all = base.players;
    const slots = (named ?? all).map((key) => this.index.byKey.get(key)).filter((slot) => slot !== undefined);
    const keep = named ? slots : preferStars(slots, (slot) => slot.entry);
    const players = keep.map((slot) => slot.key);
    if (sameKeys(players, all)) return base;
    return {
      ...base,
      players,
      pool: all,
      label: sameSet(players, all) ? base.label : this.labelFor(keep, entry),
    };
  }

  /**
   * What a set of cards is called.
   *
   * A whole entry keeps the watchlist's own label, so a plain surname match
   * reads exactly as it did before numbers existed. Anything narrower, or a
   * number that found players across two surnames, is spelled out.
   */
  private labelFor(slots: RosterSlot[], entry: string | null): string {
    if (entry !== null && sameKeys(slots.map((slot) => slot.key), this.index.byEntry.get(entry) ?? [])) {
      return this.labels.get(entry) ?? entry;
    }
    const bothSides = slots.some((s) => s.player.side === "H") && slots.some((s) => s.player.side === "A");
    return slots
      .map((slot) => {
        const jersey = (slot.player.jersey ?? "").trim();
        const shown = jersey.length > 0 ? `#${jersey}` : NO_JERSEY;
        return `${slot.player.last_name} ${shown}${bothSides ? ` ${slot.player.side}` : ""}`;
      })
      .join(LABEL_SEPARATOR);
  }

  /** Points an occurrence at fewer players. True when that actually changed it. */
  private narrow(occurrence: Occurrence, spot: Spot): boolean {
    if (!isNarrowerThan(spot.players, occurrence.pool ?? occurrence.players)) return false;
    if (sameSet(spot.players, occurrence.players)) return false;
    occurrence.players = spot.players;
    occurrence.label = spot.label;
    occurrence.cue = spot.cue;
    occurrence.cueWord = spot.cueWord;
    occurrence.sounded = spot.sounded;
    return true;
  }

  private remember(
    spot: Spot,
    connectionId: number,
    now: number,
    wallTime: number,
    isFinal: boolean,
    status: Occurrence["status"],
  ) {
    this.occurrences.push({
      key: spot.key,
      label: spot.label,
      word: spot.word,
      score: spot.score,
      minScore: spot.minScore,
      confidence: spot.confidence,
      connectionId,
      start: spot.start,
      detectedAt: now,
      wallTime,
      status,
      provisional: !isFinal,
      players: spot.players,
      ...(spot.pool ? { pool: spot.pool } : {}),
      cue: spot.cue,
      cueWord: spot.cueWord,
      sounded: spot.sounded,
    });
  }

  /** Distinct players ordered by their latest match, newest first. A suppressed repeat does not move a player. */
  private keysOnScreen(): string[] {
    const keys: string[] = [];
    for (let i = this.occurrences.length - 1; i >= 0 && keys.length < MAX_NAMES_ON_SCREEN; i--) {
      const o = this.occurrences[i];
      if (o.status !== "fired") continue;
      for (const key of o.players) {
        if (keys.length < MAX_NAMES_ON_SCREEN && !keys.includes(key)) keys.push(key);
      }
    }
    return keys;
  }

  private isSameUtterance(o: Occurrence, spot: Spot, connectionId: number): boolean {
    return (
      o.connectionId === connectionId &&
      o.key === spot.key &&
      Math.abs(o.start - spot.start) <= SAME_UTTERANCE_SECONDS
    );
  }

  private latest(predicate: (o: Occurrence) => boolean): Occurrence | undefined {
    for (let i = this.occurrences.length - 1; i >= 0; i--) {
      if (predicate(this.occurrences[i])) return this.occurrences[i];
    }
    return undefined;
  }

  /** Marks an occurrence retracted. Returns a later mention it had suppressed, now promoted to a match. */
  private retract(occurrence: Occurrence): Occurrence | undefined {
    const wasFired = occurrence.status === "fired";
    occurrence.status = "retracted";
    occurrence.provisional = false;
    if (!wasFired) return undefined;
    const suppressed = this.occurrences.find(
      (o) => o.key === occurrence.key && o.status === "repeat" && o.detectedAt > occurrence.detectedAt,
    );
    if (suppressed) suppressed.status = "fired";
    return suppressed;
  }

  private prune(now: number) {
    if (now - this.lastPruneAt < PRUNE_EVERY_MS) return;
    this.lastPruneAt = now;
    const keep = new Set<Occurrence>();
    const players = new Set<string>();
    let recent = 0;
    for (let i = this.occurrences.length - 1; i >= 0; i--) {
      const o = this.occurrences[i];
      if (o.status !== "fired") continue;
      if (recent < KEEP_RECENT_MATCHES) {
        keep.add(o);
        recent++;
      }
      if (players.size < KEEP_PLAYERS && o.players.some((key) => !players.has(key))) {
        for (const key of o.players) players.add(key);
        keep.add(o);
      }
    }
    this.occurrences = this.occurrences.filter((o) => keep.has(o) || now - o.detectedAt < MEMORY_MS);
  }
}
