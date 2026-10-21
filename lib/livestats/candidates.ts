import type { TonightTally } from "@/lib/cards/tonight";
import { hasGroup } from "./positions";
import { bestHits } from "./parse/names";
import { segmentNameHits, type PlaySegment } from "./segment";
import type { Side, StatsRosterPlayer } from "./types";

// =============================================================================
// The candidate list (v7, Part 4): the few players a segment could be about,
// so the extractor picks an index from a short list instead of a playerId
// from three hundred. Everyone the segment's lines (and its post lines) name
// at CANDIDATE_MIN_SCORE or better, side-tagged; after them (fix 1, Part 1)
// anyone named only in its PRE lines, tagged "named before snap", because a
// TV booth names the back in the backfield and then says only "hands it
// off" (27 of the 33 dev misses on Oct 20); the offense's quarterback
// (tag "prior:qb", so a pass with no passer named still has one); on a run
// nobody is named for, the offense's most-credited back tonight (tag
// "prior:rb", which only Part 7's rules may credit); two players who share a
// surname both, tagged "same surname", with position and side to tell them
// apart. Sorted best first, at most MAX_CANDIDATES, and always NOT_NAMED at
// index 0. Pure.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** The name score a player needs to be a candidate: a sound-alike two edits off is in, a first name alone is out. */
export const CANDIDATE_MIN_SCORE = 0.55;

export const MAX_CANDIDATES = 8;

/** Index 0, always there: the play's player was not named. */
export const NOT_NAMED = 0;

/** The tag on a candidate named only before the snap: the prompt's rule 1 says when he may be credited. */
export const NAMED_BEFORE_SNAP = "named before snap";

// =============================================================================

export interface Candidate {
  idx: number;
  /** Null for NOT_NAMED. */
  playerId: string | null;
  /** "#22 Sam Langan RB HOME", or "NOT_NAMED". */
  label: string;
  /** How the transcript spelled the player, when it did not spell the surname. */
  heardAs: string[];
  /** The best name score in the segment; 0 for a prior nobody named. */
  score: number;
  side: Side | null;
  tags: string[];
}

export interface CandidateState {
  offense: Side | null;
  /** The quarterback on the field for each side (lib/livestats/check.ts currentQbs). */
  qbs: Record<Side, string | null>;
}

export function candidateLabel(player: StatsRosterPlayer): string {
  const parts = [player.jersey ? `#${player.jersey.replace(/^#/, "")}` : "", [player.first, player.last].filter(Boolean).join(" "), player.position ?? "", player.side.toUpperCase()];
  return parts.filter((part) => part.length > 0).join(" ");
}

/** The offense's most-credited running back tonight, by carries; null without a clear one. */
export function dominantBack(roster: readonly StatsRosterPlayer[], offense: Side, tonight: ReadonlyMap<string, TonightTally> | undefined): string | null {
  if (!tonight) return null;
  let best: { id: string; carries: number } | null = null;
  for (const player of roster) {
    if (player.side !== offense || !hasGroup(player.position, "skill")) continue;
    const carries = tonight.get(player.playerId)?.stats.rush_att ?? 0;
    if (carries <= 0) continue;
    if (!best || carries > best.carries) best = { id: player.playerId, carries };
  }
  return best?.id ?? null;
}

export function buildCandidates(segment: PlaySegment, state: CandidateState, roster: readonly StatsRosterPlayer[], tonight?: ReadonlyMap<string, TonightTally>): Candidate[] {
  const players = new Map(roster.map((player) => [player.playerId, player]));
  const surnames = new Map<string, number>();
  for (const player of roster) {
    const key = player.last.trim().toLowerCase();
    surnames.set(key, (surnames.get(key) ?? 0) + 1);
  }
  const found = new Map<string, Candidate>();
  /** Where each player was first named, so two at the same score keep the order the booth said them. */
  const firstAt = new Map<string, number>();
  [...segment.lines, ...segment.postLines].forEach((line, lineIndex) => {
    for (const hit of line.nameHits) if (!firstAt.has(hit.playerId)) firstAt.set(hit.playerId, lineIndex * 1_000 + hit.span[0]);
  });

  const named = segmentNameHits(segment);
  const namedIds = new Set(named.map((hit) => hit.playerId));
  const beforeSnap = bestHits(segment.preLines.flatMap((line) => line.nameHits)).filter((hit) => !namedIds.has(hit.playerId));
  const said = [...segment.preLines, ...segment.lines, ...segment.postLines];
  for (const hit of [...named, ...beforeSnap]) {
    if (hit.score < CANDIDATE_MIN_SCORE) continue;
    const player = players.get(hit.playerId);
    if (!player) continue;
    const tags: string[] = [];
    if (hit.viaJersey) tags.push("by jersey");
    if ((surnames.get(player.last.trim().toLowerCase()) ?? 0) > 1 && hit.how !== "first_last") tags.push("same surname");
    if (!namedIds.has(hit.playerId)) tags.push(NAMED_BEFORE_SNAP);
    const heard = hit.how === "spelling" || hit.how === "sound" ? [...new Set(said.flatMap((line) => line.nameHits.filter((each) => each.playerId === hit.playerId && (each.how === "spelling" || each.how === "sound")).map((each) => line.words.slice(each.span[0], each.span[1] + 1).join(" "))))] : [];
    found.set(player.playerId, { idx: 0, playerId: player.playerId, label: candidateLabel(player), heardAs: heard, score: hit.score, side: player.side, tags });
  }

  // The offense's quarterback: a pass with no passer named is still his.
  const qb = state.offense ? state.qbs[state.offense] : null;
  if (qb && players.has(qb)) {
    const held = found.get(qb);
    if (held) held.tags.push("prior:qb");
    else found.set(qb, { idx: 0, playerId: qb, label: candidateLabel(players.get(qb)!), heardAs: [], score: 0, side: state.offense, tags: ["prior:qb"] });
  }

  // A run nobody on the offense is named for: the back who has carried it most tonight, for Part 7 to decide on.
  const rush = segment.cues.rush && !segment.cues.pass && !segment.cues.complete && !segment.cues.incomplete;
  const namedOffense = [...found.values()].some((candidate) => candidate.side === state.offense && candidate.score >= CANDIDATE_MIN_SCORE && !candidate.tags.includes("prior:qb"));
  if (rush && state.offense && !namedOffense) {
    const back = dominantBack(roster, state.offense, tonight);
    if (back && !found.has(back)) found.set(back, { idx: 0, playerId: back, label: candidateLabel(players.get(back)!), heardAs: [], score: 0, side: state.offense, tags: ["prior:rb"] });
  }

  const order = (candidate: Candidate) => firstAt.get(candidate.playerId ?? "") ?? Number.POSITIVE_INFINITY;
  // Named in the play or after it, then named only before the snap, then the priors nobody named (score 0).
  const group = (candidate: Candidate) => (candidate.score === 0 ? 2 : candidate.tags.includes(NAMED_BEFORE_SNAP) ? 1 : 0);
  const sorted = [...found.values()]
    .sort((a, b) => group(a) - group(b) || b.score - a.score || order(a) - order(b) || (a.side === state.offense ? -1 : 1) - (b.side === state.offense ? -1 : 1) || a.label.localeCompare(b.label))
    .slice(0, MAX_CANDIDATES);
  sorted.forEach((candidate, index) => (candidate.idx = index + 1));
  const notNamed: Candidate = { idx: NOT_NAMED, playerId: null, label: "NOT_NAMED", heardAs: [], score: 0, side: null, tags: [] };
  return [...sorted, notNamed];
}

/** The candidate at an index the extractor answered with, or null for NOT_NAMED and anything off the list. */
export function candidateAt(candidates: readonly Candidate[], idx: number | null): Candidate | null {
  if (idx === null || idx === NOT_NAMED) return null;
  return candidates.find((candidate) => candidate.idx === idx && candidate.playerId !== null) ?? null;
}
