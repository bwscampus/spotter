import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { playerKey } from "@/lib/cards/playerKey";
import type { DeepgramResults, DeepgramWord } from "@/lib/deepgram/config";
import { BoothScreen, DEDUPE_MS } from "@/lib/game/boothScreen";
import { toDeepgramResults, type ResultRecord } from "@/lib/log/records";
import type { LogRow } from "@/lib/matching/matchLog";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import { firstDifference, logRecords, replayCards, type CardFrame } from "@/lib/replay/cardEquality";
import { buildGameWatchlist, buildJerseyIndex, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";
import { isSport } from "@/lib/rosters/types";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// Booth partners (Nov 15): lib/game/boothScreen.ts, the layer between each
// laptop's own engine and its cards. The engine is the real one, untouched;
// made-up players throughout.
// =============================================================================

// -----------------------------------------------------------------------------
// Rule 3: a solo game's cards are exactly what they were.
// -----------------------------------------------------------------------------

/**
 * The live screen's card path with the booth layer in it, as LiveScreen runs
 * it: every result through the engine and then the layer, every takedown
 * through the layer and then the engine. `partner` runs between results.
 */
function replayWithBooth(records: readonly Record<string, unknown>[], partner?: (screen: BoothScreen, at: number) => void): CardFrame[] {
  const frames: CardFrame[] = [];
  let engine: SpotterEngine | null = null;
  let screen: BoothScreen | null = null;
  let slotKeys = new Map<WatchlistPlayer, string>();
  const show = (players: WatchlistPlayer[], record: number, at: number, cause: CardFrame["cause"]) => {
    frames.push({ record, at, cause, cards: players.map((player) => playerKey(player)) });
  };
  records.forEach((record, index) => {
    const at = typeof record.at === "number" ? record.at : 0;
    if (record.kind === "game") {
      const snapshot = record.snapshot as { watchlist?: WatchlistEntry[]; sport?: string; teamCues?: [] };
      const watchlist = snapshot.watchlist ?? [];
      engine = new SpotterEngine(watchlist, { sport: isSport(snapshot.sport) ? snapshot.sport : null, teamCues: snapshot.teamCues ?? [] });
      screen = new BoothScreen(watchlist);
      slotKeys = new Map([...buildJerseyIndex(watchlist).byKey.values()].map((slot) => [slot.player, slot.key]));
      show([], index, at, "rosters");
      return;
    }
    if (!engine || !screen) return;
    const live = engine as SpotterEngine;
    const booth = screen as BoothScreen;
    partner?.(booth, at);
    if (record.kind === "result") {
      const heard = toDeepgramResults(record as unknown as ResultRecord);
      const connectionId = typeof record.connectionId === "number" ? record.connectionId : 1;
      const outcome = live.process(heard, connectionId, at, at);
      const step = booth.fromEngine(outcome.display?.players, outcome.rows, at);
      // The engine's own array, not a copy, whenever it handed one over.
      if (outcome.display) expect(booth.players()).toBe(outcome.display.players);
      expect(step.changed).toBe(outcome.display !== undefined);
      if (step.changed) show(booth.players(), index, at, "result");
      return;
    }
    if (record.kind === "row") {
      const row = record.row as Partial<LogRow> | undefined;
      if (row?.type !== "wrong" || row.reason !== "announcer_said_wrong") return;
      const slots = row.slots ?? [];
      const slot = booth.players().findIndex((player) => slots.includes(slotKeys.get(player) ?? ""));
      if (slot < 0) return;
      const pick = booth.takeDown(slot, at);
      expect(pick).toEqual({ engineSlot: slot });
      const outcome = live.markSlotWrong(slot, at);
      if (outcome.display) {
        booth.fromEngine(outcome.display.players, outcome.rows, at, false);
        show(booth.players(), index, at, "takedown");
      }
    }
  });
  return frames;
}

describe("a solo game (rule 3)", () => {
  const records = logRecords(JSON.parse(readFileSync(new URL("./fixtures/g5-synthetic-log.json", import.meta.url), "utf8")));

  it("puts up every card the engine puts up, in the same order, at the same moments, takedowns included", async () => {
    const before = (await replayCards(records, { stats: false })).frames;
    const after = replayWithBooth(records);
    expect(before.length).toBeGreaterThan(5);
    expect(before.some((frame) => frame.cause === "takedown")).toBe(true);
    expect(firstDifference(before, after)).toBeNull();
    expect(after).toEqual(before);
  });

  it("is the same with a partner connected who sends nothing he knows, only ids this laptop has never seen", async () => {
    const before = (await replayCards(records, { stats: false })).frames;
    const after = replayWithBooth(records, (screen, at) => {
      const step = screen.fromPartner(1, { kind: "up", ids: ["00000000-0000-4000-8000-000000000000"], views: ["facts"] }, at);
      expect(step.changed).toBe(false);
    });
    expect(after).toEqual(before);
  });

  it("hands the scoring cue's own map to the cards while no partner's card is up", () => {
    const screen = new BoothScreen([]);
    const cue = new Map();
    expect(screen.views(cue)).toBe(cue);
    expect(screen.views(undefined)).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------
// Two mics in one booth.
// -----------------------------------------------------------------------------

let nextId = 0;
const id = () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`;
const player = (jersey: string, last_name: string): GamePlayer => ({ jersey, last_name, spoken_forms: spokenForms(last_name), rosterId: id() });
const HOME = [player("9", "Smith"), player("7", "Jones"), player("3", "Okafor"), player("22", "Langan")];
const AWAY = [player("5", "Hayes"), player("14", "Brennan")];
const watchlist = buildGameWatchlist(HOME, AWAY).entries;
const byName = (last: string) => watchlist.flatMap((entry) => entry.players ?? []).find((each) => each.last_name === last)!;
const rid = (last: string) => byName(last).rosterId!;

function words(transcript: string, from: number): DeepgramWord[] {
  return transcript.split(/\s+/).map((word, i) => ({ word, start: from + i * 0.3, end: from + i * 0.3 + 0.25, confidence: 0.99 }));
}

function results(transcript: string, from: number): DeepgramResults {
  const spoken = words(transcript, from);
  return {
    type: "Results",
    is_final: true,
    speech_final: true,
    start: from,
    duration: spoken.length * 0.3,
    channel: { alternatives: [{ transcript, confidence: 0.99, words: spoken }] },
  };
}

/** One laptop: its own engine on its own mic, and the booth layer, as LiveScreen runs them. Times in ms. */
function laptop() {
  const engine = new SpotterEngine(watchlist, { sport: "football", teamCues: [] });
  const screen = new BoothScreen(watchlist);
  const markSlotWrong = vi.spyOn(engine, "markSlotWrong");
  return {
    screen,
    markSlotWrong,
    /** This laptop's mic hears `said` at `at` ms. */
    hear(said: string, at: number) {
      const outcome = engine.process(results(said, at / 1000), 1, at, at);
      return screen.fromEngine(outcome.display?.players, outcome.rows, at);
    },
    /** The partner's laptop put these players up; its event lands here at `at`. */
    partnerUp(names: string[], at: number, from: 0 | 1 | 2 = 1) {
      return screen.fromPartner(from, { kind: "up", ids: names.map(rid), views: names.map(() => "facts" as const) }, at);
    },
    /** The X key and 1 to 3, as LiveScreen.takeDown does it. */
    takeDown(slot: number, at: number) {
      const pick = screen.takeDown(slot, at);
      if (pick && "engineSlot" in pick) {
        const outcome = engine.markSlotWrong(pick.engineSlot, at);
        if (outcome.display) screen.fromEngine(outcome.display.players, outcome.rows, at, false);
        return { pick, rows: outcome.rows };
      }
      return { pick, rows: [] as LogRow[] };
    },
    cards: () => screen.players().map((each) => each.last_name),
  };
}

describe("the same player from both mics", () => {
  it("within 3 seconds is one card: the partner's first, then this mic's 2.9 s later changes nothing", () => {
    const mine = laptop();
    mine.hear("jones on the carry", 1_000);
    const first = mine.partnerUp(["Smith"], 5_000);
    expect(first.changed).toBe(true);
    expect(mine.cards()).toEqual(["Smith", "Jones"]);
    const second = mine.hear("smith with the catch", 5_000 + 2_900);
    expect(mine.cards()).toEqual(["Smith", "Jones"]);
    expect(second.notes.map((note) => note.what)).toEqual(["local_deduped"]);
    // Nothing to tell the partner: it is his card.
    expect(second.up).toEqual([]);
  });

  it("within 3 seconds the other way round: this mic first, the partner's event 2.9 s later is dropped", () => {
    const mine = laptop();
    const first = mine.hear("smith with the catch", 1_000);
    expect(first.up.map((each) => each.last_name)).toEqual(["Smith"]);
    const later = mine.partnerUp(["Smith"], 1_000 + 2_900);
    expect(later.changed).toBe(false);
    expect(later.notes.map((note) => note.what)).toEqual(["remote_deduped"]);
    expect(mine.cards()).toEqual(["Smith"]);
  });

  it("4 seconds apart is two cards' worth of events: the second goes up again, at the front", () => {
    const mine = laptop();
    mine.hear("smith with the catch", 1_000);
    mine.hear("jones on the carry", 2_000);
    expect(mine.cards()).toEqual(["Jones", "Smith"]);
    const later = mine.partnerUp(["Smith"], 1_000 + 4_000);
    expect(later.changed).toBe(true);
    expect(later.notes.map((note) => note.what)).toEqual(["remote_up"]);
    expect(mine.cards()).toEqual(["Smith", "Jones"]);
    // And 4 s after the partner's, this mic naming him again is a new card too.
    const again = mine.hear("smith again", 1_000 + 4_000 + 4_000);
    expect(again.notes).toEqual([]);
    expect(again.up.map((each) => each.last_name)).toEqual(["Smith"]);
  });

  it("the window is exactly DEDUPE_MS", () => {
    expect(DEDUPE_MS).toBe(3_000);
  });
});

describe("a partner's card on this screen", () => {
  it("goes up where a card from this mic would: newest on top, three at most", () => {
    const mine = laptop();
    mine.hear("jones on the carry", 1_000);
    mine.hear("hayes makes the stop", 2_000);
    mine.partnerUp(["Langan"], 3_000);
    expect(mine.cards()).toEqual(["Langan", "Hayes", "Jones"]);
    mine.hear("okafor in motion", 4_000);
    expect(mine.cards()).toEqual(["Okafor", "Langan", "Hayes"]);
  });

  it("taken down here is taken down here only: no engine call, no wrong match, never sent", () => {
    const mine = laptop();
    mine.hear("jones on the carry", 1_000);
    mine.partnerUp(["Langan"], 2_000);
    expect(mine.cards()).toEqual(["Langan", "Jones"]);
    const { pick, rows } = mine.takeDown(0, 3_000);
    expect(pick).toEqual({ remote: byName("Langan"), from: 1 });
    expect(mine.markSlotWrong).not.toHaveBeenCalled();
    expect(rows.filter((row) => row.type === "wrong")).toEqual([]);
    expect(mine.cards()).toEqual(["Jones"]);
  });

  it("a takedown of this mic's own card under a partner's goes to the engine at the engine's own slot", () => {
    const mine = laptop();
    mine.hear("jones on the carry", 1_000);
    mine.partnerUp(["Langan"], 2_000);
    // Jones is the second card on screen, and the first on the engine's list.
    const { pick, rows } = mine.takeDown(1, 3_000);
    expect(pick).toEqual({ engineSlot: 0 });
    expect(mine.markSlotWrong).toHaveBeenCalledWith(0, 3_000);
    expect(rows.some((row) => row.type === "wrong")).toBe(true);
    expect(mine.cards()).toEqual(["Langan"]);
  });

  it("a player both mics heard and this screen took down stays down until this mic names him again 3 s later", () => {
    const mine = laptop();
    mine.partnerUp(["Langan"], 1_000);
    mine.hear("langan up the middle", 1_500);
    expect(mine.cards()).toEqual(["Langan"]);
    mine.takeDown(0, 2_000);
    expect(mine.markSlotWrong).not.toHaveBeenCalled();
    expect(mine.cards()).toEqual([]);
    mine.hear("langan again", 2_000 + 4_500);
    expect(mine.cards()).toEqual(["Langan"]);
  });

  it("comes down when the partner's final result takes it back, and only his", () => {
    const mine = laptop();
    mine.partnerUp(["Langan"], 1_000, 1);
    mine.partnerUp(["Hayes"], 2_000, 2);
    const step = mine.screen.fromPartner(1, { kind: "down", ids: [rid("Langan"), rid("Hayes")] }, 2_500);
    expect(step.changed).toBe(true);
    expect(mine.cards()).toEqual(["Hayes"]);
  });

  it("turns with the view the partner's mic chose", () => {
    const mine = laptop();
    mine.screen.fromPartner(1, { kind: "up", ids: [rid("Smith")], views: ["scoring"] }, 1_000);
    const views = mine.screen.views(new Map());
    expect(views.get(byName("Smith"))).toBe("scoring");
    const turned = mine.screen.fromPartner(1, { kind: "view", ids: [rid("Smith")], view: "facts" }, 1_500);
    expect(turned.turns).toEqual([{ player: byName("Smith"), view: "facts" }]);
  });

  it("an id this laptop does not know is noted and skipped", () => {
    const mine = laptop();
    const step = mine.screen.fromPartner(2, { kind: "up", ids: ["00000000-0000-4000-8000-999999999999"], views: ["facts"] }, 1_000);
    expect(step.changed).toBe(false);
    expect(step.notes).toEqual([{ what: "remote_unknown", from: 2 }]);
  });
});

describe("what this mic tells the partners", () => {
  it("players it put up, by roster id, and not the card a fourth one pushed off", () => {
    const mine = laptop();
    mine.hear("smith", 1_000);
    mine.hear("jones", 5_000);
    mine.hear("okafor", 9_000);
    const step = mine.hear("hayes", 13_000);
    expect(step.up.map((each) => each.last_name)).toEqual(["Hayes"]);
    expect(step.down).toEqual([]);
    expect(mine.screen.idsOf(step.up)).toEqual([rid("Hayes")]);
  });

  it("never a takedown", () => {
    const mine = laptop();
    mine.hear("smith", 1_000);
    const outcome = mine.screen.fromEngine([], [], 2_000, false);
    expect(outcome.down).toEqual([]);
    expect(outcome.up).toEqual([]);
  });
});

describe("a dropped connection", () => {
  it("never holds up this mic's cards, and the partner's merge again once it is back", () => {
    const mine = laptop();
    // Connected: the partner's card arrives.
    mine.partnerUp(["Langan"], 1_000);
    // Dropped: nothing arrives for a while; this mic's own cards go up at once all the same.
    const own = mine.hear("jones on the carry", 2_000);
    expect(own.changed).toBe(true);
    expect(mine.cards()).toEqual(["Jones", "Langan"]);
    mine.hear("hayes", 6_000);
    expect(mine.cards()).toEqual(["Hayes", "Jones", "Langan"]);
    // Back: the next event merges as before.
    mine.partnerUp(["Brennan"], 9_000);
    expect(mine.cards()).toEqual(["Brennan", "Hayes", "Jones"]);
  });
});
