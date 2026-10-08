// =============================================================================
// Team colours, and telling two teams apart by them.
//
// A team's colour fills the number slab on its cards (docs/CARD_SPEC.md). The
// away team is never told apart by colour alone: its slabs are always hatched
// and carry its school code, because two schools in navy is common. When the
// two colours are close, setup says so and leaves the choice to the announcer.
// "Too close" is a distance, not equality: #000080 against #00007e is the same
// colour to anyone watching.
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

/** Above this WCAG relative luminance a slab takes dark ink, at or below it white. */
export const INK_LUMINANCE_SPLIT = 0.179;

export const DARK_INK = "#111111";
export const LIGHT_INK = "#FFFFFF";

/** The stage's own grey, which a side with no colour keeps (docs/CARD_SPEC.md). */
export const STAGE_GREY = "#6B6B6B";

/**
 * How far a team's colour is darkened for the stage behind the cards, 0 to 1
 * of the way to black (Jed, Oct 5: mixed onto grey the two colours were "an
 * awkward blur"). The colour itself, a little deeper, so the white card and
 * the team-colour number block both stand out against it, and a white or gold
 * team is not white behind a white card.
 */
export const STAGE_DARKEN = 0.35;

/** The diagonal behind the cards: its lean from vertical and where it crosses the stage (V2's). */
const SPLIT_ANGLE_DEG = 104;
const SPLIT_POSITION = 0.46;

/**
 * The hard edge between the two colours and the white line down it, as a
 * share of the stage's length along the diagonal. No feather: a soft edge is
 * what made it a blur. The line keeps two similar colours apart.
 */
const DIVIDER_SHARE = 0.006;

/** A slab with no team colour: dark for home, light grey for away. */
export const HOME_SLAB = "#111111";
export const AWAY_SLAB = "#E6E6E6";

/** The away slab's hatching: 45 degree stripes of the ink at this opacity, in em of the slab. */
const HATCH_ALPHA = 0.12;
const HATCH_LINE_EM = 0.07;
const HATCH_REPEAT_EM = 0.22;

/** Words a school code skips. */
const CODE_SKIPPED = new Set(["high", "school", "hs", "of", "the"]);

/** A code is the initials of at most this many words. */
const CODE_WORDS = 3;

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

/** The colour at the given opacity. */
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

/** WCAG contrast ratio against white. The logo colour picker uses it. */
export function contrastOnWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

/** The ink on a slab of this colour: #111111 or #FFFFFF, whichever contrasts more. */
export function slabInk(hex: string): string {
  return relativeLuminance(hex) > INK_LUMINANCE_SPLIT ? DARK_INK : LIGHT_INK;
}

/** How one side's slabs look, settled when the game opens. writeCard only copies these. */
export interface SideLook {
  background: string;
  ink: string;
  /** The away hatching, a CSS background image. Empty for home. */
  hatch: string;
  /** The away school code, "CP". Empty for home. */
  code: string;
}

export function sideLook(color: string | null | undefined, side: "H" | "A", code: string): SideLook {
  const background = normalizeHex(color) ?? (side === "H" ? HOME_SLAB : AWAY_SLAB);
  const ink = slabInk(background);
  return { background, ink, hatch: side === "A" ? hatching(ink) : "", code: side === "A" ? code : "" };
}

/** Both sides' looks, with codes that differ from each other. */
export function sideLooks(
  home: { color: string | null | undefined; school: string },
  away: { color: string | null | undefined; school: string },
): Record<"H" | "A", SideLook> {
  const codes = schoolCodes(home.school, away.school);
  return { H: sideLook(home.color, "H", codes.home), A: sideLook(away.color, "A", codes.away) };
}

/** 45 degree stripes of the ink, faint, over the slab colour. */
function hatching(ink: string): string {
  const on = withAlpha(ink, HATCH_ALPHA);
  const off = withAlpha(ink, 0);
  return `repeating-linear-gradient(45deg, ${on} 0, ${on} ${HATCH_LINE_EM}em, ${off} ${HATCH_LINE_EM}em, ${off} ${HATCH_REPEAT_EM}em)`;
}

/** A school's words, with the ones a code skips left out. */
function codeWords(school: string): string[] {
  return school
    .split(/[\s/-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((word) => word.length > 0 && !CODE_SKIPPED.has(word.toLowerCase()));
}

/**
 * The initials of up to three words, skipping "High", "School", "HS", "of" and
 * "the": "Castellan Prep" is CP. One word is its first three letters:
 * "Estancia" is EST.
 */
export function schoolCode(school: string): string {
  const words = codeWords(school);
  if (words.length === 0) return school.trim().slice(0, 3).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, CODE_WORDS)
    .map((word) => [...word][0])
    .join("")
    .toUpperCase();
}

/** Both codes. Two that come out the same become the first three letters of each school's first word. */
export function schoolCodes(home: string, away: string): { home: string; away: string } {
  const codes = { home: schoolCode(home), away: schoolCode(away) };
  if (codes.home !== codes.away) return codes;
  const firstThree = (school: string) => (codeWords(school)[0] ?? school.trim()).slice(0, 3).toUpperCase();
  return { home: firstThree(home), away: firstThree(away) };
}

/** The colour darkened toward black by `amount`, 0 to 1. Null when it is not a colour. */
function darken(color: string, amount: number): string | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * (1 - amount))))
      .toString(16)
      .padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

/**
 * The stage's background: the left side's colour, then the right side's,
 * each its own colour a little darkened, with a hard edge and a thin white
 * line between them on V2's leaning diagonal (back on Oct 5, made sharp the
 * same day). A side with no colour stays the stage's grey. Null when neither
 * side has one, so the stage is plain grey.
 */
export function splitBackground(left: string | null, right: string | null): string | null {
  const from = left ? darken(left, STAGE_DARKEN) : null;
  const to = right ? darken(right, STAGE_DARKEN) : null;
  if (!from && !to) return null;
  const a = from ?? STAGE_GREY;
  const b = to ?? STAGE_GREY;
  const start = ((SPLIT_POSITION - DIVIDER_SHARE / 2) * 100).toFixed(2);
  const end = ((SPLIT_POSITION + DIVIDER_SHARE / 2) * 100).toFixed(2);
  return `linear-gradient(${SPLIT_ANGLE_DEG}deg, ${a} 0%, ${a} ${start}%, #ffffff ${start}%, #ffffff ${end}%, ${b} ${end}%, ${b} 100%)`;
}

export interface GameColors {
  home: string | null;
  away: string | null;
  /** Set when the two colours are too close to tell apart, so setup can say so. */
  note: string | null;
}

/**
 * The colour each side wears on its cards.
 *
 * Both sides keep their own, always. When the two are close enough that the
 * slabs will look alike, the note says so rather than the code overriding it:
 * which colour a team wears is the announcer's call, and a screen that quietly
 * refuses one is harder to understand than one that says what it is doing.
 */
export function resolveGameColors(home: string | null, away: string | null): GameColors {
  const homeColor = normalizeHex(home);
  const awayColor = normalizeHex(away);

  const note =
    homeColor && awayColor && tooClose(homeColor, awayColor)
      ? "Both teams are nearly the same colour, so their number slabs will look alike. The away cards are still striped and carry the school code; changing one colour makes the sides quicker to tell apart."
      : null;

  return { home: homeColor, away: awayColor, note };
}
