import type { CardLines } from "@/lib/cards/lines";
import { playerKey } from "@/lib/cards/playerKey";
import { chipsForCards, linesForCards, playersByKey } from "@/lib/game/statLines";
import type { GameSnapshot } from "@/lib/game/snapshot";
import { StatsController, type ExtractReply } from "@/lib/livestats/controller";
import { rosterFromWatchlist } from "@/lib/livestats/roster";
import { waiting } from "@/lib/livestats/session";
import { NO_USAGE, type ExtractStatsRequest, type StatsPlay, type StatsRosterPlayer } from "@/lib/livestats/types";
import { toDeepgramResults, type ResultRecord } from "@/lib/log/records";
import type { LogRow } from "@/lib/matching/matchLog";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import { buildJerseyIndex } from "@/lib/rosters/buildWatchlist";
import { isSport } from "@/lib/rosters/types";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// G5, replay equality (docs/V3_DEFINITION.md section 4): one saved log goes
// through the card path twice, once with live stats off and once with them
// on, and the cards shown must be identical. Who went up, in what order, and
// when, frame for frame.
//
// The card path here is the real one: SpotterEngine.process on every result
// the log recorded, interims included, and markSlotWrong wherever the
// announcer took a card down. With stats on, the real stats loop
// (lib/livestats/controller.ts) runs beside it as it does in a game: it hears
// every final, asks on the live cadence, every play it reads is OK'd (and some
// taken back with U and OK'd again), and tonight's lines reach the cards
// already up through the same mapping the live screen uses
// (lib/game/statLines.ts). The only stand-in is Claude: a fake that credits a
// carry to a surname it hears, because what Claude says is not what this
// checks. Nothing goes to the network and nothing is written anywhere.
//
// Run on a real log with `npm run check:cards -- <log.json>`, and on a
// committed synthetic log by test/cardEquality.test.ts.
// =============================================================================

/** One write to the cards: who is up after it, newest first, by playerKey. */
export interface CardFrame {
  /** Which record in the log caused it. */
  record: number;
  at: number;
  cause: "result" | "takedown" | "rosters";
  cards: string[];
}

export interface StatsReplaySummary {
  calls: number;
  playsRead: number;
  oks: number;
  undos: number;
  /** Times tonight's lines were rewritten on the cards already up. */
  restats: number;
  /** Cards put up already carrying tonight's lines. */
  cardsWithTonight: number;
  /** Stat lines rewritten on a card already up. */
  linesRewritten: number;
}

export interface CardReplay {
  frames: CardFrame[];
  /** Takedowns in the log the replay could not place on a card (a game saved before cards existed). */
  unplacedTakedowns: number;
  stats: StatsReplaySummary | null;
}

export interface CardEquality {
  equal: boolean;
  frames: number;
  /** The first frame that differs, when one does. */
  difference: { index: number; off: CardFrame | null; on: CardFrame | null } | null;
  off: CardReplay;
  on: CardReplay;
}

export class CardLogError extends Error {}

type Extract = (request: ExtractStatsRequest) => Promise<ExtractReply>;

/** Every record in a downloaded .json log, in order. Throws CardLogError on anything else. */
export function logRecords(raw: unknown): readonly Record<string, unknown>[] {
  const file = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  if (!file || file.format !== "spotter-v3-log") throw new CardLogError("This is not a Spotter V3 log.");
  if (file.version !== 1) throw new CardLogError(`This log is version ${String(file.version)}; this reads version 1.`);
  if (!Array.isArray(file.records)) throw new CardLogError("This log has no records.");
  const records = file.records.filter(
    (record): record is Record<string, unknown> => typeof record === "object" && record !== null,
  );
  if (!records.some((record) => record.kind === "game")) throw new CardLogError("This log has no game in it.");
  if (!records.some((record) => record.kind === "result")) throw new CardLogError("This log has no results in it.");
  return records;
}

/**
 * Stands in for Claude: every call reads one carry for the first surname on
 * either roster heard in the latest line of the window that names anyone, and
 * a tackle for the first one heard there on the other side, read from that
 * one line (the stats check wants a credit named in the lines it was read
 * from). Deterministic, so both runs of a check are the same run.
 */
export async function creditNamesHeard(request: ExtractStatsRequest): Promise<ExtractReply> {
  const namesIn = (text: string) => {
    const words = new Set(text.toLowerCase().split(/[^a-z'-]+/));
    return request.rosters.filter((player) => player.last && words.has(player.last.toLowerCase()));
  };
  const last = [...request.utterances].reverse().find((said) => namesIn(said.text).length > 0);
  if (!last) return { ok: true, plays: [], usage: NO_USAGE };
  const heard = namesIn(last.text);
  const carrier = heard[0];
  const tackler = heard.find((player) => player.side !== carrier.side);
  const play: StatsPlay = {
    // One line: a play that spanned the whole window would overlap the next
    // window's and be merged into it (lib/livestats/merge.ts).
    seqStart: last.seq,
    seqEnd: last.seq,
    quarter: null,
    clock: null,
    down: null,
    distance: null,
    offense: carrier.side,
    playType: "run",
    nullified: false,
    touchdown: false,
    firstDown: false,
    confidence: 0.9,
    summary: `${carrier.last.toUpperCase()} 4 yd run`,
    evidence: last.text.split(/\s+/).slice(0, 20).join(" "),
    events: [
      { playerId: carrier.playerId, action: "rush", yards: 4, yardsSource: "stated", made: null },
      ...(tackler ? [{ playerId: tackler.playerId, action: "tackle" as const, yards: null, yardsSource: null, made: null }] : []),
    ],
  };
  return { ok: true, plays: [play], usage: { ...NO_USAGE, inputTokens: 1, outputTokens: 1 } };
}

/** Replays the log through the card path, with live stats off or on. */
export async function replayCards(
  records: readonly Record<string, unknown>[],
  options: { stats: boolean; extract?: Extract },
): Promise<CardReplay> {
  const frames: CardFrame[] = [];
  let unplacedTakedowns = 0;
  let engine: SpotterEngine | null = null;
  let slotKeys = new Map<WatchlistPlayer, string>();
  let shown: WatchlistPlayer[] = [];

  // Live stats, as the live screen and components/livestats/ put them together.
  let clock = 0;
  let byKey = new Map<string, WatchlistPlayer>();
  let cardLines: ReadonlyMap<WatchlistPlayer, CardLines> = new Map();
  const pending: Promise<unknown>[] = [];
  const summary: StatsReplaySummary = {
    calls: 0,
    playsRead: 0,
    oks: 0,
    undos: 0,
    restats: 0,
    cardsWithTonight: 0,
    linesRewritten: 0,
  };
  const extract = options.extract ?? creditNamesHeard;
  let controller: StatsController | null = null;

  const show = (players: WatchlistPlayer[], record: number, at: number, cause: CardFrame["cause"]) => {
    shown = players;
    frames.push({ record, at, cause, cards: players.map((player) => playerKey(player)) });
    // What NameDisplay.show is handed: the lines already worked out, read, never computed.
    if (controller) summary.cardsWithTonight += players.filter((player) => cardLines.has(player)).length;
  };

  if (options.stats) {
    const firstGame = records.find((record) => record.kind === "game");
    controller = new StatsController({
      gameId: typeof firstGame?.gameId === "string" ? firstGame.gameId : "replay",
      startedAt: typeof firstGame?.at === "number" ? firstGame.at : 0,
      roster: [],
      deps: {
        extract: (request) => {
          summary.calls += 1;
          const reply = extract(request).then((answer) => {
            if (answer.ok && Array.isArray(answer.plays)) summary.playsRead += answer.plays.length;
            return answer;
          });
          pending.push(reply);
          return reply;
        },
        log: () => undefined,
        readLog: async () => [],
        track: () => undefined,
        now: () => clock,
      },
    });
    await controller.start();
    const bridge = controller.bridge;
    // NameDisplay.restat: lines on the cards already up, nothing shown or hidden.
    bridge.subscribe((change) => {
      cardLines = linesForCards(bridge.lines(), byKey);
      const chips = chipsForCards(change.chips, byKey);
      summary.restats += 1;
      summary.linesRewritten += shown.filter((player) => cardLines.has(player) || chips.has(player)).length;
    });
  }

  /** Lets the stats call finish, then OKs everything in line, as an announcer keeping up would. */
  const settle = async () => {
    if (!controller) return;
    while (pending.length > 0) await pending.shift();
    // The loop's own continuation runs after the reply resolves.
    await Promise.resolve();
    await Promise.resolve();
    while (waiting(controller.getView().session).length > 0) {
      controller.bridge.key("ok");
      summary.oks += 1;
      // Every third OK is taken back with U and OK'd again, so undo runs too.
      if (summary.oks % 3 === 0) {
        controller.bridge.key("undo");
        summary.undos += 1;
        controller.bridge.key("ok");
      }
    }
  };

  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    const at = typeof record.at === "number" ? record.at : clock;
    clock = Math.max(clock, at);

    if (record.kind === "game") {
      const snapshot = record.snapshot as Partial<GameSnapshot> | undefined;
      const watchlist: WatchlistEntry[] = Array.isArray(snapshot?.watchlist) ? snapshot.watchlist : [];
      // A new watchlist is a new engine, and the screen clears (LiveScreen).
      engine = new SpotterEngine(watchlist, {
        sport: isSport(snapshot?.sport) ? snapshot.sport : null,
        teamCues: Array.isArray(snapshot?.teamCues) ? snapshot.teamCues : [],
      });
      slotKeys = new Map([...buildJerseyIndex(watchlist).byKey.values()].map((slot) => [slot.player, slot.key]));
      show([], index, at, "rosters");
      if (controller) {
        byKey = playersByKey(watchlist);
        const roster: StatsRosterPlayer[] = Array.isArray(snapshot?.statsRoster)
          ? snapshot.statsRoster
          : rosterFromWatchlist(watchlist);
        controller.setRoster(roster);
      }
      continue;
    }

    if (!engine) continue;

    if (record.kind === "result") {
      const results = toDeepgramResults(record as unknown as ResultRecord);
      const connectionId = typeof record.connectionId === "number" ? record.connectionId : 1;
      const outcome = engine.process(results, connectionId, at, at);
      if (outcome.display) show(outcome.display.players, index, at, "result");
      if (controller) {
        const text = results.channel.alternatives[0]?.transcript ?? "";
        // After paint in a game; after the card here.
        if (results.is_final && text.length > 0) controller.bridge.heard(text, at);
        // The live screen's timer, for the 30 second cadence.
        controller.tick();
        await settle();
      }
      continue;
    }

    if (record.kind === "row") {
      const row = record.row as Partial<LogRow> | undefined;
      if (row?.type !== "wrong" || row.reason !== "announcer_said_wrong") continue;
      // The card the announcer took down, found by the slot the row names.
      const slots = row.slots ?? [];
      const slot = shown.findIndex((player) => slots.includes(slotKeys.get(player) ?? ""));
      if (slot < 0) {
        unplacedTakedowns += 1;
        continue;
      }
      const outcome = engine.markSlotWrong(slot, at);
      if (outcome.display) show(outcome.display.players, index, at, "takedown");
    }
  }

  controller?.dispose();
  return { frames, unplacedTakedowns, stats: controller ? summary : null };
}

/** The G5 check: the same log, stats off and on, and whether the cards shown are identical. */
export async function checkCards(raw: unknown, options: { extract?: Extract } = {}): Promise<CardEquality> {
  const records = logRecords(raw);
  const off = await replayCards(records, { stats: false });
  const on = await replayCards(records, { stats: true, extract: options.extract });
  const difference = firstDifference(off.frames, on.frames);
  return { equal: difference === null, frames: off.frames.length, difference, off, on };
}

/** The first frame where two replays put up different cards, or null when every frame matches. */
export function firstDifference(off: readonly CardFrame[], on: readonly CardFrame[]): CardEquality["difference"] {
  const length = Math.max(off.length, on.length);
  for (let index = 0; index < length; index++) {
    const a = off[index] ?? null;
    const b = on[index] ?? null;
    if (!a || !b || !sameFrame(a, b)) return { index, off: a, on: b };
  }
  return null;
}

function sameFrame(a: CardFrame, b: CardFrame): boolean {
  return (
    a.record === b.record &&
    a.at === b.at &&
    a.cause === b.cause &&
    a.cards.length === b.cards.length &&
    a.cards.every((card, index) => card === b.cards[index])
  );
}
