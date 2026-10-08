// =============================================================================
// Is the sound reaching Deepgram loud enough to transcribe? (testrun, Oct 3)
//
// The level meter shows the mic, and a TV across the room can sit in its green
// at -40 dB while Deepgram takes nearly all of it for silence. This watches the
// worklet's once-a-second report (the loudest recent speech, plus the boost)
// and says when speech has stayed too quiet even after the boost. Silence is
// not "too quiet": nothing playing is the meter's own "no signal" warning.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Speech that still reaches Deepgram below this, after the boost, is too quiet. */
export const TOO_QUIET_DB = -35;

/** Below this before the boost, nothing is playing at all. */
export const SILENT_DB = -57;

/** Seconds too quiet before saying so, and seconds loud enough before clearing it. */
export const QUIET_FOR_S = 10;
export const CLEAR_AFTER_S = 3;

// =============================================================================

export interface LevelReport {
  speechDb: number;
  gainDb: number;
}

/** Feed it each report with its time in ms; it answers whether to show the warning. */
export class QuietWatch {
  private quietSince: number | null = null;
  private loudSince: number | null = null;
  private warning = false;

  update(level: LevelReport, at: number): boolean {
    const playing = level.speechDb > SILENT_DB;
    const quiet = playing && level.speechDb + level.gainDb < TOO_QUIET_DB;
    if (quiet) {
      this.loudSince = null;
      this.quietSince ??= at;
      if (at - this.quietSince >= QUIET_FOR_S * 1000) this.warning = true;
    } else {
      this.quietSince = null;
      if (playing) this.loudSince ??= at;
      if (this.warning && this.loudSince !== null && at - this.loudSince >= CLEAR_AFTER_S * 1000) this.warning = false;
    }
    return this.warning;
  }
}
