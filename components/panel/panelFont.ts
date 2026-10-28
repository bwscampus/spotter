import { Atkinson_Hyperlegible_Next } from "next/font/google";

/**
 * The team panel's face (docs/PANEL_SPEC.md): the cards' own family, so the
 * live screen reads as one thing, with 600 added for the opponent and the
 * leader lines. Its own loader, so the stage's (components/stageFont.ts, on
 * the card path) is untouched. next/font downloads it at build time and
 * serves it from Spotter's own domain, so nothing is fetched at game time.
 */
export const panelFont = Atkinson_Hyperlegible_Next({
  weight: ["500", "600", "700", "800"],
  subsets: ["latin"],
  fallback: ["Fira Sans", "system-ui", "sans-serif"],
  adjustFontFallback: false,
});

/** The weights the panel uses, for loading before anything is measured. */
export const PANEL_WEIGHTS = [500, 600, 700, 800] as const;
