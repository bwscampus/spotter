import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionWatch,
  FLAP_CLOSES,
  FLAP_WINDOW_MS,
  HEARING_AGAIN_MS,
  METER_STALL_MS,
  RESTART_GRACE_MS,
  RETRY_WAITS_MS,
  SOCKET_CLOSED_MS,
  SPEECH_FOR_MS,
  SPEECH_LEVEL_DB,
  TIMER_JUMP_MS,
  WORDS_TIMEOUT_MS,
  type WatchInput,
  type WatchOutput,
} from "@/lib/game/connectionWatch";

// =============================================================================
// The silence alarm (Part 6, Oct 4): for a broken connection, never for a
// quiet booth. Driven with fake timers the way the live screen drives it,
// once a second.
// =============================================================================

const START = 1_800_000_000_000;

function input(now: number, over: Partial<WatchInput> = {}): WatchInput {
  return {
    listening: true,
    lastWordsAt: null,
    lastLevelAt: now,
    speechDb: -60,
    micEnded: false,
    micMuted: false,
    socketOpen: true,
    socketCode: null,
    hidden: false,
    wakeLockHeld: true,
    ...over,
  };
}

/** Runs the watch once a second for `seconds` (the first update at once), with `describe(now)` saying what the screen sees. */
function run(watch: ConnectionWatch, seconds: number, describe: (now: number, second: number) => WatchInput): WatchOutput[] {
  const outputs: WatchOutput[] = [];
  for (let second = 0; second <= seconds; second++) {
    if (second > 0) vi.advanceTimersByTime(1000);
    const now = Date.now();
    outputs.push(watch.update(describe(now, second), now));
  }
  return outputs;
}

const firstAlarm = (outputs: WatchOutput[]) => outputs.findIndex((out) => out.raised);
const kinds = (outputs: WatchOutput[]) => outputs.flatMap((out) => out.events.map((event) => event.event));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

describe("the silence alarm", () => {
  it("fires at 20 seconds of speech-level sound with no words coming back", () => {
    const outputs = run(new ConnectionWatch(), 25, (now) => input(now, { speechDb: SPEECH_LEVEL_DB + 10 }));
    expect(firstAlarm(outputs)).toBe(WORDS_TIMEOUT_MS / 1000);
    const raised = outputs[WORDS_TIMEOUT_MS / 1000];
    expect(raised.alarm).toEqual({ reason: "no_words", since: START + WORDS_TIMEOUT_MS });
    expect(raised.reconnect).toEqual({ micFirst: false, attempt: 1 });
    expect(raised.events.map((event) => event.event)).toEqual(["alarm_on", "reconnect"]);
    // Still up a second later: no new raise, and the second attempt after the first wait.
    expect(outputs[WORDS_TIMEOUT_MS / 1000 + 1]).toMatchObject({ raised: false, reconnect: { attempt: 2 }, alarm: raised.alarm });
  });

  it("needs the sound to have been there ten seconds: sound that only just started waits", () => {
    // Quiet for 15 s, then speech: the words timeout has passed, but the speech has not been there SPEECH_FOR_MS.
    const outputs = run(new ConnectionWatch(), 30, (now, second) => input(now, { speechDb: second >= 15 ? -30 : -60 }));
    expect(firstAlarm(outputs)).toBe(15 + SPEECH_FOR_MS / 1000);
  });

  it("never fires for a silent room, however long", () => {
    const outputs = run(new ConnectionWatch(), 300, (now) => input(now, { speechDb: -60 }));
    expect(outputs.every((out) => out.alarm === null)).toBe(true);
    expect(kinds(outputs)).toEqual([]);
  });

  it("does not fire while words keep coming", () => {
    const outputs = run(new ConnectionWatch(), 120, (now) => input(now, { speechDb: -20, lastWordsAt: now - 5_000 }));
    expect(outputs.every((out) => out.alarm === null)).toBe(true);
  });

  it("fires ten seconds after the socket closed and stayed closed, recording the close code", () => {
    const outputs = run(new ConnectionWatch(), 15, (now, second) =>
      input(now, { socketOpen: second === 0, socketCode: second === 0 ? null : 1006 }),
    );
    expect(outputs[1].events).toEqual([{ event: "socket_closed", code: 1006 }]);
    expect(firstAlarm(outputs)).toBe(1 + SOCKET_CLOSED_MS / 1000);
    expect(outputs[firstAlarm(outputs)].alarm?.reason).toBe("socket_closed");
  });

  it("fires at once when the mic ended or was muted, and asks for the mic first", () => {
    const ended = run(new ConnectionWatch(), 1, (now, second) => input(now, { micEnded: second >= 1 }));
    expect(ended[1]).toMatchObject({ raised: true, alarm: { reason: "mic_ended" }, reconnect: { micFirst: true, attempt: 1 } });
    expect(kinds(ended)).toEqual(["mic_ended", "alarm_on", "reconnect"]);

    const muted = run(new ConnectionWatch(), 2, (now, second) => input(now, { micMuted: second >= 1 }));
    expect(muted[1]).toMatchObject({ raised: true, alarm: { reason: "mic_muted" }, reconnect: { micFirst: true } });
  });

  it("fires five seconds after the level meter stopped", () => {
    const outputs = run(new ConnectionWatch(), 8, (now, second) => input(now, { lastLevelAt: second === 0 ? now : START }));
    expect(firstAlarm(outputs)).toBe(METER_STALL_MS / 1000);
    expect(outputs[METER_STALL_MS / 1000]).toMatchObject({ alarm: { reason: "meter_stalled" }, reconnect: { micFirst: true } });
  });

  it(`clears by itself once words have been arriving for ${HEARING_AGAIN_MS / 1000} seconds, not on the first word`, () => {
    const watch = new ConnectionWatch();
    const outputs = run(watch, 34, (now, second) => input(now, { speechDb: -20, lastWordsAt: second >= 25 ? now : null }));
    expect(firstAlarm(outputs)).toBe(20);
    expect(outputs[25].alarm).not.toBeNull();
    const clearedAt = 25 + HEARING_AGAIN_MS / 1000;
    expect(outputs.findIndex((out) => out.cleared)).toBe(clearedAt);
    expect(outputs[clearedAt].events).toEqual([{ event: "alarm_off" }]);
    expect(outputs.slice(clearedAt + 1).every((out) => out.alarm === null && out.events.length === 0)).toBe(true);
  });

  it("treats the page's clock jumping as a broken connection, the moment it wakes", () => {
    const watch = new ConnectionWatch();
    watch.update(input(Date.now()), Date.now());
    vi.advanceTimersByTime(TIMER_JUMP_MS + 15_000);
    const now = Date.now();
    const out = watch.update(input(now), now);
    expect(out.events[0]).toEqual({ event: "timer_jump", ms: TIMER_JUMP_MS + 15_000 });
    expect(out).toMatchObject({ raised: true, alarm: { reason: "timer_jump" }, reconnect: { micFirst: false, attempt: 1 } });
  });

  it("does not call a hidden tab's slow timers a jump, nor the first look after it shows again", () => {
    // L11: a browser runs a hidden tab's timers about once a minute.
    const watch = new ConnectionWatch();
    watch.update(input(Date.now(), { hidden: true }), Date.now());
    vi.advanceTimersByTime(TIMER_JUMP_MS + 30_000);
    let now = Date.now();
    let out = watch.update(input(now, { hidden: true, lastLevelAt: now }), now);
    expect(out.events).toEqual([]);
    expect(out.alarm).toBeNull();
    vi.advanceTimersByTime(TIMER_JUMP_MS + 30_000);
    now = Date.now();
    out = watch.update(input(now, { lastLevelAt: now }), now);
    expect(out.events).toEqual([{ event: "tab_visible" }]);
    expect(out.alarm).toBeNull();
    // Visible from here on, the jump check is back.
    vi.advanceTimersByTime(TIMER_JUMP_MS + 5_000);
    now = Date.now();
    out = watch.update(input(now), now);
    expect(out).toMatchObject({ raised: true, alarm: { reason: "timer_jump" } });
  });

  it("keeps retrying with a growing wait while it stays up", () => {
    const outputs = run(new ConnectionWatch(), 120, (now, second) => input(now, { socketOpen: second === 0 }));
    const retries = outputs.flatMap((out, second) => out.events.filter((event) => event.event === "reconnect").map((event) => [second, event.attempt]));
    const first = 1 + SOCKET_CLOSED_MS / 1000;
    const expected: Array<[number, number]> = [[first, 1]];
    let at = first;
    for (let attempt = 2; at + RETRY_WAITS_MS[Math.min(attempt - 2, RETRY_WAITS_MS.length - 1)] / 1000 <= 120; attempt++) {
      at += RETRY_WAITS_MS[Math.min(attempt - 2, RETRY_WAITS_MS.length - 1)] / 1000;
      expected.push([at, attempt]);
    }
    expect(retries).toEqual(expected);
  });

  it("records what changed: the tab, the wake lock, the mic, the socket", () => {
    const outputs = run(new ConnectionWatch(), 8, (now, second) =>
      input(now, {
        hidden: second === 2 || second === 3,
        wakeLockHeld: second !== 2 && second !== 3,
        micMuted: second === 5,
        socketOpen: second !== 7,
        socketCode: second === 7 ? 1001 : null,
      }),
    );
    expect(kinds(outputs)).toEqual([
      "tab_hidden",
      "wakelock_lost",
      "tab_visible",
      "wakelock_regained",
      "mic_muted",
      "alarm_on",
      "reconnect",
      "mic_unmuted",
      "socket_closed",
      "socket_open",
    ]);
  });

  it("watches nothing while the mic is off, and takes the bar down when it goes off, without saying it hears again", () => {
    const outputs = run(new ConnectionWatch(), 30, (now, second) => input(now, { listening: second < 25, socketOpen: false }));
    expect(firstAlarm(outputs)).toBe(SOCKET_CLOSED_MS / 1000);
    expect(outputs[25]).toMatchObject({ cleared: true, alarm: null, events: [] });
    expect(outputs.slice(26).every((out) => out.alarm === null)).toBe(true);
    expect(kinds(outputs)).not.toContain("alarm_off");
  });
});

describe("one alarm per outage (Oct 6)", () => {
  it(`a socket that closes five times in ten seconds raises one alarm, and its attempts are numbered 1, 2, 3, 4, 5`, () => {
    const watch = new ConnectionWatch();
    // Seconds 0 to 9 the socket flaps (closed on odd seconds), then it stays closed until 24; words come back from 25.
    const outputs = run(watch, 40, (now, second) =>
      input(now, {
        socketOpen: second < 10 ? second % 2 === 0 : second >= 25,
        socketCode: 1006,
        lastWordsAt: second >= 25 ? now : null,
      }),
    );
    expect(kinds(outputs).filter((kind) => kind === "socket_closed")).toHaveLength(5);
    expect(outputs.filter((out) => out.raised)).toHaveLength(1);
    expect(kinds(outputs).filter((kind) => kind === "alarm_on")).toHaveLength(1);
    // The third close inside ${FLAP_WINDOW_MS / 1000} s raises it.
    expect(firstAlarm(outputs)).toBe(2 * FLAP_CLOSES - 1);
    const attempts = outputs.flatMap((out) => out.events.filter((event) => event.event === "reconnect").map((event) => event.attempt));
    expect(attempts).toEqual([1, 2, 3, 4, 5]);
    // The waits double: 1, 2, 4, 8 seconds.
    const at = outputs.flatMap((out, second) => (out.events.some((event) => event.event === "reconnect") ? [second] : []));
    expect(at.slice(1).map((second, i) => second - at[i])).toEqual([1, 2, 4, 8]);
    // It clears once, after three seconds of words.
    expect(kinds(outputs).filter((kind) => kind === "alarm_off")).toHaveLength(1);
    expect(outputs.findIndex((out) => out.cleared)).toBe(25 + HEARING_AGAIN_MS / 1000);
  });

  it(`${FLAP_CLOSES - 1} closes inside ${FLAP_WINDOW_MS / 1000} s, each reopening at once, are blips: no alarm`, () => {
    const outputs = run(new ConnectionWatch(), 30, (now, second) => input(now, { socketOpen: second !== 2 && second !== 6 }));
    expect(kinds(outputs).filter((kind) => kind === "socket_closed")).toHaveLength(FLAP_CLOSES - 1);
    expect(outputs.every((out) => out.alarm === null)).toBe(true);
  });

  it("a second outage later raises a second alarm, starting again at attempt 1", () => {
    const watch = new ConnectionWatch();
    const outputs = run(watch, 60, (now, second) =>
      input(now, {
        socketOpen: !(second >= 1 && second < 20) && !(second >= 40 && second < 60),
        lastWordsAt: second >= 20 && second < 40 ? now : null,
      }),
    );
    expect(outputs.filter((out) => out.raised).map((_, i) => i)).toHaveLength(2);
    const raisedAt = outputs.flatMap((out, second) => (out.raised ? [second] : []));
    expect(raisedAt).toEqual([1 + SOCKET_CLOSED_MS / 1000, 40 + SOCKET_CLOSED_MS / 1000]);
    expect(outputs[raisedAt[1]].reconnect?.attempt).toBe(1);
    expect(kinds(outputs).filter((kind) => kind === "alarm_off")).toHaveLength(1);
  });

  it(`the mic restart the alarm asks for, back within ${RESTART_GRACE_MS / 1000} s, is the same outage: no second tone`, () => {
    const watch = new ConnectionWatch();
    const outputs = run(watch, 20, (now, second) =>
      input(now, {
        listening: second !== 3,
        micEnded: second >= 1 && second < 3,
        // The new mic has not reported a level yet when it comes back.
        lastLevelAt: second >= 4 ? START : now,
      }),
    );
    expect(outputs.filter((out) => out.raised)).toHaveLength(1);
    const attempts = outputs.flatMap((out) => out.events.filter((event) => event.event === "reconnect").map((event) => event.attempt));
    expect(attempts[0]).toBe(1);
    expect(attempts.slice(1).every((attempt, i) => attempt === i + 2)).toBe(true);
  });
});
