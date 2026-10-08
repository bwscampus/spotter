// =============================================================================
// The idle stop (pre-launch audit H4). A live screen left open with the mic on
// streams to speech recognition for as long as the tab lives: a laptop left in
// a press box overnight is about 12 hours of paid audio, the wake lock keeps
// it awake, and live stats keep reading whatever a TV in the room says. This
// stops listening after IDLE_QUIET_MS with no words, or MAX_LISTEN_MS after
// Listen was pressed, and the screen says so.
//
// Pure, like lib/game/connectionWatch.ts: the live screen feeds it once a
// second, after paint, and turns the mic off when it says to. Turning the mic
// off is all it takes: the socket closes with the mic graph, the wake lock is
// let go, the silence alarm comes down (it watches only while listening), and
// live stats have no new words to read.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** No result with words for this long while listening: stop. */
export const IDLE_QUIET_MS = 20 * 60_000;

/** This long since Listen was pressed: stop, words or not. */
export const MAX_LISTEN_MS = 5 * 60 * 60_000;

/**
 * The mic going off and on inside this long is the same stretch of listening:
 * the silence alarm's own mic restart does exactly that, and must not restart
 * either clock.
 */
export const SAME_STRETCH_MS = 15_000;

// =============================================================================

export type IdleReason = "quiet" | "too_long";

/** The banner, in plain words. */
export const IDLE_WORDS: Record<IdleReason, string> = {
  quiet: `Listening stopped after ${IDLE_QUIET_MS / 60_000} minutes of quiet. Press Listen to carry on.`,
  too_long: `Listening stopped after ${MAX_LISTEN_MS / 3_600_000} hours. Press Listen to carry on.`,
};

export interface IdleInput {
  /** The mic is on. */
  listening: boolean;
  /** When the last result with words arrived, wall clock ms. */
  lastWordsAt: number | null;
}

export interface IdleStop {
  reason: IdleReason;
  /** How long it was quiet, or how long it listened, in ms: for the browser log. */
  ms: number;
}

export class IdleWatch {
  private listeningSince: number | null = null;
  private stoppedAt: number | null = null;

  /** Feed it the state and the clock; it says when to stop, once. */
  update(input: IdleInput, now: number): IdleStop | null {
    if (!input.listening) {
      if (this.listeningSince !== null) {
        this.stoppedAt ??= now;
        if (now - this.stoppedAt >= SAME_STRETCH_MS) this.reset();
      }
      return null;
    }
    // Back within the grace: the same stretch, so neither clock restarts.
    this.stoppedAt = null;
    this.listeningSince ??= now;

    const listened = now - this.listeningSince;
    if (listened >= MAX_LISTEN_MS) {
      this.reset();
      return { reason: "too_long", ms: listened };
    }
    const quietSince = Math.max(input.lastWordsAt ?? 0, this.listeningSince);
    const quiet = now - quietSince;
    if (quiet >= IDLE_QUIET_MS) {
      this.reset();
      return { reason: "quiet", ms: quiet };
    }
    return null;
  }

  /** Forget everything: after a stop, and for a new game. The next Listen starts both clocks again. */
  reset() {
    this.listeningSince = null;
    this.stoppedAt = null;
  }
}
