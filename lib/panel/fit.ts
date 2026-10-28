// =============================================================================
// Making text fit the panel's fixed boxes without cutting it (Jed, Oct 28:
// "Names are never cut off. No ellipsis and no clipping"). A name steps down
// 1px at a time to a floor; below that it wraps, at its hyphen if it has one,
// else at a space, else between letters. Pure: widths come from a measure
// function (the canvas in components/panel/measurePanel.ts), so nothing
// reads layout and every rule is tested.
// =============================================================================

/** The width of `text` in px at `px` and `weight` in the panel's font. */
export type PanelMeasure = (text: string, weight: number, px: number) => number;

export interface TextFit {
  /** The font size, in px. */
  px: number;
  /** One line, or the lines it wraps onto. Each fits. */
  lines: string[];
  /** It did not fit even at the floor and was not allowed to wrap: the one case an ellipsis is drawn. */
  overflow: boolean;
}

export interface FitOptions {
  widthPx: number;
  maxPx: number;
  minPx: number;
  weight: number;
  /** Below the floor: wrap (names), or keep one line (opponents, whose rows are 21px). */
  wrap: boolean;
}

/** Breaks a word at `minPx` so every line fits: the hyphen first, then a space, then between letters. */
function wrapAt(text: string, measure: PanelMeasure, { widthPx, minPx, weight }: FitOptions): string[] {
  const fits = (line: string) => measure(line, weight, minPx) <= widthPx;

  // Two lines at a hyphen (kept on the first) or a space (dropped), the most even split that fits.
  for (const breaker of ["-", " "]) {
    let best: string[] | null = null;
    let bestLongest = Infinity;
    for (let at = text.indexOf(breaker); at > 0; at = text.indexOf(breaker, at + 1)) {
      const first = breaker === "-" ? text.slice(0, at + 1) : text.slice(0, at);
      const second = text.slice(at + 1).trim();
      if (!second || !fits(first) || !fits(second)) continue;
      const longest = Math.max(measure(first, weight, minPx), measure(second, weight, minPx));
      if (longest < bestLongest) {
        best = [first, second];
        bestLongest = longest;
      }
    }
    if (best) return best;
  }

  // Between letters: as much as fits on each line. Never drops a letter.
  const lines: string[] = [];
  let line = "";
  for (const char of [...text]) {
    if (line && !fits(line + char)) {
      lines.push(line);
      line = char.trim() ? char : "";
    } else {
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The biggest size from maxPx down to minPx, 1px at a time, at which `text` fits on one line; below that, wrapped. */
export function fitText(text: string, measure: PanelMeasure, options: FitOptions): TextFit {
  for (let px = options.maxPx; px >= options.minPx; px -= 1) {
    if (measure(text, options.weight, px) <= options.widthPx) return { px, lines: [text], overflow: false };
  }
  if (!options.wrap) return { px: options.minPx, lines: [text], overflow: true };
  return { px: options.minPx, lines: wrapAt(text, measure, options), overflow: false };
}

/**
 * A leader's category line ("RUSH · 140 car, 11 TD"): one line, stepped down
 * from maxPx to minPx; still too wide, it breaks once after its last comma
 * onto two lines, at the biggest size both fit. Its numbers grow during a game
 * (and a season's are big), and the box beside the number is 91px.
 */
export function fitCategory(
  text: string,
  measure: PanelMeasure,
  { widthPx, maxPx, minPx, twoLineMaxPx }: { widthPx: number; maxPx: number; minPx: number; twoLineMaxPx: number },
): TextFit {
  const weight = 700;
  for (let px = maxPx; px >= minPx; px -= 1) {
    if (measure(text, weight, px) <= widthPx) return { px, lines: [text], overflow: false };
  }
  const comma = text.lastIndexOf(", ");
  if (comma < 0) return { px: minPx, lines: [text], overflow: true };
  const lines = [text.slice(0, comma + 1), text.slice(comma + 2)];
  for (let px = twoLineMaxPx; px >= minPx; px -= 1) {
    if (lines.every((line) => measure(line, weight, px) <= widthPx)) return { px, lines, overflow: false };
  }
  return { px: minPx, lines, overflow: false };
}

/** A fit for text that has not been measured yet (the font has not loaded): the full size, free to wrap. */
export function unmeasured(text: string, px: number): TextFit {
  return { px, lines: [text], overflow: false };
}

/**
 * The widths of the characters a number is written with ("~2,431", "9-14",
 * "–"), at 100px, measured once. The panel's numbers are tabular, so a
 * number's width is the sum of its characters' and can be worked out every
 * time it changes without measuring again.
 */
export type Advances = ReadonlyMap<string, number>;

export const NUMBER_CHARS = "0123456789,-~–";

/** The biggest size from maxPx down to minPx at which a number fits; minPx when nothing does. */
export function numberPx(text: string, advances: Advances | null, widthPx: number, maxPx: number, minPx: number): number {
  if (!advances) return maxPx;
  const at100 = [...text].reduce((sum, char) => sum + (advances.get(char) ?? advances.get("0") ?? 60), 0);
  for (let px = maxPx; px > minPx; px -= 1) {
    if ((at100 * px) / 100 <= widthPx) return px;
  }
  return minPx;
}
