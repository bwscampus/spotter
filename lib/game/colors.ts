// =============================================================================
// Team colours, and telling two teams apart by them.
//
// Both teams always wear their own colour. Two schools in navy is common, and
// when that happens the two halves of the screen will look alike, so setup says
// so and leaves the choice to the announcer. "Too close" is a distance, not
// equality: #000080 against #00007e is the same colour to anyone watching.
//
// Everything here is pure so the rules can be tested without a browser.
// =============================================================================

/**
 * How far apart two colours must be to read as different at a glance.
 * Weighted RGB distance, roughly 0-765. Navy and black sit around 45, navy and
 * royal blue around 90. 120 keeps those apart while still calling two shades of
 * the same navy a clash.
 */
export const MIN_COLOR_DISTANCE = 120;

/** Contrast a colour must reach against white before it is used for text. */
const MIN_INK_CONTRAST = 4.5;

/**
 * How strongly each team's colour washes its half of the live screen.
 *
 * Light enough that black text and a white card still sit cleanly on top, heavy
 * enough to read as a colour from across a booth rather than as a tint.
 */
export const SCREEN_TINT_ALPHA = 0.18;

/**
 * The live screen's background is both teams at once, split by a diagonal.
 *
 * The angle is past vertical so the line leans: the top of it sits to the right
 * of the bottom, which is the positive slope a scoreboard graphic uses. The
 * split is deliberately off centre, because a line through the exact middle of
 * the screen reads as a mistake rather than as a design.
 *
 * The feather is a hair of softness on the boundary. A hard stop between two
 * pale washes aliases into a staircase on a low resolution booth monitor.
 */
const SPLIT_ANGLE_DEG = 104;
const SPLIT_POSITION = 0.46;
const SPLIT_FEATHER = 0.012;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Accepts "#abc", "abc", "#aabbcc". Returns "#aabbcc", or null if it is not a colour. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(text)) {
    return `#${text.toLowerCase().split("").map((c) => c + c).join("")}`;
  }
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text.toLowerCase()}`;
  return null;
}

export function parseHex(hex: string): Rgb | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

/** The colour at the given opacity, for a wash behind text. */
export function withAlpha(hex: string, alpha: number): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/**
 * Weighted RGB distance. Eyes are more sensitive to green than to blue, so a
 * plain Euclidean distance calls two greens closer than they look.
 */
export function colorDistance(a: string, b: string): number {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return Infinity;
  return (
    Math.abs(first.r - second.r) * 2 + Math.abs(first.g - second.g) * 4 + Math.abs(first.b - second.b)
  );
}

/** True when two colours are close enough that a glance would not separate them. */
export function tooClose(a: string, b: string): boolean {
  return colorDistance(a, b) < MIN_COLOR_DISTANCE;
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 1;
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

/** WCAG contrast ratio against white, which is what the card is. */
export function contrastOnWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

/**
 * The colour, darkened until it can be read on the card.
 *
 * School colours include white, gold and light blue. Printing a jersey number
 * in those on a white card would leave it invisible, and the number is the
 * thing an announcer looks at first, so legibility wins over fidelity.
 */
export function readableInk(hex: string): string | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  let { r, g, b } = rgb;
  // Multiplying keeps the hue and drops the brightness, so navy stays navy.
  for (let step = 0; step < 20 && contrastOnWhite(toHex({ r, g, b })) < MIN_INK_CONTRAST; step++) {
    r = Math.round(r * 0.85);
    g = Math.round(g * 0.85);
    b = Math.round(b * 0.85);
  }
  return toHex({ r, g, b });
}

function toHex({ r, g, b }: Rgb): string {
  const part = (value: number) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * The live screen's background: the left side's colour, then the right side's,
 * divided by a leaning diagonal. Either side may have no colour, and shows the
 * page's own white instead. Null when neither side has one.
 */
export function splitBackground(left: string | null, right: string | null): string | null {
  const leftTint = left ? withAlpha(left, SCREEN_TINT_ALPHA) : null;
  const rightTint = right ? withAlpha(right, SCREEN_TINT_ALPHA) : null;
  if (!leftTint && !rightTint) return null;

  // White rather than transparent for a side with no colour: interpolating to
  // transparent runs through transparent black and greys the boundary.
  const from = leftTint ?? "#ffffff";
  const to = rightTint ?? "#ffffff";
  const edgeStart = ((SPLIT_POSITION - SPLIT_FEATHER) * 100).toFixed(1);
  const edgeEnd = ((SPLIT_POSITION + SPLIT_FEATHER) * 100).toFixed(1);

  return `linear-gradient(${SPLIT_ANGLE_DEG}deg, ${from} 0%, ${from} ${edgeStart}%, ${to} ${edgeEnd}%, ${to} 100%)`;
}

export interface GameColors {
  home: string | null;
  away: string | null;
  /** Set when the away team's colour had to be dropped, so setup can say so. */
  note: string | null;
}

/**
 * The colour each side wears on screen.
 *
 * Both sides keep their own, always. When the two are close enough that the
 * halves of the screen will look alike, the note says so rather than the code
 * overriding it: which colour a team wears is the announcer's call, and a
 * screen that quietly refuses one is harder to understand than one that says
 * what it is doing.
 */
export function resolveGameColors(home: string | null, away: string | null): GameColors {
  const homeColor = normalizeHex(home);
  const awayColor = normalizeHex(away);

  const note =
    homeColor && awayColor && tooClose(homeColor, awayColor)
      ? "Both teams are nearly the same colour, so the two halves of the screen will look alike. Change one of them to tell the sides apart."
      : null;

  return { home: homeColor, away: awayColor, note };
}
