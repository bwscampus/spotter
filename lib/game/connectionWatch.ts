import type { IdleReason } from "./idleWatch";

// =============================================================================
// The silence alarm (Part 6, Oct 4). In the Indiana at Rutgers game Spotter
// heard nothing for 25 minutes and 34 seconds, lost 20 plays, and the export
// had no record of what happened. This watches the connection while the mic
// is on and says when it is broken, as against merely quiet: a quiet booth is
// normal and never sets it off.
//
// Pure: the live screen feeds it what it knows once a second (and on every
// state change) with the clock, and acts on what comes back: the red bar, one
// tone, a reconnect with a fresh token (the mic first when the mic is the
// problem), and a `connection` record in the browser log for every event.
//
// Oct 6: one alarm per outage. When Deepgram dropped in the Chiefs game the
// alarm went up 78 times in about 30 seconds, every one "attempt 1", because
// each words-arrived or mic-restart took it down and the next tick put it
// back. Now an outage raises once, retries with a doubling wait and a
// numbered attempt, survives the mic restart it asks for, and ends only after
// words have been arriving for HEARING_AGAIN_MS.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** Sound at speech level this long, with no words for WORDS_TIMEOUT_MS, means the connection is broken. */
export const SPEECH_FOR_MS = 10_000;

/** No Deepgram result with words for this long, while speech-level sound is reaching the mic. */
export const WORDS_TIMEOUT_MS = 20_000;

/**
 * Speech level, on the worklet's once-a-second report of the loudest recent
 * speech before any boost. Silence is -60 and a TV across the room sits near
 * -40; the too-quiet warning (lib/audio/quietWatch.ts) is about -35 after
 * the boost. Below this line the room is quiet, not broken.
 */
export const SPEECH_LEVEL_DB = -45;

/** The level meter normally reports every second. This long without one and the mic has stopped. */
export const METER_STALL_MS = 5_000;

/** The socket closed and has not come back in this long. */
export const SOCKET_CLOSED_MS = 10_000;

/** The page's own clock jumped by more than this: the laptop slept or the tab was frozen. */
export const TIMER_JUMP_MS = 30_000;

/**
 * How long to wait between reconnect attempts while the alarm stays up (Oct 6:
 * one dropped connection set the alarm off 78 times in 30 seconds, every one
 * "attempt 1"). Doubling from a second, capped at 30; the last one repeats.
 */
export const RETRY_WAITS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/** The outage ends only after words have been arriving for this long: a result with words this long after the first one back. */
export const HEARING_AGAIN_MS = 3_000;

/**
 * A socket that closes this many times inside FLAP_WINDOW_MS is broken even
 * though it keeps reopening: one close is a blip the stream reconnects from
 * in about a second, three in ten seconds is a connection that will not hold.
 */
export const FLAP_CLOSES = 3;
export const FLAP_WINDOW_MS = 10_000;

/**
 * The mic going off and on again inside this long (the alarm's own mic
 * restart does exactly that) is the same outage, not a new one.
 */
export const RESTART_GRACE_MS = 15_000;

// =============================================================================

export type ConnectionEventKind =
  | "socket_open"
  | "socket_closed"
  | "reconnect"
  | "mic_ended"
  | "mic_muted"
  | "mic_unmuted"
  | "tab_hidden"
  | "tab_visible"
  | "wakelock_lost"
  | "wakelock_regained"
  | "alarm_on"
  | "alarm_off"
  | "timer_jump"
  /** Listening stopped on its own: no words for a long while, or too long since Listen (lib/game/idleWatch.ts). */
  | "idle_stop";

export type AlarmReason = "no_words" | "mic_ended" | "mic_muted" | "meter_stalled" | "socket_closed" | "timer_jump";

/** What the red bar says for each reason. */
export const ALARM_WORDS: Record<AlarmReason, string> = {
  no_words: "sound is reaching the mic but no words are coming back",
  mic_ended: "the mic stopped",
  mic_muted: "the mic is muted",
  meter_stalled: "the level meter stopped",
  socket_closed: "the speech recognition connection is closed",
  timer_jump: "the page was asleep or frozen",
};

/** One thing that happened, as the browser log records it (lib/log/records.ts adds the game and the time). */
export interface ConnectionEvent {
  event: ConnectionEventKind;
  /** The socket's close code, on socket_closed. */
  code?: number;
  /** Which attempt, on reconnect. */
  attempt?: number;
  /** How far the clock jumped, on timer_jump. */
  ms?: number;
  /** Why, on alarm_on and reconnect. */
  reason?: AlarmReason;
  /** Why, on idle_stop. */
  idle?: IdleReason;
}

export interface WatchInput {
  /** The mic is on: the screen is trying to hear. Nothing is watched otherwise. */
  listening: boolean;
  /** When the last Deepgram result with words arrived, wall clock ms. */
  lastWordsAt: number | null;
  /** When the worklet last reported a level. */
  lastLevelAt: number | null;
  /** That report's loudest recent speech before any boost, dB. */
  speechDb: number | null;
  /** The mic track ended (the hook reports an error). */
  micEnded: boolean;
  micMuted: boolean;
  socketOpen: boolean;
  /** The close code the socket reported, while it is not open, when known. */
  socketCode: number | null;
  /** The tab is hidden. */
  hidden: boolean;
  wakeLockHeld: boolean;
}

export interface Alarm {
  reason: AlarmReason;
  since: number;
}

export interface Reconnect {
  /** Re-open the mic first; the socket follows from the new mic graph. */
  micFirst: boolean;
  attempt: number;
}

export interface WatchOutput {
  alarm: Alarm | null;
  /** The alarm went up on this update: play the tone. */
  raised: boolean;
  /** The alarm came down on this update. */
  cleared: boolean;
  /** Reconnect now, or null. */
  reconnect: Reconnect | null;
  events: ConnectionEvent[];
}

const MIC_REASONS = new Set<AlarmReason>(["mic_ended", "mic_muted", "meter_stalled"]);

/** One outage: raised once, retried with a growing wait, over once words have been arriving for HEARING_AGAIN_MS. */
interface Outage {
  alarm: Alarm;
  attempt: number;
  lastRetryAt: number;
  /** When the first words came back during this outage; null until then, and again if the socket drops. */
  wordsSince: number | null;
}

export class ConnectionWatch {
  private previous: WatchInput | null = null;
  private lastNow: number | null = null;
  private listeningSince: number | null = null;
  /** When listening stopped, while an outage is held for RESTART_GRACE_MS. */
  private stoppedAt: number | null = null;
  private speechSince: number | null = null;
  private socketClosedSince: number | null = null;
  private closes: number[] = [];
  private wakeLockLost = false;
  private outage: Outage | null = null;

  /** Feed it the state and the clock; it says what to do. */
  update(input: WatchInput, now: number): WatchOutput {
    const events: ConnectionEvent[] = [];
    const previous = this.previous;
    this.previous = input;

    // What changed since last time, for the record.
    if (previous) {
      if (!previous.socketOpen && input.socketOpen) events.push({ event: "socket_open" });
      if (previous.socketOpen && !input.socketOpen) {
        events.push({ event: "socket_closed", ...(input.socketCode !== null ? { code: input.socketCode } : {}) });
        this.closes.push(now);
      }
      if (!previous.micEnded && input.micEnded) events.push({ event: "mic_ended" });
      if (!previous.micMuted && input.micMuted) events.push({ event: "mic_muted" });
      if (previous.micMuted && !input.micMuted) events.push({ event: "mic_unmuted" });
      if (!previous.hidden && input.hidden) events.push({ event: "tab_hidden" });
      if (previous.hidden && !input.hidden) events.push({ event: "tab_visible" });
      if (previous.wakeLockHeld && !input.wakeLockHeld && input.listening) {
        this.wakeLockLost = true;
        events.push({ event: "wakelock_lost" });
      }
      if (!previous.wakeLockHeld && input.wakeLockHeld && this.wakeLockLost) {
        this.wakeLockLost = false;
        events.push({ event: "wakelock_regained" });
      }
    }
    this.closes = this.closes.filter((at) => now - at < FLAP_WINDOW_MS);

    // The page's own clock jumped: the laptop slept or the tab was frozen. Not
    // while the tab is hidden, or on the first look after it shows again: a
    // browser slows a hidden tab's timers to about one a minute, which is a
    // jump that means nothing.
    const throttled = input.hidden || (previous?.hidden ?? false);
    const jumped = input.listening && !throttled && this.lastNow !== null && now - this.lastNow > TIMER_JUMP_MS;
    if (jumped) events.push({ event: "timer_jump", ms: now - (this.lastNow ?? now) });
    this.lastNow = now;

    if (!input.listening) {
      // The bar comes down while nobody is trying to hear. An outage is held a
      // little while, so the mic restart the alarm itself asks for continues it.
      this.listeningSince = null;
      this.speechSince = null;
      this.socketClosedSince = null;
      const wasShowing = this.outage !== null && this.stoppedAt === null;
      if (this.outage) {
        this.stoppedAt ??= now;
        if (now - this.stoppedAt >= RESTART_GRACE_MS) {
          this.outage = null;
          this.stoppedAt = null;
        }
      }
      return { alarm: null, raised: false, cleared: wasShowing, reconnect: null, events };
    }
    if (this.stoppedAt !== null && now - this.stoppedAt >= RESTART_GRACE_MS) this.outage = null;
    this.stoppedAt = null;
    this.listeningSince ??= now;

    // Speech-level sound, for as long as it has been there.
    const meterLive = input.lastLevelAt !== null && now - input.lastLevelAt < METER_STALL_MS;
    const speech = meterLive && input.speechDb !== null && input.speechDb >= SPEECH_LEVEL_DB;
    if (speech) this.speechSince ??= now;
    else this.speechSince = null;

    if (input.socketOpen) this.socketClosedSince = null;
    else this.socketClosedSince ??= now;

    // Words count from this stretch of listening, not from the last game. The
    // meter too: a mic that just restarted has not reported yet.
    const wordsAt = Math.max(input.lastWordsAt ?? 0, this.listeningSince);
    const meterStalled = input.lastLevelAt !== null && now - Math.max(input.lastLevelAt, this.listeningSince) >= METER_STALL_MS;
    const socketBroken =
      (this.socketClosedSince !== null && now - this.socketClosedSince >= SOCKET_CLOSED_MS) || this.closes.length >= FLAP_CLOSES;
    const reason: AlarmReason | null = jumped
      ? "timer_jump"
      : input.micEnded
        ? "mic_ended"
        : input.micMuted
          ? "mic_muted"
          : meterStalled
            ? "meter_stalled"
            : socketBroken
              ? "socket_closed"
              : this.speechSince !== null && now - this.speechSince >= SPEECH_FOR_MS && now - wordsAt >= WORDS_TIMEOUT_MS
                ? "no_words"
                : null;

    let raised = false;
    let cleared = false;
    let reconnect: Reconnect | null = null;
    const outage = this.outage;

    if (outage === null) {
      if (reason !== null) {
        // One alarm per outage: one bar, one tone, one alarm_on.
        this.outage = { alarm: { reason, since: now }, attempt: 1, lastRetryAt: now, wordsSince: null };
        raised = true;
        events.push({ event: "alarm_on", reason });
        reconnect = { micFirst: MIC_REASONS.has(reason), attempt: 1 };
        events.push({ event: "reconnect", attempt: 1, reason });
      }
    } else {
      // Words back: the outage is over once they have kept arriving for HEARING_AGAIN_MS.
      if (!input.socketOpen) outage.wordsSince = null;
      else if (input.lastWordsAt !== null && input.lastWordsAt > outage.alarm.since) outage.wordsSince ??= input.lastWordsAt;
      if (outage.wordsSince !== null && input.lastWordsAt !== null && input.lastWordsAt - outage.wordsSince >= HEARING_AGAIN_MS) {
        this.outage = null;
        cleared = true;
        events.push({ event: "alarm_off" });
      } else if (outage.wordsSince === null && reason !== null) {
        // Still broken: try again after a growing wait, the mic first when it is the problem now.
        const wait = RETRY_WAITS_MS[Math.min(outage.attempt - 1, RETRY_WAITS_MS.length - 1)];
        if (now - outage.lastRetryAt >= wait) {
          outage.attempt += 1;
          outage.lastRetryAt = now;
          reconnect = { micFirst: MIC_REASONS.has(reason), attempt: outage.attempt };
          events.push({ event: "reconnect", attempt: outage.attempt, reason });
        }
      }
    }

    return { alarm: this.outage?.alarm ?? null, raised, cleared, reconnect, events };
  }

  /** Forget everything, for a new game. */
  reset() {
    this.previous = null;
    this.lastNow = null;
    this.listeningSince = null;
    this.stoppedAt = null;
    this.speechSince = null;
    this.socketClosedSince = null;
    this.closes = [];
    this.wakeLockLost = false;
    this.outage = null;
  }
}
