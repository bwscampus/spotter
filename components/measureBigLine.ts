import { fitBigLine, type BigLineFit, type Measure } from "@/lib/cards/bigLine";
import type { WatchlistPlayer } from "@/lib/watchlist";
import { STAGE_WEIGHTS, stageFont } from "./stageFont";

// =============================================================================
// Measuring the big lines against the loaded font, once per player, off the
// hot path (docs/CARD_SPEC.md). The rule is lib/cards/bigLine.ts; this only
// supplies the widths, from a canvas, which never touches the page's layout.
// =============================================================================

/** Measured at this size and divided back to em. */
const MEASURE_PX = 100;

/** A canvas measure in the card's font. Null where there is no canvas. */
function canvasMeasure(): Measure | null {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  const family = stageFont.style.fontFamily;
  return (text, weight, spacingEm) => {
    context.font = `${weight} ${MEASURE_PX}px ${family}`;
    return context.measureText(text).width / MEASURE_PX + spacingEm * [...text].length;
  };
}

/**
 * Each player's big line, fitted, once the card's font has loaded. Null when
 * it could not be measured: the cards then go up with the big line whole at
 * full size, which is what they show before this lands anyway.
 */
export async function measureBigLines(players: readonly WatchlistPlayer[]): Promise<Map<WatchlistPlayer, BigLineFit> | null> {
  try {
    const family = stageFont.style.fontFamily;
    await Promise.all(STAGE_WEIGHTS.map((weight) => document.fonts.load(`${weight} ${MEASURE_PX}px ${family}`)));
    const measure = canvasMeasure();
    if (!measure) return null;
    const fits = new Map<WatchlistPlayer, BigLineFit>();
    for (const player of players) if (player.face) fits.set(player, fitBigLine(player.face, measure));
    return fits;
  } catch {
    return null;
  }
}
