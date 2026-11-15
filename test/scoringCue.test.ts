import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { playerKey } from "@/lib/cards/playerKey";
import type { DeepgramResults, DeepgramWord } from "@/lib/deepgram/config";
import { ScoringCue, type ScoringOutcome } from "@/lib/game/scoringCue";
import { toDeepgramResults, type ResultRecord } from "@/lib/log/records";
import { SpotterEngine, type SpotOutcome } from "@/lib/matching/SpotterEngine";
import { logRecords } from "@/lib/replay/cardEquality";
import { buildGameWatchlist, type GamePlayer } from "@/lib/rosters/buildWatchlist";
import { spokenForms } from "@/lib/rosters/spokenForms";
import { isSport, type Sport } from "@/lib/rosters/types";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// Scoring keywords (Nov 15) through the real engine: the engine decides which
// card is up, and lib/game/scoringCue.ts only says what it leads with. Results
// are built the way test/jerseyMatching.test.ts builds them (a word every
// 0.3 s), and fed to one engine and one listener, as the live screen does.
// Made-up players throughout.
// =============================================================================

const player = (jersey: string | null, last_name: string): GamePlayer => ({ jersey, last_name, spoken_forms: spokenForms(last_name) });

const HOME = [player("9", "Smith"), player("7", "Jones"), player("3", "Okafor")];
const AWAY = [player("5", "Hayes"), player("14", "Brennan")];
const watchlist = buildGameWatchlist(HOME, AWAY).entries;

function words(transcript: string, from: number): DeepgramWord[] {
  return transcript.split(/\s+/).map((word, i) => ({ word, start: from + i * 0.3, end: from + i * 0.3 + 0.25, confidence: 0.99 }));
}

function results(transcript: string, from: number, isFinal: boolean): DeepgramResults {
  const spoken = words(transcript, from);
  return {
    type: "Results",
    is_final: isFinal,
    speech_final: isFinal,
    start: from,
    duration: spoken.length * 0.3,
    channel: { alternatives: [{ transcript, confidence: 0.99, words: spoken }] },
  };
}

/** One game: an engine and the listener beside it, fed in order, as LiveScreen.handleResults does. */
function game(sport: Sport = "ice_hockey", entries: WatchlistEntry[] = watchlist) {
  const engine = new SpotterEngine(entries, { sport, teamCues: [] });
  const cue = new ScoringCue(sport, entries);
  const byName = (last: string) => entries.flatMap((entry) => entry.players ?? []).find((each) => each.last_name === last)!;
  return {
    cue,
    view: (last: string) => cue.viewOf(byName(last)),
    /** `from`: when the words start, in seconds of audio; the engine's clock follows it. */
    say(transcript: string, from = 10, isFinal = true): { outcome: SpotOutcome; scoring: ScoringOutcome; cards: string[] } {
      const heard = results(transcript, from, isFinal);
      const outcome = engine.process(heard, 1, from * 1000, 1_700_000_000_000 + from * 1000);
      const scoring = cue.heard(heard, 1, outcome.rows);
      return { outcome, scoring, cards: (outcome.display?.players ?? []).map((each) => each.last_name) };
    },
  };
}

describe("a scoring word before the name", () => {
  it('"goal smith": Smith goes up leading with his scoring numbers', () => {
    const g = game();
    const { cards, scoring } = g.say("goal smith");
    expect(cards).toEqual(["Smith"]);
    expect(g.view("Smith")).toBe("scoring");
    expect(scoring.events).toMatchObject([{ word: "goal", where: "before", reverted: false }]);
  });

  it('"goal scored by number 9 smith": counted from the number\'s cue, not the surname', () => {
    const g = game();
    expect(g.say("goal scored by number 9 smith").cards).toEqual(["Smith"]);
    expect(g.view("Smith")).toBe("scoring");
  });

  it('"assisted by jones": Jones, on the two-word phrase', () => {
    const g = game();
    const { cards, scoring } = g.say("assisted by jones");
    expect(cards).toEqual(["Jones"]);
    expect(g.view("Jones")).toBe("scoring");
    expect(scoring.events.map((event) => event.word)).toEqual(["assisted by"]);
  });

  it('"goal smith assisted by jones": a word that fits two names turns both', () => {
    const g = game();
    g.say("goal smith assisted by jones");
    expect(g.view("Smith")).toBe("scoring");
    expect(g.view("Jones")).toBe("scoring");
  });

  it("counts only within three words of the name", () => {
    const g = game();
    g.say("goal and what a play that was by smith");
    expect(g.view("Smith")).toBe("facts");
  });
});

describe("a scoring word after the name", () => {
  it('"smith shoots scores": facts first, then scoring, on the same card, as the interims grow', () => {
    const g = game();
    const first = g.say("smith shoots", 10, false);
    expect(first.cards).toEqual(["Smith"]);
    expect(g.view("Smith")).toBe("facts");
    const second = g.say("smith shoots scores", 10, false);
    // No new card: the engine already has Smith up, and this only turns it.
    expect(second.outcome.display).toBeUndefined();
    expect(second.scoring.changes.map((change) => [change.player.last_name, change.view])).toEqual([["Smith", "scoring"]]);
    g.say("smith shoots scores", 10, true);
    expect(g.view("Smith")).toBe("scoring");
  });

  it("in a later result, within three seconds of the name", () => {
    const g = game();
    g.say("smith shoots", 10);
    g.say("he scores", 11.5);
    expect(g.view("Smith")).toBe("scoring");
  });

  it("not once three seconds have passed", () => {
    const g = game();
    g.say("smith shoots", 10);
    g.say("and later on somebody scores", 14);
    expect(g.view("Smith")).toBe("facts");
  });
});

describe("no scoring word", () => {
  it('"smith" alone leads with the facts', () => {
    const g = game();
    expect(g.say("smith").cards).toEqual(["Smith"]);
    expect(g.view("Smith")).toBe("facts");
  });

  for (const said of ["no goal smith", "goalkeeper smith", "goalie smith", "the score is 2 1 smith", "goal kick smith"]) {
    it(`"${said}" is not a score`, () => {
      const g = game();
      g.say(said);
      expect(g.view("Smith")).toBe("facts");
    });
  }

  it("a card stays in the scoring view until its player is spotted again with no scoring word", () => {
    const g = game();
    g.say("goal smith", 10);
    g.say("hayes brings it up", 20);
    expect(g.view("Smith")).toBe("scoring");
    g.say("smith with the puck", 30);
    expect(g.view("Smith")).toBe("facts");
  });
});

describe("a final that takes the word back", () => {
  it("interim has scores, the final does not: the card goes back to its facts, and the log says so", () => {
    const g = game();
    g.say("smith scores", 10, false);
    expect(g.view("Smith")).toBe("scoring");
    const final = g.say("smith shoots", 10, true);
    expect(g.view("Smith")).toBe("facts");
    expect(final.scoring.changes.map((change) => change.view)).toEqual(["facts"]);
    expect(final.scoring.events).toMatchObject([{ word: "scores", where: "after", reverted: true }]);
  });
});

describe("repeats the engine holds back", () => {
  it("a scoring word with a repeat turns the card already up", () => {
    const g = game();
    g.say("smith", 10);
    const again = g.say("smith scores", 12);
    expect(again.outcome.display).toBeUndefined();
    expect(again.outcome.rows.some((row) => row.type === "repeat")).toBe(true);
    expect(g.view("Smith")).toBe("scoring");
  });

  it("a repeat with no scoring word leaves a scoring card as it is", () => {
    const g = game();
    g.say("goal smith", 10);
    g.say("smith", 12);
    expect(g.view("Smith")).toBe("scoring");
  });
});

describe("S", () => {
  it("turns the card either way, until the player is next spotted", () => {
    const g = game();
    g.say("smith", 10);
    const smith = HOME_PLAYER("Smith");
    expect(g.cue.toggle(smith)).toEqual({ player: smith, view: "scoring" });
    expect(g.view("Smith")).toBe("scoring");
    expect(g.cue.toggle(smith)?.view).toBe("facts");
    g.cue.toggle(smith);
    g.say("smith again", 20);
    expect(g.view("Smith")).toBe("facts");
  });
});

describe("a sport with no scoring words", () => {
  it("basketball: nothing is listened for, nothing changes, and S is not a key", () => {
    const g = game("basketball");
    const { scoring } = g.say("goal smith scores");
    expect(g.cue.on).toBe(false);
    expect(scoring).toEqual({ changes: [], events: [] });
    expect(g.view("Smith")).toBe("facts");
    expect(g.cue.toggle(HOME_PLAYER("Smith"))).toBeNull();
  });
});

function HOME_PLAYER(last: string): WatchlistPlayer {
  return watchlist.flatMap((entry) => entry.players ?? []).find((each) => each.last_name === last)!;
}

// =============================================================================
// The hard rule: listening for scoring words never changes which cards
// appear, when, or who they are. The same calls go to an engine alone and to
// an engine with the listener beside it, and every card frame must match.
// =============================================================================

type Frame = { at: number; cards: string[] };

function framesOf(calls: Array<[string, number, boolean]>, sport: Sport, withCue: boolean, entries = watchlist): Frame[] {
  const engine = new SpotterEngine(entries, { sport, teamCues: [] });
  const cue = withCue ? new ScoringCue(sport, entries) : null;
  const frames: Frame[] = [];
  for (const [said, from, isFinal] of calls) {
    const heard = results(said, from, isFinal);
    const outcome = engine.process(heard, 1, from * 1000, 1_700_000_000_000 + from * 1000);
    cue?.heard(heard, 1, outcome.rows);
    if (outcome.display) frames.push({ at: from, cards: outcome.display.players.map((each) => playerKey(each)) });
  }
  return frames;
}

const CALLS: Array<[string, number, boolean]> = [
  ["goal smith", 10, true],
  ["smith shoots", 20, false],
  ["smith shoots scores", 20, false],
  ["smith shoots scores", 20, true],
  ["assisted by jones", 30, true],
  ["goal scored by number 9 smith", 40, true],
  ["no goal smith", 50, true],
  ["goalkeeper hayes makes the save", 60, true],
  ["the score is 2 1 brennan", 70, true],
  ["smith scores", 80, false],
  ["smith shoots", 80, true],
  ["number 7 jones with the goal", 90, true],
  ["okafor to hayes and he scores", 100, true],
  ["jones", 101, true],
  ["jones scores again", 102, true],
];

describe("cards with scoring words heard and without (hard rule 1)", () => {
  for (const sport of ["ice_hockey", "soccer", "football", "volleyball", "basketball"] as const) {
    it(`${sport}: the same cards, at the same moments, for the same players`, () => {
      const off = framesOf(CALLS, sport, false);
      const on = framesOf(CALLS, sport, true);
      expect(off.length).toBeGreaterThan(5);
      expect(on).toEqual(off);
    });
  }

  it("the synthetic G5 game, as football and again as soccer: every frame the same", () => {
    const records = logRecords(JSON.parse(readFileSync(new URL("./fixtures/g5-synthetic-log.json", import.meta.url), "utf8")));
    for (const asSport of [null, "soccer", "ice_hockey"] as const) {
      const run = (withCue: boolean) => {
        let engine: SpotterEngine | null = null;
        let cue: ScoringCue | null = null;
        const frames: Array<{ index: number; cards: string[] }> = [];
        records.forEach((record, index) => {
          if (record.kind === "game") {
            const snapshot = record.snapshot as { watchlist?: WatchlistEntry[]; sport?: string; teamCues?: [] };
            const entries = snapshot.watchlist ?? [];
            const sport = asSport ?? (isSport(snapshot.sport) ? snapshot.sport : null);
            engine = new SpotterEngine(entries, { sport, teamCues: snapshot.teamCues ?? [] });
            cue = withCue ? new ScoringCue(sport, entries) : null;
            return;
          }
          if (record.kind !== "result" || !engine) return;
          const heard = toDeepgramResults(record as unknown as ResultRecord);
          const at = typeof record.at === "number" ? record.at : 0;
          const connectionId = typeof record.connectionId === "number" ? record.connectionId : 1;
          const outcome = (engine as SpotterEngine).process(heard, connectionId, at, at);
          (cue as ScoringCue | null)?.heard(heard, connectionId, outcome.rows);
          if (outcome.display) frames.push({ index, cards: outcome.display.players.map((each) => playerKey(each)) });
        });
        return frames;
      };
      const off = run(false);
      expect(off.length).toBeGreaterThan(0);
      expect(run(true)).toEqual(off);
    }
  });
});
