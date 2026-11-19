import type { DeepgramResults } from "@/lib/deepgram/config";
import { assembleGame } from "@/lib/game/buildGame";
import { buildTeamCues } from "@/lib/game/teamCues";
import { SpotterEngine } from "@/lib/matching/SpotterEngine";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";
import { DEMO_AWAY, DEMO_HOME, DEMO_PLAYER_ROWS } from "./footballDemo";

// =============================================================================
// The public demo's game, built in the browser with no fetch, no mic and no
// spend (Nov 19). It runs the same pieces a real game does: assembleGame (the
// cards through toCardPlayer), buildTeamCues, and the real SpotterEngine,
// unchanged. A line of play-by-play goes in as one final Deepgram result.
// =============================================================================

/** One said line as a final Deepgram result, the shape the live socket delivers. */
export function resultsFor(said: string, startSeconds: number): DeepgramResults {
  const words = said
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word, index) => ({ word, start: startSeconds + index * 0.3, end: startSeconds + index * 0.3 + 0.25, confidence: 0.99 }));
  return {
    type: "Results",
    is_final: true,
    speech_final: true,
    start: startSeconds,
    duration: words.length * 0.3,
    channel: { alternatives: [{ transcript: words.map((word) => word.word).join(" "), confidence: 0.99, words }] },
  };
}

const ONES: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/**
 * What a visitor typed or the browser heard, the way the live socket writes
 * it: lowercase, no punctuation, "#22" as "number 22", and number words as
 * digits ("twenty two" is 22, "number nine" is "number 9").
 */
export function asSaid(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/#\s*(\d+)/g, " number $1 ")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const out: string[] = [];
  for (let at = 0; at < words.length; at++) {
    const word = words[at];
    if (word in TENS) {
      const next = words[at + 1];
      if (next !== undefined && next in ONES && ONES[next] > 0) {
        out.push(String(TENS[word] + ONES[next]));
        at++;
      } else out.push(String(TENS[word]));
    } else if (word in TEENS) out.push(String(TEENS[word]));
    else if (word in ONES && word !== "oh") out.push(String(ONES[word]));
    else out.push(word);
  }
  return out.join(" ");
}

export interface DemoGame {
  watchlist: WatchlistEntry[];
  /** Every player a card can show, for the roster lists and prepare(). */
  players: WatchlistPlayer[];
  home: { name: string; mascot: string; color: string };
  away: { name: string; mascot: string; color: string };
}

/** The demo's two teams as a game, through the same assembly a saved game takes. */
export function buildDemoGame(): DemoGame {
  const assembled = assembleGame(DEMO_HOME, DEMO_AWAY, DEMO_PLAYER_ROWS);
  const watchlist = assembled.watchlist.entries;
  return {
    watchlist,
    players: watchlist.flatMap((entry) => entry.players ?? []),
    home: { name: DEMO_HOME.school, mascot: DEMO_HOME.mascot ?? "", color: DEMO_HOME.primary_color ?? "#111111" },
    away: { name: DEMO_AWAY.school, mascot: DEMO_AWAY.mascot ?? "", color: DEMO_AWAY.primary_color ?? "#e6e6e6" },
  };
}

/** What one line did: the cards on screen now (newest first), and which of them it put up. */
export interface Heard {
  onScreen: WatchlistPlayer[];
  up: WatchlistPlayer[];
}

/**
 * The real engine, fed one said line at a time. Each line is its own final
 * result a few seconds after the last, as a booth's would be. Synchronous.
 */
export class DemoCaller {
  private readonly game: DemoGame;
  private engine: SpotterEngine;
  private seconds = 10;
  private onScreen: WatchlistPlayer[] = [];

  constructor(game: DemoGame) {
    this.game = game;
    this.engine = this.fresh();
  }

  private fresh(): SpotterEngine {
    return new SpotterEngine(this.game.watchlist, {
      sport: "football",
      teamCues: buildTeamCues(
        { school: DEMO_HOME.school, mascot: DEMO_HOME.mascot, wearing: null },
        { school: DEMO_AWAY.school, mascot: DEMO_AWAY.mascot, wearing: null },
      ),
    });
  }

  /** Start over: a new engine, nothing on screen. */
  reset(): void {
    this.engine = this.fresh();
    this.seconds = 10;
    this.onScreen = [];
  }

  say(text: string): Heard {
    const said = asSaid(text);
    if (said.length === 0) return { onScreen: this.onScreen, up: [] };
    this.seconds += 4;
    const outcome = this.engine.process(resultsFor(said, this.seconds), 1, this.seconds * 1000, Date.now());
    if (!outcome.display) return { onScreen: this.onScreen, up: [] };
    const before = new Set(this.onScreen);
    const now = outcome.display.players;
    const tokens = new Set(said.split(" "));
    // Put up by this line: new to the screen, or named or numbered again in it.
    const up = now.filter(
      (player) => !before.has(player) || tokens.has(player.last_name.toLowerCase()) || (player.jersey !== null && tokens.has(player.jersey)),
    );
    this.onScreen = now;
    return { onScreen: now, up };
  }
}
