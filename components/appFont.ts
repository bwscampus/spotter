import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

/**
 * The dashboard's faces (docs/UI_STYLE.md): Plex Sans for text, Plex Mono for
 * jersey numbers, scores, counts, dates and ids. next/font downloads them at
 * build time and serves them from Spotter's own domain, so nothing is fetched
 * from Google at game time. They are CSS variables only, applied by the .dash
 * class, so neither reaches the live screen or its stage.
 */
export const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex-sans",
  fallback: ["system-ui", "sans-serif"],
});

export const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
  fallback: ["ui-monospace", "monospace"],
});
