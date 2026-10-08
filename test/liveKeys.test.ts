import { describe, expect, it } from "vitest";
import {
  INITIAL_KEY_STATE,
  reduceLiveKey,
  STATS_KEY_DEBOUNCE_MS,
  TAKEDOWN_DEBOUNCE_MS,
  type LiveKeyPress,
} from "@/lib/keys";

// docs/V3_DEFINITION.md 7.2: X takes down the newest card, 1, 2 and 3 take down
// that card. Held keys, doubled presses and typing never take a card.

const press = (key: string, now = 10_000, extra: Partial<LiveKeyPress> = {}): LiveKeyPress => ({
  key,
  repeat: false,
  modifier: false,
  textEntry: false,
  now,
  ...extra,
});

describe("reduceLiveKey", () => {
  it("X takes down the newest card, which is slot 0", () => {
    expect(reduceLiveKey(INITIAL_KEY_STATE, press("x")).action).toEqual({ type: "removeCard", key: "x", slot: 0 });
  });

  it("an uppercase X means the same", () => {
    expect(reduceLiveKey(INITIAL_KEY_STATE, press("X")).action).toEqual({ type: "removeCard", key: "x", slot: 0 });
  });

  it("1, 2 and 3 take down the card with that digit, counting from the top", () => {
    expect(reduceLiveKey(INITIAL_KEY_STATE, press("1")).action).toEqual({ type: "removeCard", key: "1", slot: 0 });
    expect(reduceLiveKey(INITIAL_KEY_STATE, press("2")).action).toEqual({ type: "removeCard", key: "2", slot: 1 });
    expect(reduceLiveKey(INITIAL_KEY_STATE, press("3")).action).toEqual({ type: "removeCard", key: "3", slot: 2 });
  });

  it("claims the key so the page does not also act on it", () => {
    expect(reduceLiveKey(INITIAL_KEY_STATE, press("x")).handled).toBe(true);
  });

  it("ignores every other key, including 4 and the space bar, which has no job on the live screen", () => {
    for (const key of ["4", "0", " ", "Enter", "u", "f", "Escape"]) {
      const result = reduceLiveKey(INITIAL_KEY_STATE, press(key));
      expect(result).toEqual({ state: INITIAL_KEY_STATE, action: { type: "none" }, handled: false });
    }
  });

  it("a held key is one press", () => {
    const result = reduceLiveKey(INITIAL_KEY_STATE, press("x", 10_000, { repeat: true }));
    expect(result.action.type).toBe("none");
    expect(result.handled).toBe(false);
  });

  it("stands aside while words are being typed", () => {
    const result = reduceLiveKey(INITIAL_KEY_STATE, press("2", 10_000, { textEntry: true }));
    expect(result).toEqual({ state: INITIAL_KEY_STATE, action: { type: "none" }, handled: false });
  });

  it("leaves browser shortcuts alone: Cmd-X is cut, not a wrong card", () => {
    expect(reduceLiveKey(INITIAL_KEY_STATE, press("x", 10_000, { modifier: true })).handled).toBe(false);
  });

  it("a second press inside the debounce takes nothing, but is still claimed", () => {
    const first = reduceLiveKey(INITIAL_KEY_STATE, press("x", 10_000));
    const second = reduceLiveKey(first.state, press("x", 10_000 + TAKEDOWN_DEBOUNCE_MS - 1));
    expect(second.action.type).toBe("none");
    expect(second.handled).toBe(true);
    // The window runs from the press that took a card, not from the swallowed one.
    expect(second.state).toBe(first.state);
  });

  it("the debounce covers X and the digits together: X then 2 in one breath is one card", () => {
    const first = reduceLiveKey(INITIAL_KEY_STATE, press("x", 10_000));
    expect(reduceLiveKey(first.state, press("2", 10_100)).action.type).toBe("none");
  });

  it("a press after the debounce takes the next card", () => {
    const first = reduceLiveKey(INITIAL_KEY_STATE, press("x", 10_000));
    const second = reduceLiveKey(first.state, press("x", 10_000 + TAKEDOWN_DEBOUNCE_MS));
    expect(second.action).toEqual({ type: "removeCard", key: "x", slot: 0 });
    expect(second.state.lastTakedownAt).toBe(10_000 + TAKEDOWN_DEBOUNCE_MS);
  });
});

// Live stats (8.6, as Jed set it on Oct 2): Enter OKs the play at the front of
// the line, Backspace discards it, U takes back the last OK. Only on a game
// with stats on.
describe("reduceLiveKey with live stats", () => {
  const stats = (key: string, now = 10_000, extra: Partial<LiveKeyPress> = {}) => press(key, now, { statsKeys: true, ...extra });

  it("Enter OKs, Backspace discards and U takes back", () => {
    expect(reduceLiveKey(INITIAL_KEY_STATE, stats("Enter"))).toMatchObject({ action: { type: "okPlay" }, handled: true });
    expect(reduceLiveKey(INITIAL_KEY_STATE, stats("Backspace"))).toMatchObject({ action: { type: "discardPlay" }, handled: true });
    expect(reduceLiveKey(INITIAL_KEY_STATE, stats("u"))).toMatchObject({ action: { type: "undoStat" }, handled: true });
    expect(reduceLiveKey(INITIAL_KEY_STATE, stats("U"))).toMatchObject({ action: { type: "undoStat" }, handled: true });
  });

  it("leaves Enter, Backspace and U alone on a game without stats", () => {
    for (const key of ["Enter", "Backspace", "u"]) {
      expect(reduceLiveKey(INITIAL_KEY_STATE, press(key))).toEqual({ state: INITIAL_KEY_STATE, action: { type: "none" }, handled: false });
    }
  });

  it("X and the digits mean exactly what they meant", () => {
    expect(reduceLiveKey(INITIAL_KEY_STATE, stats("x")).action).toEqual({ type: "removeCard", key: "x", slot: 0 });
    expect(reduceLiveKey(INITIAL_KEY_STATE, stats("3")).action).toEqual({ type: "removeCard", key: "3", slot: 2 });
  });

  it("stands aside while typing, for a held key, and for shortcuts", () => {
    expect(reduceLiveKey(INITIAL_KEY_STATE, stats("Backspace", 10_000, { textEntry: true })).handled).toBe(false);
    expect(reduceLiveKey(INITIAL_KEY_STATE, stats("Enter", 10_000, { repeat: true })).handled).toBe(false);
    expect(reduceLiveKey(INITIAL_KEY_STATE, stats("u", 10_000, { modifier: true })).handled).toBe(false);
  });

  it("a bounced key is one answer: a play is never OK'd twice", () => {
    const first = reduceLiveKey(INITIAL_KEY_STATE, stats("Enter", 10_000));
    const second = reduceLiveKey(first.state, stats("Enter", 10_000 + STATS_KEY_DEBOUNCE_MS - 1));
    expect(second).toMatchObject({ action: { type: "none" }, handled: true });
    expect(reduceLiveKey(first.state, stats("Enter", 10_000 + STATS_KEY_DEBOUNCE_MS)).action).toEqual({ type: "okPlay" });
  });

  it("keeps the two debounces apart: answering a play never swallows a takedown", () => {
    const answered = reduceLiveKey(INITIAL_KEY_STATE, stats("Enter", 10_000));
    expect(reduceLiveKey(answered.state, stats("x", 10_050)).action).toEqual({ type: "removeCard", key: "x", slot: 0 });
    const takenDown = reduceLiveKey(INITIAL_KEY_STATE, stats("x", 10_000));
    expect(reduceLiveKey(takenDown.state, stats("u", 10_050)).action).toEqual({ type: "undoStat" });
  });
});
