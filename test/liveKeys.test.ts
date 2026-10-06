import { describe, expect, it } from "vitest";
import { INITIAL_KEY_STATE, reduceLiveKey, TAKEDOWN_DEBOUNCE_MS, type LiveKeyPress } from "@/lib/keys";

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
