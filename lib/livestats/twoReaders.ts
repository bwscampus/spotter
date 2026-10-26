import { renderGameState } from "./gameStateBlock";
import { resolveIds } from "./resolveIds";
import { NO_USAGE, type ArbiterUse, type BoothStatLine, type ExtractStatsRequest, type StatsEvent, type StatsPlay, type StatsRosterPlayer, type StatsUsage, type TwoReaderHow } from "./types";

// =============================================================================
// Two readers and an arbiter (Oct 26, the second v6 push). The first push
// measured that at least one of two Haiku-priced readers is right on 72% of
// the dev plays, against 59% for one. Every window goes to reader A and
// reader B; this file turns their two readings into one, before readPlays
// sees anything, so every rule after it (R12, R14, R18, the merge, the
// ledger, R52) still applies:
//   - the two readings are matched play by play: the most shared lines (half
//     of the shorter or more, as the merge counts them), then the same kind
//     of play, then the closest last line;
//   - both read the same play with the same type and the same carrier,
//     passer and receiver: it stands, with every tackler either credited and a
//     stated gain either read;
//   - only one read it: it stands, unless it is under ONE_READER_SURE, when
//     the arbiter decides;
//   - they disagree: the arbiter (lib/livestats/prompt.ts ARBITER_SYSTEM_PROMPT,
//     Haiku 5.5) sees the lines and the two readings as "Reading 1" and
//     "Reading 2" in an order fixed by the play, never which model, and picks
//     one, the parts both share, or neither. It can never add a player neither
//     reader credited.
// At most ARBITER_SHARE of a game's plays go to the arbiter (ArbiterUse, which
// the loop keeps and sends with every read); past that, reader A stands. Each
// play says how it was formed (`readers`, noted R53 by readPlays). Pure apart
// from the arbiter call it is handed, so a recorded run can be decided again.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** A play only one reader read, rated under this, goes to the arbiter rather than standing. */
export const ONE_READER_SURE = 0.4;

/** At most this share of a game's plays go to the arbiter; past it, reader A stands. */
export const ARBITER_SHARE = 0.4;

/** The arbiter may always be asked this many times a game, so the first plays are not all past the share. */
export const ARBITER_FREE_CALLS = 2;

// =============================================================================

/**
 * How a disagreement is decided (Oct 26, Part B's variants): the arbiter (the
 * default), or always reader A, or always reader B, with no arbiter call.
 * `swap` makes reader B the one treated as A: the fallback past the guard and
 * when the arbiter fails.
 */
export interface TwoReaderRules {
  disagree: "arbiter" | "a" | "b";
  swap: boolean;
}

export const DEFAULT_TWO_READER_RULES: TwoReaderRules = { disagree: "arbiter", swap: false };

/** What one reader said about a window, validated. */
export interface Reading {
  plays: StatsPlay[];
  statLines: BoothStatLine[];
}

/** The arbiter's choice, with A and B already put back in place of "Reading 1" and "Reading 2". */
export type ArbiterPick = "a" | "b" | "parts" | "neither";

/** What the arbiter is asked about one play. */
export interface ArbiterAsk {
  /** The decision's identity in a recorded run: the look, the lines and both readings. */
  key: string;
  /** Which reader is shown as "Reading 1". */
  first: "a" | "b";
  /** The user message: the game state, the lines, and the two readings. */
  content: string;
}

export interface ArbiterAnswer {
  pick: ArbiterPick | null;
  usage?: StatsUsage;
  /** The failure's code, when the call failed. */
  code?: string;
}

export type Arbitrate = (ask: ArbiterAsk) => Promise<ArbiterAnswer>;

/** One arbiter decision, as a recorded run keeps it. */
export interface ArbiterDecision {
  key: string;
  pick: ArbiterPick | null;
  code?: string;
  usage?: StatsUsage;
}

export interface MergedReading {
  plays: StatsPlay[];
  statLines: BoothStatLine[];
  decisions: ArbiterDecision[];
  /** What this read adds to the game's count. */
  arbiterUse: ArbiterUse;
}

const RUN_FAMILY: ReadonlySet<string> = new Set(["run", "kneel"]);
const KEY_ACTIONS: ReadonlySet<StatsEvent["action"]> = new Set(["rush", "pass_complete", "pass_incomplete", "pass_intercepted", "reception", "sacked"]);
const DEFENSE: ReadonlySet<StatsEvent["action"]> = new Set(["tackle", "sack", "pass_breakup", "forced_fumble", "fumble_recovery", "interception"]);
const GAIN: ReadonlySet<StatsEvent["action"]> = new Set(["rush", "pass_complete", "reception", "sacked"]);

/** The kind of play, for matching: a run and a kneel are one kind. */
function family(play: StatsPlay): string {
  return RUN_FAMILY.has(play.playType) ? "run" : play.playType;
}

/** A play a reader actually credited someone on, or one of a kind that has no credit (a kick, a penalty with no snap). */
export function isReal(play: StatsPlay): boolean {
  if (play.playType === "other" || play.playType === "penalty_only") return play.events.some((event) => event.playerId !== "" && KEY_ACTIONS.has(event.action));
  if (family(play) === "run" || play.playType === "pass" || play.playType === "sack") return play.events.some((event) => KEY_ACTIONS.has(event.action));
  return true;
}

/** The credits that make a reading the same play: who carried, threw and caught, and what the pass did. */
function keyCredits(play: StatsPlay): string {
  return play.events
    .filter((event) => KEY_ACTIONS.has(event.action))
    .map((event) => `${event.action}:${event.playerId}`)
    .sort()
    .join(",");
}

/** Whether two readings agree on the play type and the ball carrier, passer and receiver. */
export function agree(a: StatsPlay, b: StatsPlay): boolean {
  return a.playType === b.playType && keyCredits(a) === keyCredits(b);
}

function sharedLines(a: StatsPlay, b: StatsPlay): number {
  return Math.min(a.seqEnd, b.seqEnd) - Math.max(a.seqStart, b.seqStart) + 1;
}

/** Same lines as the merge counts them: more than half the shorter reading's lines in common. */
function overlaps(a: StatsPlay, b: StatsPlay): boolean {
  const shared = sharedLines(a, b);
  return shared > 0 && shared > 0.5 * Math.min(a.seqEnd - a.seqStart + 1, b.seqEnd - b.seqStart + 1);
}

/** The two readings paired play by play: the most shared lines, then the same kind, then the closest last line. Unpaired plays stand alone. */
export function matchReadings(a: readonly StatsPlay[], b: readonly StatsPlay[]): Array<{ a: StatsPlay | null; b: StatsPlay | null }> {
  const candidates: Array<{ i: number; j: number; shared: number; same: number; distance: number }> = [];
  a.forEach((left, i) =>
    b.forEach((right, j) => {
      if (overlaps(left, right)) candidates.push({ i, j, shared: sharedLines(left, right), same: family(left) === family(right) ? 1 : 0, distance: Math.abs(left.seqEnd - right.seqEnd) });
    }),
  );
  candidates.sort((x, y) => y.shared - x.shared || y.same - x.same || x.distance - y.distance || x.i - y.i || x.j - y.j);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: Array<{ a: StatsPlay | null; b: StatsPlay | null }> = [];
  for (const candidate of candidates) {
    if (usedA.has(candidate.i) || usedB.has(candidate.j)) continue;
    usedA.add(candidate.i);
    usedB.add(candidate.j);
    pairs.push({ a: a[candidate.i], b: b[candidate.j] });
  }
  a.forEach((play, i) => usedA.has(i) || pairs.push({ a: play, b: null }));
  b.forEach((play, j) => usedB.has(j) || pairs.push({ a: null, b: play }));
  return pairs.sort((x, y) => (x.a ?? x.b)!.seqEnd - (y.a ?? y.b)!.seqEnd);
}

/** Reader A's play, with every defender reader B credited that A did not, and a stated gain B read where A has none. */
export function mergeAgreed(a: StatsPlay, b: StatsPlay): StatsPlay {
  const has = (event: StatsEvent) => a.events.some((each) => each.action === event.action && each.playerId === event.playerId);
  const defenders = b.events.filter((event) => DEFENSE.has(event.action) && event.playerId !== "" && !has(event));
  const said = (play: StatsPlay) => play.events.find((event) => GAIN.has(event.action) && event.yardsSource === "stated" && event.yards !== null);
  const fromB = said(a) ? undefined : said(b);
  const events = a.events.map((event) => (fromB && GAIN.has(event.action) && event.yardsSource !== "stated" ? { ...event, yards: fromB.yards, yardsSource: "stated" as const } : event));
  return { ...a, events: [...events, ...defenders], readers: "agreed" };
}

/** The play type and only the credits both readings share; null when they are not the same kind of play. */
export function sharedParts(a: StatsPlay, b: StatsPlay): StatsPlay | null {
  if (family(a) !== family(b)) return null;
  const events = a.events.filter((event) => b.events.some((each) => each.action === event.action && each.playerId === event.playerId));
  return { ...a, events, readers: "arbiter_parts" };
}

/** One reading in the arbiter's words: its kind, every credit and the yards. */
export function describeReading(play: StatsPlay | null): string {
  if (!play || !isReal(play)) return "no play";
  const credits = play.events.map((event) => `${event.action.replace(/_/g, " ")} ${event.playerId || "(nobody named)"}${event.yards !== null ? ` ${event.yards} yards` : ""}`);
  const flags = [play.touchdown ? "touchdown" : "", play.nullified ? "wiped out by a penalty" : ""].filter(Boolean);
  return `${play.playType.replace(/_/g, " ")}${credits.length > 0 ? `: ${credits.join("; ")}` : ""}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`;
}

/** A short, steady hash, so the same play is always shown in the same order and keyed the same way. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** What the arbiter is asked about a pair: the lines around the plays, the game state and the two readings. */
export function arbiterAsk(request: ExtractStatsRequest, a: StatsPlay | null, b: StatsPlay | null): ArbiterAsk {
  const from = Math.min(a?.seqStart ?? Infinity, b?.seqStart ?? Infinity) - 1;
  const to = Math.max(a?.seqEnd ?? -Infinity, b?.seqEnd ?? -Infinity) + 2;
  const lines = request.utterances.filter((line) => line.seq >= from && line.seq <= to).map((line) => `${line.seq}\t${line.text}`);
  const readingA = describeReading(a);
  const readingB = describeReading(b);
  const key = `${request.look ?? "first"}|${from}-${to}|${readingA}|${readingB}`;
  const first: "a" | "b" = hash(key) % 2 === 0 ? "a" : "b";
  const [one, two] = first === "a" ? [readingA, readingB] : [readingB, readingA];
  const content = [request.gameState ? renderGameState(request.gameState) : "", "LINES", ...lines, "", `Reading 1: ${one}`, `Reading 2: ${two}`].filter((part, index) => index > 0 || part !== "").join("\n");
  return { key, first, content };
}

/** Whether the guard lets one more play go to the arbiter. */
function arbiterAllowed(use: ArbiterUse): boolean {
  return use.arbitrated + 1 <= Math.max(ARBITER_FREE_CALLS, ARBITER_SHARE * use.plays);
}

function tagged(play: StatsPlay, how: TwoReaderHow): StatsPlay {
  return { ...play, readers: how };
}

/**
 * The two readings as one: matched, merged, and decided by the arbiter where
 * they disagree, within the game's guard. Plays keep reader A's order of
 * lines; stat lines are A's with any B read that A did not.
 */
export async function mergeReaders(request: ExtractStatsRequest, readingA: Reading, readingB: Reading, arbitrate: Arbitrate, rules: TwoReaderRules = DEFAULT_TWO_READER_RULES): Promise<MergedReading> {
  const roster: readonly StatsRosterPlayer[] = request.rosters;
  const resolved = (plays: readonly StatsPlay[]) => plays.map((play) => resolveIds(play, roster).play);
  const pairs = matchReadings(resolved(readingA.plays), resolved(readingB.plays));
  const use: ArbiterUse = { plays: request.arbiterUse?.plays ?? 0, arbitrated: request.arbiterUse?.arbitrated ?? 0 };
  const added: ArbiterUse = { plays: 0, arbitrated: 0 };
  const plays: StatsPlay[] = [];
  const decisions: ArbiterDecision[] = [];

  for (const { a, b } of pairs) {
    use.plays += 1;
    added.plays += 1;
    const realA = a !== null && isReal(a);
    const realB = b !== null && isReal(b);
    // Agreement, or two readings of nothing worth deciding.
    if (a && b && (agree(a, b) || (!realA && !realB))) {
      plays.push(realA ? mergeAgreed(a, b) : tagged(a, "agreed"));
      continue;
    }
    // Only one reader has the play, and it is sure enough to stand.
    const only = realA && !realB ? a : !realA && realB ? b : null;
    if (only && only.confidence >= ONE_READER_SURE) {
      plays.push(tagged(only, only === a ? "only_a" : "only_b"));
      continue;
    }
    if (!realA && !realB) {
      // Neither read a play (one of them may have read a non-play): reader A's reading, as it is.
      if (a) plays.push(tagged(a, "only_a"));
      else if (b) plays.push(tagged(b, "only_b"));
      continue;
    }
    // They disagree, or the one reading is unsure: a fixed reader when the rules say so.
    if (rules.disagree !== "arbiter") {
      const side = rules.disagree === "a" ? a : b;
      if (side) plays.push(tagged(side, rules.disagree === "a" ? "only_a" : "only_b"));
      continue;
    }
    // Else the arbiter, within the guard.
    if (!arbiterAllowed(use)) {
      if (a) plays.push(tagged(a, "budget_a"));
      continue;
    }
    use.arbitrated += 1;
    added.arbitrated += 1;
    const ask = arbiterAsk(request, a, b);
    const answer = await arbitrate(ask);
    decisions.push({ key: ask.key, pick: answer.pick, ...(answer.code ? { code: answer.code } : {}), ...(answer.usage ? { usage: answer.usage } : {}) });
    if (answer.pick === null) {
      if (a) plays.push(tagged(a, "arbiter_failed_a"));
    } else if (answer.pick === "a") {
      if (a) plays.push(tagged(a, "arbiter_a"));
    } else if (answer.pick === "b") {
      if (b) plays.push(tagged(b, "arbiter_b"));
    } else if (answer.pick === "parts" && a && b) {
      const parts = sharedParts(a, b);
      if (parts) plays.push(parts);
    }
    // "neither", or the parts of a play only one reader read: nothing.
  }

  const lineKey = (line: BoothStatLine) => `${line.seq}|${line.playerId}|${line.key}`;
  const seen = new Set(readingA.statLines.map(lineKey));
  const statLines = [...readingA.statLines, ...readingB.statLines.filter((line) => !seen.has(lineKey(line)))];
  return { plays, statLines, decisions, arbiterUse: added };
}

/** One reader's side of a two-reader read, as a recorded run keeps it. */
export interface ReaderRecord {
  ok: boolean;
  code?: string;
  plays?: StatsPlay[];
  statLines?: BoothStatLine[];
  usage?: StatsUsage;
  retries: number;
}

/** Both readers' replies and every arbiter decision of one read, kept by the replay so the merge can be decided again for free. */
export interface TwoReaderDetail {
  a: ReaderRecord;
  b: ReaderRecord;
  arbiter: ArbiterDecision[];
  /** The models, for the manifest's per-call records. */
  models: { a: string; b: string; arbiter: string };
}

/** Usages as one. */
export function sumUsage(...usages: Array<StatsUsage | undefined>): StatsUsage {
  return usages.reduce<StatsUsage>((total, usage) => (usage ? { inputTokens: total.inputTokens + usage.inputTokens, outputTokens: total.outputTokens + usage.outputTokens, cacheWriteTokens: total.cacheWriteTokens + usage.cacheWriteTokens, cacheReadTokens: total.cacheReadTokens + usage.cacheReadTokens, costUsd: total.costUsd + usage.costUsd, reasoningTokens: (total.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0) } : total), NO_USAGE);
}

/**
 * Two readers' records as one read: merged when both answered, the one that
 * answered standing alone (tagged as such) when only one did. The arbiter is
 * handed in, so a recorded run can answer from its record.
 */
export async function decideTwoReaders(request: ExtractStatsRequest, recorded: Pick<TwoReaderDetail, "a" | "b">, arbitrate: Arbitrate, rules: TwoReaderRules = DEFAULT_TWO_READER_RULES): Promise<MergedReading> {
  const detail = rules.swap ? { a: recorded.b, b: recorded.a } : recorded;
  const reading = (side: ReaderRecord) => ({ plays: side.plays ?? [], statLines: side.statLines ?? [] });
  if (!detail.b.ok) return { plays: reading(detail.a).plays.map((play) => ({ ...play, readers: "only_a" as const })), statLines: reading(detail.a).statLines, decisions: [] as ArbiterDecision[], arbiterUse: { plays: reading(detail.a).plays.length, arbitrated: 0 } };
  if (!detail.a.ok) return { plays: reading(detail.b).plays.map((play) => ({ ...play, readers: "only_b" as const })), statLines: reading(detail.b).statLines, decisions: [] as ArbiterDecision[], arbiterUse: { plays: reading(detail.b).plays.length, arbitrated: 0 } };
  return mergeReaders(request, reading(detail.a), reading(detail.b), arbitrate, rules);
}

/** The arbiter's "1" or "2" put back as the reader it was. */
export function pickOf(answer: string, first: "a" | "b"): ArbiterPick | null {
  if (answer === "both_agree_parts") return "parts";
  if (answer === "neither") return "neither";
  if (answer === "1") return first;
  if (answer === "2") return first === "a" ? "b" : "a";
  return null;
}
