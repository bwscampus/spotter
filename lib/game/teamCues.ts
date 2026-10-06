import type { TeamCue } from "@/lib/matching/numbers";

// =============================================================================
// The words that mean "this team" when they come just before a number.
//
// "Eagles 5" and "white 5" are how an announcer says a number without saying
// "number", and they also say which side, which is the difference between one
// card and two. Built once when the game is built, from the school name, the
// mascot, and whatever the announcer says each side is wearing tonight.
//
// A cue both teams answer to is no cue at all, so anything shared is dropped.
// =============================================================================

/** Dropped from the end of a school name: nobody says "Campbell Hall High School 5". */
const GENERIC_SUFFIXES = new Set(["high", "school", "academy", "prep", "preparatory", "hs", "college", "the"]);

/** Too ordinary to mean a team, whatever the roster says. */
const STOP_WORDS = new Set(["the", "a", "an", "and", "of", "st", "saint", "team", "boys", "girls", "varsity"]);

/** Letters only, lowercased, possessive dropped: "Eagles'" and "Eagle's" both give "eagles". */
function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z]+/)
    .filter((word) => word.length > 0);
}

/** The phrases one team answers to, longest first. */
function phrasesFor(school: string, mascot: string | null, wearing: string | null): string[][] {
  const phrases: string[][] = [];
  const add = (parts: string[]) => {
    if (parts.length === 0) return;
    if (parts.every((part) => STOP_WORDS.has(part))) return;
    if (parts.length === 1 && parts[0].length < 3) return;
    if (!phrases.some((existing) => existing.join(" ") === parts.join(" "))) phrases.push(parts);
  };

  const schoolWords = words(school);
  add(schoolWords);
  // "Campbell Hall High School" is also just "Campbell Hall".
  let trimmed = [...schoolWords];
  while (trimmed.length > 1 && GENERIC_SUFFIXES.has(trimmed[trimmed.length - 1])) trimmed = trimmed.slice(0, -1);
  add(trimmed);

  if (mascot) {
    const mascotWords = words(mascot);
    add(mascotWords);
    // "Eagles" is said as often as "Eagle".
    const last = mascotWords[mascotWords.length - 1];
    if (mascotWords.length === 1 && last?.endsWith("s")) add([last.slice(0, -1)]);
  }

  if (wearing) for (const word of words(wearing)) add([word]);

  return phrases.sort((a, b) => b.length - a.length);
}

export interface CueSource {
  school: string;
  mascot: string | null;
  /** What this side is wearing tonight, as the announcer will say it: "white". */
  wearing: string | null;
}

/**
 * Both teams' cues, with anything they share left out.
 *
 * Two schools called after the same bird would otherwise make "Eagles 5" mean
 * either of them, which is worse than not listening for it at all.
 */
export function buildTeamCues(home: CueSource, away: CueSource): TeamCue[] {
  const sides: Array<["H" | "A", CueSource]> = [
    ["H", home],
    ["A", away],
  ];
  const counts = new Map<string, number>();
  const built = sides.map(([side, team]) => {
    const phrases = phrasesFor(team.school, team.mascot, team.wearing);
    for (const phrase of phrases) counts.set(phrase.join(" "), (counts.get(phrase.join(" ")) ?? 0) + 1);
    return { side, phrases };
  });

  const cues: TeamCue[] = [];
  for (const { side, phrases } of built) {
    for (const phrase of phrases) {
      if ((counts.get(phrase.join(" ")) ?? 0) > 1) continue;
      cues.push({ words: phrase, side });
    }
  }
  return cues.sort((a, b) => b.words.length - a.words.length);
}
