// Whether a key press belongs to whatever has focus, or to the live screen.
//
// The live screen's shortcuts are single letters and digits, so they have to
// stand aside for anything being typed into. The test is deliberately narrow:
// an earlier version stood aside for every select and button, and the mic
// picker is a select, so choosing a microphone left X dead until something
// else was clicked. That is exactly when an announcer reaches for it.

/** Input types that take typing. Everything else (checkbox, radio, range, file, buttons) does not. */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/** True when this element is somewhere words are being typed. */
export function isTextEntry(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { type?: string }) | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return TEXT_INPUT_TYPES.has(element.type ?? "text");
  return false;
}

// =============================================================================
// The live screen's keys, as a pure reducer so they can be tested without a
// DOM. docs/V3_DEFINITION.md 7.2: X takes down the newest card, and 1, 2, 3
// take down the card with that digit in its corner. Start and Stop listening
// have no key at all, on purpose: a live mic is never turned off by a key that
// was meant for something else.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/**
 * Two presses closer together than this are one press.
 *
 * Auto-repeat is already handled by ignoring event.repeat; this catches the
 * keyboard that sends a held key as separate presses. A second card is never
 * taken down this fast on purpose.
 */
export const TAKEDOWN_DEBOUNCE_MS = 300;

// =============================================================================

/** The keys that take a card down. X is the newest; the digits count from the top. */
export const REMOVAL_KEYS = ["x", "1", "2", "3"] as const;
export type RemovalKey = (typeof REMOVAL_KEYS)[number];

/** Which slot each key takes down, counting from the top: 0 is the newest. */
const SLOT_FOR_KEY: Record<RemovalKey, number> = { x: 0, "1": 0, "2": 1, "3": 2 };

export interface LiveKeyState {
  /** When a card last came off, so a key sent twice does not take two. */
  lastTakedownAt: number;
}

export const INITIAL_KEY_STATE: LiveKeyState = { lastTakedownAt: Number.NEGATIVE_INFINITY };

/** One keydown, reduced to what the decision needs. */
export interface LiveKeyPress {
  key: string;
  /** event.repeat: the key is being held down. */
  repeat: boolean;
  /** Cmd, Ctrl or Alt was held: the browser's shortcut, not Spotter's. */
  modifier: boolean;
  /** isTextEntry(event.target): words are being typed. */
  textEntry: boolean;
  /** Date.now() at the press. */
  now: number;
}

export type LiveKeyAction = { type: "removeCard"; key: RemovalKey; slot: number } | { type: "none" };

export interface LiveKeyResult {
  state: LiveKeyState;
  action: LiveKeyAction;
  /** The key was Spotter's: preventDefault, even when the debounce swallowed it. */
  handled: boolean;
}

const NOTHING: LiveKeyAction = { type: "none" };

function isRemovalKey(key: string): key is RemovalKey {
  return (REMOVAL_KEYS as readonly string[]).includes(key);
}

export function reduceLiveKey(state: LiveKeyState, press: LiveKeyPress): LiveKeyResult {
  if (press.modifier) return { state, action: NOTHING, handled: false };
  // Held down is one press. Leaning on X used to take three cards off.
  if (press.repeat) return { state, action: NOTHING, handled: false };
  // Never while words are being typed. Only that: a select or a button
  // holding focus must not turn the keys off.
  if (press.textEntry) return { state, action: NOTHING, handled: false };

  // Caps lock or Shift sends "X", which means the same thing.
  const key = press.key.toLowerCase();
  if (!isRemovalKey(key)) return { state, action: NOTHING, handled: false };

  if (press.now - state.lastTakedownAt < TAKEDOWN_DEBOUNCE_MS) {
    return { state, action: NOTHING, handled: true };
  }
  return {
    state: { lastTakedownAt: press.now },
    action: { type: "removeCard", key, slot: SLOT_FOR_KEY[key] },
    handled: true,
  };
}
