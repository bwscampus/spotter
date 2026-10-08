import { Atkinson_Hyperlegible_Next } from "next/font/google";

/**
 * The cards' face (docs/CARD_SPEC.md), on the stage only, not the rest of the
 * app. next/font downloads it at build time and serves it from Spotter's own
 * domain, so nothing is fetched from Google during a game.
 */
export const stageFont = Atkinson_Hyperlegible_Next({
  weight: ["500", "700", "800"],
  subsets: ["latin"],
  fallback: ["Fira Sans", "system-ui", "sans-serif"],
  adjustFontFallback: false,
});

/** The three weights the card uses, for loading before anything is measured. */
export const STAGE_WEIGHTS = [500, 700, 800] as const;
