import { compileWatchlist, normalizeWord, phoneticKeys, scoreAgainst } from "@/lib/matching/matcher";
import type { StoredRecord } from "./records";

// =============================================================================
// Taking what identifies a game out of its browser log, so a copy can be
// shared (Jed, Oct 5, testrun: "see the failure points of the recording", and
// then: share last names, "we need to see where pronunciation goes wrong").
//
// The log is a recording of somebody naming minors, so what is shared is a
// scrubbed copy, never the log itself and never audio. LAST NAMES ARE KEPT, as
// said and as spelled, with every way Deepgram wrote them and each player's
// pronunciation note, because that is what a pronunciation failure is made of.
// FIRST NAMES and every school word become a tag from the roster: [H22] is
// home number 22, [A7] away number 7, [H4|A18] when two players answer to the
// same word. Times become offsets from the start of the game, the game id is
// dropped, and the teams are Home and Away. Pure, so what leaves the browser
// can be tested without one.
//
// WHAT THIS CANNOT DO: it knows the two rosters, and it finds what is on them.
// A first name that is not on either roster passes through as written, since
// Deepgram's transcript has no capital letters to find it by. A few cues
// (coach, referee, Mr.) are masked. The share is on by default and can be
// turned off, and the stored copy is deleted after RETAIN_DAYS.
// docs/V3_DEFINITION.md 9.3.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/**
 * Bump when what a scrubbed log holds changes, so old rows can be told apart.
 * 3 (Oct 12): the game record carries the whole game, names masked, so a
 * shared log replays (lib/log/sharedReplay.ts). 2 and before cannot.
 */
export const SCRUB_VERSION = 3;

/** How long a shared log is kept. The database deletes it after this (migration). */
export const RETAIN_DAYS = 90;

/** A name part shorter than this is left alone: "Al" is in too many words. */
const MIN_PART_LETTERS = 3;

/** A first name of two letters is left alone when it is one of these everyday words. */
const TWO_LETTER_WORDS = new Set([
  "to", "of", "my", "me", "no", "go", "he", "we", "be", "it", "is", "in", "on", "at", "an", "as", "am", "by", "do",
  "if", "so", "up", "us", "or", "oh", "ok", "hi", "ah", "uh", "um", "ha", "yo", "ya", "ex", "id", "ma", "pa",
]);

/** The game id every shared record carries, so the copy cannot be joined back to called_games. */
export const SHARED_GAME_ID = "shared";

/** First names that are also everyday words. They are masked only beside their surname ("will smith"), never alone. */
const FIRST_NAMES_THAT_ARE_WORDS = new Set([
  "will", "mark", "grant", "bill", "rich", "frank", "jack", "hunter", "chase", "drew", "cash", "king", "major",
  "ace", "art", "bob", "pat", "rob", "ray", "jay", "rod", "dean", "case", "miles", "rocky", "brook", "dale",
  "gene", "guy", "lane", "max", "mike", "nick", "ward", "wade", "reed", "trey", "tank", "jet", "sky", "storm",
  "blake", "brent", "clay", "cole", "colt", "dash", "dax", "ford", "gage", "hank", "joe", "kit", "lance", "lee",
  "rex", "russ", "sam", "sterling", "stone", "tag", "ty", "wyatt", "zane",
]);

/** Said about a team and not identifying one: left as heard. */
const GENERIC_TEAM_WORDS = new Set([
  "home", "away", "visitors", "visiting", "visitor", "hosts", "host", "guests", "guest", "white", "black", "red",
  "blue", "green", "gold", "yellow", "orange", "purple", "maroon", "navy", "gray", "grey", "silver", "teal", "pink",
  "dark", "light", "the", "and", "boys", "girls", "varsity", "team", "high", "school", "academy", "prep", "college",
]);

/** A role that is followed by a surname: "coach tolliver", "mr. quill". */
const NAME_CUES = /\b(coach|coaches|mister|mr|mrs|ms|miss|doctor|dr|principal|referee|ref|umpire|officer)\b\.?(?: +)([\p{L}][\p{L}'’-]*)/giu;

/** Words that follow a role without being a name: "coach said", "the referee is". */
const NOT_A_NAME = new Set([
  "said", "says", "is", "was", "will", "has", "had", "on", "in", "with", "and", "the", "a", "to", "for", "at", "of",
  "now", "just", "going", "wants", "called", "calls", "threw", "throws", "looks", "looking", "thinks", "might", "has",
  "have", "are", "were", "does", "did", "can", "could", "would", "should", "from", "that", "this", "out", "up", "down",
]);

// =============================================================================

/** What the scrub made of a log. */
export interface Scrubbed {
  records: unknown[];
  /** Strings that had something masked in them. Zero on a log with no names in it. */
  masked: number;
}

interface Person {
  side: "H" | "A";
  jersey: string | null;
  first: string | null;
  last: string;
  /** Every way Deepgram has been heard to write this player's surname (the watchlist's aliases). Shared as they are. */
  forms: string[];
  /** The pronunciation note as typed, "kwell-en-BAHK", when there is one. Shared as it is. */
  said: string | null;
  /** On the watchlist, so the engine can put their card up and read their first name (spotting is not off). */
  spotted: boolean;
}

const strip = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");

/** "H22", "A7", "H?" for no number. */
function anonId(person: Pick<Person, "side" | "jersey">): string {
  const jersey = (person.jersey ?? "").trim().replace(/^#/, "").replace(/\s+/g, "");
  return `${person.side}${jersey.length > 0 ? jersey : "?"}`;
}

/** Words of a name: split on spaces, hyphens, apostrophes and underscores, the short ones left out. */
function parts(text: string): string[] {
  return strip(text)
    .toLowerCase()
    .split(/[\s\-_'’.]+/)
    .filter((part) => [...part].length >= MIN_PART_LETTERS);
}

/** Every spelling of one name worth looking for: as written, without accents, without apostrophes, with spaces for hyphens. */
function variants(text: string, minLetters = MIN_PART_LETTERS): string[] {
  const lower = text.toLowerCase().trim();
  if (lower.length === 0) return [];
  const flat = strip(lower);
  const out = new Set([lower, flat, flat.replace(/['’]/g, ""), flat.replace(/[\-_]/g, " "), flat.replace(/['’]/g, " ")]);
  return [...out].filter((variant) => [...variant].length >= minLetters && !(minLetters < MIN_PART_LETTERS && TWO_LETTER_WORDS.has(variant)));
}

type Anything = Record<string, unknown>;

/** The people the log's game records name, from every game record (a refresh writes another). */
function peopleIn(records: readonly StoredRecord[]): { people: Person[]; schools: string[]; cueWords: Map<string, string> } {
  const people: Person[] = [];
  const schools = new Set<string>();
  const cueWords = new Map<string, string>();
  const seen = new Set<string>();

  for (const record of records) {
    if (record.kind !== "game") continue;
    const snapshot = (record as unknown as { snapshot?: Anything }).snapshot ?? {};

    for (const side of ["home", "away"] as const) {
      const team = snapshot[side] as Anything | undefined;
      if (typeof team?.name === "string") schools.add(`${side === "home" ? "H" : "A"}:${team.name}`);
    }

    // The full rosters, linemen included.
    const roster = Array.isArray(snapshot.statsRoster) ? (snapshot.statsRoster as Anything[]) : [];
    for (const player of roster) {
      if (typeof player?.last !== "string") continue;
      const side = player.side === "away" ? "A" : "H";
      const jersey = typeof player.jersey === "string" ? player.jersey : null;
      const key = `${side}|${jersey}|${player.last}|${player.first}`;
      if (seen.has(key)) continue;
      seen.add(key);
      people.push({ side, jersey, first: typeof player.first === "string" ? player.first : null, last: player.last, forms: [], said: null, spotted: false });
    }

    // The watchlist: the players the cards can show, every way their surname was heard, and how it is said.
    const watchlist = Array.isArray(snapshot.watchlist) ? (snapshot.watchlist as Anything[]) : [];
    for (const entry of watchlist) {
      const forms = (Array.isArray(entry.aliases) ? entry.aliases : []).filter((form): form is string => typeof form === "string");
      const players = Array.isArray(entry.players) ? (entry.players as Anything[]) : [];
      for (const player of players) {
        if (typeof player?.last_name !== "string") continue;
        const side = player.side === "A" ? "A" : "H";
        const jersey = typeof player.jersey === "string" ? player.jersey : null;
        const first = typeof player.first_name === "string" ? player.first_name : null;
        const key = `${side}|${jersey}|${player.last_name}|${first}`;
        const said = typeof player.pronunciation === "string" && player.pronunciation.trim().length > 0 ? player.pronunciation.trim() : null;
        const person: Person = { side, jersey, first, last: player.last_name, forms: [...forms], said, spotted: true };
        if (seen.has(key)) {
          // Already known from the roster: add the spoken forms and the note to that player.
          const known = people.find((p) => p.side === side && p.jersey === jersey && p.last === player.last_name && p.first === first);
          if (known) {
            for (const form of person.forms) if (!known.forms.includes(form)) known.forms.push(form);
            known.said ??= said;
            known.spotted = true;
          }
        } else {
          seen.add(key);
          people.push(person);
        }
      }
    }

    // The words that name a team, from the cues.
    const cues = Array.isArray(snapshot.teamCues) ? (snapshot.teamCues as Anything[]) : [];
    for (const cue of cues) {
      const tag = cue.side === "A" ? "AWAY" : "HOME";
      for (const word of Array.isArray(cue.words) ? cue.words : []) {
        if (typeof word === "string") for (const part of parts(word)) if (!GENERIC_TEAM_WORDS.has(part)) cueWords.set(part, tag);
      }
    }
  }
  return { people, schools: [...schools], cueWords };
}

/** One of Deepgram's words, as a result record carries it. */
const isWord = (value: unknown): value is { word: string } =>
  typeof value === "object" && value !== null && typeof (value as Anything).word === "string";

/** Escapes a term for a RegExp. */
const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The masker for one log: a regex over every term, longest first, and what each term becomes. */
function buildMasker(records: readonly StoredRecord[]) {
  const { people, schools, cueWords } = peopleIn(records);
  // A first name that is also somebody's surname, or that the matcher hears
  // as one ("tyler" fires Taylor), is masked only beside its own surname:
  // alone, the word is that other player's name, which is kept, and a replay
  // has to hear it as the game did.
  const surnames = new Set(people.flatMap((person) => parts(person.last)));
  const spokenSurnames = compileWatchlist(
    [...new Map(people.filter((person) => person.spotted).map((person) => [person.last, person])).values()].map((person) => ({
      name: person.last,
      aliases: person.forms,
    })),
  );
  const soundsLikeSurname = (part: string) => {
    const text = normalizeWord(part);
    const keys = phoneticKeys(text);
    return spokenSurnames.some((entry) => {
      const { score, minScore } = scoreAgainst(text, keys, entry);
      return score >= minScore;
    });
  };
  const tags = new Map<string, Set<string>>();
  // "will marchetto": the first name goes, the surname is kept. A pair is
  // masked where the first name alone, being an everyday word, would not be.
  const pairs = new Set<string>();
  const add = (term: string, tag: string, minLetters = MIN_PART_LETTERS) => {
    for (const variant of variants(term, minLetters)) {
      if (!tags.has(variant)) tags.set(variant, new Set());
      tags.get(variant)!.add(tag);
    }
  };

  for (const person of people) {
    const tag = anonId(person);
    const first = person.first?.trim() ?? "";
    // Surnames are kept (Oct 5): the surname, every way it was heard and its
    // respelling are what a pronunciation failure is read from. Only the
    // first name goes.
    if (!first) continue;
    for (const part of parts(first)) {
      if (!FIRST_NAMES_THAT_ARE_WORDS.has(part) && !surnames.has(part) && !soundsLikeSurname(part)) add(part, tag);
    }
    // The pair, so "will smith" loses "will" where "will" alone is a word.
    if (!/\s/.test(first)) {
      for (const variant of variants(`${first} ${person.last}`)) {
        add(variant, tag);
        pairs.add(variant);
      }
    }
  }
  tags.delete("");
  for (const [term, set] of tags) {
    set.delete("");
    if (set.size === 0) tags.delete(term);
  }

  // Schools and the words a team is called by, each word its own numbered
  // tag ([HOME1], [HOME2]), the same wherever it is said. One tag for every
  // word would make a replay hear "sierra 22" as a team cue because the
  // mascot alone is one (scrub 3): the number tells the words apart and says
  // nothing about them.
  const teamTags = new Map<string, string>();
  const counts = { HOME: 0, AWAY: 0 };
  const teamTag = (side: "HOME" | "AWAY", word: string) => {
    const key = `${side}:${word}`;
    let tag = teamTags.get(key);
    if (tag === undefined) {
      counts[side] += 1;
      tag = `${side}${counts[side]}`;
      teamTags.set(key, tag);
    }
    return tag;
  };
  for (const school of schools) {
    const [side, ...name] = school.split(":");
    const team = side === "A" ? "AWAY" : "HOME";
    for (const part of parts(name.join(":"))) if (!GENERIC_TEAM_WORDS.has(part)) add(part, teamTag(team, part));
  }
  for (const [word, team] of cueWords) add(word, teamTag(team as "HOME" | "AWAY", word));

  const terms = [...tags.keys()].sort((a, b) => b.length - a.length);
  const regex =
    terms.length === 0
      ? null
      : // A word ends at anything but a letter or digit, and at an apostrophe
        // only before a possessive "'s": "eli" is not a name inside "eli'ipule".
        new RegExp(
          `(?<![\\p{L}\\p{N}])(?<!\\p{L}['’])(?:${terms.map(escape).join("|")})(?![\\p{L}\\p{N}])(?!['’](?!s(?![\\p{L}\\p{N}]))\\p{L})`,
          "giu",
        );

  const tagFor = (matched: string): string => {
    const key = matched.toLowerCase();
    if (pairs.has(key) || pairs.has(strip(key))) {
      const set = tags.get(key) ?? tags.get(strip(key));
      // The first name becomes the tag; the surname after it stays as said.
      return matched.replace(/^\S+/, `[${[...(set ?? [])].slice(0, 3).join("|")}]`);
    }
    const set = tags.get(key) ?? tags.get(strip(key));
    const list = set ? [...set] : [];
    if (list.length === 0) return "[name]";
    return `[${list.slice(0, 3).join("|")}${list.length > 3 ? "|..." : ""}]`;
  };

  const exact = (text: string): string => {
    let out = text;
    if (regex) out = out.replace(regex, (matched) => tagFor(matched));
    out = out.replace(NAME_CUES, (whole, role: string, next: string) =>
      NOT_A_NAME.has(next.toLowerCase()) || next.startsWith("[") ? whole : `${role} [name]`,
    );
    return out;
  };

  // A first name right before a surname, spelled however Deepgram spelled it
  // ("raheem" for Rahiem), found the way the engine finds it: the matcher's
  // own scoring against the first name of each player carrying that surname
  // (FirstNames in lib/matching/stars.ts). Masked for privacy, and masked as
  // the tag the roster's first name has, so a replay narrows a shared surname
  // exactly where the game did. A word that is also somebody's surname is
  // left alone, as above, except where the engine read it as a first name
  // (two spotted players share the surname and it named some of them), since
  // there the game dropped that surname's card and a replay must too.
  const bySurname = new Map<string, Person[]>();
  for (const person of people) {
    for (const form of [person.last, ...person.forms]) {
      const key = normalizeWord(form);
      if (key.length === 0) continue;
      const carriers = bySurname.get(key) ?? [];
      if (!carriers.includes(person)) carriers.push(person);
      bySurname.set(key, carriers);
    }
  }
  const surnameWords = new Set(people.map((person) => normalizeWord(person.last)));
  const compiled = new Map<Person, ReturnType<typeof compileWatchlist>[number] | null>();
  const firstOf = (person: Person) => {
    if (!compiled.has(person)) {
      const first = person.first?.trim() ?? "";
      compiled.set(person, normalizeWord(first) ? compileWatchlist([{ name: first, aliases: [] }])[0] : null);
    }
    return compiled.get(person) ?? null;
  };
  const tagOf = (named: readonly Person[]): string => {
    // One player: the roster's own tag for them. Several: a tag the replay narrows to nobody.
    if (named.length === 1) return firstTag(named[0].first, named[0], exact) ?? `[${anonId(named[0])}]`;
    const ids = [...new Set(named.map(anonId))];
    return `[${ids.slice(0, 3).join("|")}${ids.length > 3 ? "|..." : ""}]`;
  };
  const firstNameBefore = (word: string, next: string): string | null => {
    const carriers = bySurname.get(normalizeWord(next));
    if (!carriers) return null;
    const text = normalizeWord(word);
    if (text.length === 0) return null;
    const keys = phoneticKeys(text);
    const named = carriers.filter((person) => {
      const first = firstOf(person);
      if (!first) return false;
      const { score, minScore } = scoreAgainst(text, keys, first);
      return score >= minScore;
    });
    if (named.length === 0) return null;
    // What the engine did: narrowed the spotted players who share it, when the word named some of them and not all.
    const spotted = carriers.filter((person) => person.spotted);
    const narrowed = named.filter((person) => person.spotted);
    const engineRead = spotted.length >= 2 && narrowed.length > 0 && narrowed.length < spotted.length;
    if (engineRead) return tagOf(narrowed);
    return surnameWords.has(text) ? null : tagOf(named);
  };

  const text = (said: string): string => {
    const tokens = said.split(/(\s+)/);
    for (let index = 0; index + 2 < tokens.length; index += 2) {
      const tag = firstNameBefore(tokens[index], tokens[index + 2]);
      if (tag) tokens[index] = tag;
    }
    return exact(tokens.join(""));
  };

  return { text, firstNameBefore };
}

// An epoch in milliseconds, 2017 to 2033. Times are shared as offsets from the start.
const EPOCH_MIN = 1.5e12;
const EPOCH_MAX = 2.0e12;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** The earliest wall-clock time anywhere in the records, which every time becomes an offset from. */
function startOf(records: readonly StoredRecord[]): number {
  let start = Infinity;
  const visit = (value: unknown) => {
    if (typeof value === "number" && value >= EPOCH_MIN && value <= EPOCH_MAX) start = Math.min(start, value);
    else if (typeof value === "string" && ISO_TIME.test(value)) {
      const time = Date.parse(value);
      if (Number.isFinite(time)) start = Math.min(start, time);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  records.forEach((record) => visit({ at: record.at }));
  return Number.isFinite(start) ? start : 0;
}

/** A masked first name made only of tags: "[H22]", "[H4|A18]", "[H22] [H22]". */
const ONLY_TAGS = /^(?:\[[^\]\s]+\](?:\s+|$))+$/;

/**
 * A first name as the shared game carries it: what the masker makes of it,
 * which is what the transcript says in its place, so a replay still tells two
 * players who share a surname apart by the word before it. A first name the
 * masker leaves (an everyday word like Will, a two-letter name, somebody
 * else's surname) becomes the player's own tag: the roster never keeps one.
 */
function firstTag(first: unknown, who: Pick<Person, "side" | "jersey">, mask: (text: string) => string): string | null {
  if (typeof first !== "string" || first.trim().length === 0) return null;
  const masked = mask(first.trim()).trim();
  return ONLY_TAGS.test(masked) ? masked : `[${anonId(who)}]`;
}

/** A team's name as its tags, or `fallback` when there is none. */
function teamName(team: unknown, fallback: string, mask: (text: string) => string): string {
  const name = (team as Anything | undefined)?.name;
  return typeof name === "string" && name.trim().length > 0 ? mask(name.trim()) : fallback;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A watchlist entry with what the engine reads, first names as tags, and nothing else about the player. */
function sharedEntry(entry: Anything, mask: (text: string) => string): Anything {
  const players = Array.isArray(entry.players) ? (entry.players as Anything[]) : [];
  return {
    // The surname and every way it is heard: kept, they are what is matched.
    name: entry.name,
    aliases: strings(entry.aliases),
    ...(typeof entry.label === "string" ? { label: mask(entry.label) } : {}),
    ...(typeof entry.keyterm === "string" ? { keyterm: entry.keyterm } : {}),
    ...(entry.exactOnly === true ? { exactOnly: true } : {}),
    players: players
      .filter((player) => typeof player?.last_name === "string")
      .map((player) => {
        const side = player.side === "A" ? "A" : "H";
        const jersey = textOrNull(player.jersey);
        return {
          jersey,
          first_name: firstTag(player.first_name, { side, jersey }, mask),
          last_name: player.last_name,
          position: textOrNull(player.position),
          // Grade, height and weight say who a minor is and nothing about how a name was heard.
          grade: null,
          height: null,
          weight: null,
          side,
          stat_lines: strings(player.stat_lines).map(mask),
          ...(typeof player.pronunciation === "string" ? { pronunciation: player.pronunciation } : {}),
          ...(typeof player.priority === "number" ? { priority: player.priority } : {}),
          ...(player.hasStats === true ? { hasStats: true } : {}),
        };
      }),
  };
}

/**
 * The game as shared (scrub 3): what the engine and the stats loop read, so
 * the copy replays, with every first name and school word as the same tag the
 * transcript has in its place. The watchlist (surnames, the ways they are
 * heard, pronunciation notes, spotting, priority, season lines), the keyterms,
 * the team cues word by word, both full rosters with their playerIds and
 * season numbers, who was out, and the stats settings. No team names, ids,
 * colours, what a side wore, grades, heights, weights, storylines or card
 * faces. `roster` is the short list a person reads, as scrub 2 had it.
 */
function sharedGame(record: StoredRecord, at: number, people: readonly Person[], mask: (text: string) => string): unknown {
  const snapshot = (record as unknown as { snapshot?: Anything }).snapshot ?? {};
  const roster = Array.isArray(snapshot.statsRoster) ? (snapshot.statsRoster as Anything[]) : [];
  const watchlist = Array.isArray(snapshot.watchlist) ? (snapshot.watchlist as Anything[]) : [];
  const cues = Array.isArray(snapshot.teamCues) ? (snapshot.teamCues as Anything[]) : [];
  return {
    kind: "game",
    gameId: SHARED_GAME_ID,
    at,
    snapshot: {
      sport: snapshot.sport ?? null,
      statsEnabled: snapshot.statsEnabled === true,
      ...(typeof snapshot.statsAuto === "boolean" ? { statsAuto: snapshot.statsAuto } : {}),
      // The school's words as their tags, "[HOME1] [HOME2]", which is what the transcript says in their place.
      home: { name: teamName(snapshot.home, "Home", mask) },
      away: { name: teamName(snapshot.away, "Away", mask) },
      watchlist: watchlist.filter((entry) => typeof entry?.name === "string").map((entry) => sharedEntry(entry, mask)),
      keyterms: strings(snapshot.keyterms).map(mask),
      // Word by word, as Deepgram's words are masked, so a cue the game heard is a cue the replay hears.
      teamCues: cues
        .filter((cue) => cue?.side === "H" || cue?.side === "A")
        .map((cue) => ({ side: cue.side, words: strings(cue.words).map(mask) })),
      statsRoster: roster
        .filter((player) => typeof player?.playerId === "string" && typeof player?.last === "string")
        .map((player) => {
          const side = player.side === "away" ? "away" : "home";
          const jersey = textOrNull(player.jersey);
          return {
            playerId: player.playerId,
            side,
            jersey,
            first: firstTag(player.first, { side: side === "away" ? "A" : "H", jersey }, mask),
            last: player.last,
            position: textOrNull(player.position),
            season: player.season ?? null,
            ...(Array.isArray(player.aliases) ? { aliases: strings(player.aliases) } : {}),
          };
        }),
      ...(Array.isArray(snapshot.out) ? { out: strings(snapshot.out) } : {}),
      // Each player as a tag and their surname, how it is said and every way it was heard: where
      // a pronunciation goes wrong is read from these against what Deepgram wrote.
      roster: roster.map((player) => {
        const side = player.side === "away" ? "A" : "H";
        const jersey = typeof player.jersey === "string" ? player.jersey : null;
        const person = people.find((p) => p.side === side && p.jersey === jersey && p.last === player.last);
        return {
          id: anonId({ side, jersey }),
          last: typeof player.last === "string" ? player.last : null,
          said: person?.said ?? null,
          heardAs: person?.forms ?? [],
          position: typeof player.position === "string" ? player.position : null,
          hasSeason: player.season !== null && player.season !== undefined,
        };
      }),
    },
  };
}

/**
 * A scrubbed copy of a game's log: every string run through the roster's
 * names, every time made relative, the game id and the team names gone.
 */
export function scrubLog(records: readonly StoredRecord[]): Scrubbed {
  const masker = buildMasker(records);
  const mask = masker.text;
  const { people } = peopleIn(records);
  const start = startOf(records);
  let masked = 0;

  const clean = (value: unknown, key = ""): unknown => {
    if (typeof value === "number") return value >= EPOCH_MIN && value <= EPOCH_MAX ? value - start : value;
    if (typeof value === "string") {
      // The record's own type names are not text anybody said.
      if (key === "kind") return value;
      if (ISO_TIME.test(value)) {
        const time = Date.parse(value);
        return Number.isFinite(time) ? `+${time - start}` : value;
      }
      const scrubbed = mask(value);
      if (scrubbed !== value) masked += 1;
      return scrubbed;
    }
    if (Array.isArray(value) && key === "words" && value.every(isWord)) {
      // Deepgram's words one by one: a first name is found by the surname after it.
      return value.map((word, index) => {
        const copy = clean(word, key) as Anything;
        const next = value[index + 1];
        const tag = next ? masker.firstNameBefore(word.word, next.word) : null;
        if (tag !== null && copy.word !== tag) {
          copy.word = tag;
          if (typeof copy.punctuated_word === "string") copy.punctuated_word = tag;
          masked += 1;
        }
        return copy;
      });
    }
    if (Array.isArray(value)) return value.map((item) => clean(item, key));
    if (value && typeof value === "object") {
      const out: Anything = {};
      for (const [name, item] of Object.entries(value)) {
        // The game id would join this copy back to the account that called the game.
        out[name] = name === "gameId" ? SHARED_GAME_ID : clean(item, name);
      }
      return out;
    }
    return value;
  };

  const out = records.map((record) => {
    const at = typeof record.at === "number" ? record.at - start : 0;
    if (record.kind === "game") return sharedGame(record, at, people, mask);
    const copy: Anything = { ...(record as unknown as Anything) };
    delete copy.seq;
    return clean(copy);
  });
  return { records: out, masked };
}

/** What a shared log is, as a file: the scrubbed records and how they were made. */
export interface SharedLog {
  format: "spotter-v3-shared-log";
  scrubVersion: number;
  records: unknown[];
}

export function toSharedLog(records: readonly StoredRecord[]): { log: SharedLog; masked: number } {
  const { records: scrubbed, masked } = scrubLog(records);
  return { log: { format: "spotter-v3-shared-log", scrubVersion: SCRUB_VERSION, records: scrubbed }, masked };
}

/** The same log without the interim results, for a game too big to send whole. Finals are what a person reads. */
export function withoutInterims(log: SharedLog): SharedLog {
  return {
    ...log,
    records: log.records.filter((record) => !((record as Anything).kind === "result" && (record as Anything).is_final === false)),
  };
}
