import type { PanelMeasure } from "@/lib/panel/fit";
import { PANEL_WEIGHTS, panelFont } from "./panelFont";

// =============================================================================
// Widths in the panel's font, from a canvas, once its weights have loaded: the
// way components/measureBigLine.ts measures the cards' big lines. A canvas
// never touches the page's layout. The fitting rules are lib/panel/fit.ts.
// =============================================================================

// TUNING

/** Measured at this size and scaled. */
const MEASURE_PX = 100;

/**
 * A little over the canvas's width, as the cards' stat layout allows
 * (lib/cards/statLayout.ts): what the canvas measures and what the page draws
 * can differ by a hair, and too wide costs a pixel of size where too narrow
 * would cut a letter.
 */
const MEASURE_MARGIN = 1.04;

/**
 * A measure in the panel's font, once it has loaded, or null where it cannot
 * be had (no canvas, or the font failed): the panel then draws every name at
 * full size, free to wrap, which never cuts one off either.
 */
export async function loadPanelMeasure(): Promise<PanelMeasure | null> {
  try {
    const family = panelFont.style.fontFamily;
    await Promise.all(PANEL_WEIGHTS.map((weight) => document.fonts.load(`${weight} ${MEASURE_PX}px ${family}`)));
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return null;
    const widths = new Map<string, number>();
    return (text, weight, px) => {
      // The panel draws every digit tabular, which a canvas cannot: each is measured as a 0, the width tabular digits share.
      const tabular = text.replace(/[0-9]/g, "0");
      const key = `${weight}|${tabular}`;
      let width = widths.get(key);
      if (width === undefined) {
        context.font = `${weight} ${MEASURE_PX}px ${family}`;
        width = context.measureText(tabular).width;
        widths.set(key, width);
      }
      return (width * px * MEASURE_MARGIN) / MEASURE_PX;
    };
  } catch {
    return null;
  }
}
