import type { Sport } from "./types";

// =============================================================================
// Football offensive linemen are never called by name in play-by-play, so they
// start with spotting "off": saved on the roster, credited with a stat if one
// comes up (a fumble recovery), but never putting a card on screen.
//
// Only the offensive line. Defensive linemen make tackles and sacks and get
// named for them, so DL, DT, DE, NT and NG stay normal, as do linebackers.
// This only ever applies to football: a baseball catcher is "C" too.
// =============================================================================

/** Position codes that mean a player is on the offensive line. */
const OFFENSIVE_LINE = new Set(["OL", "OT", "OG", "C", "T", "G"]);

/**
 * Spelled-out positions, most specific first. The defensive ones are here only
 * so "Defensive Tackle" becomes DT (not OL) before "Tackle" alone is read as T.
 */
const SPELLED_OUT: Array<[RegExp, string]> = [
  [/\bOFFENSIVE\s+LINE(MAN|MEN)?\b/g, "OL"],
  [/\bDEFENSIVE\s+LINE(MAN|MEN)?\b/g, "DL"],
  [/\bNOSE\s+TACKLE\b/g, "NT"],
  [/\bNOSE\s+GUARD\b/g, "NG"],
  [/\bDEFENSIVE\s+TACKLE\b/g, "DT"],
  [/\bDEFENSIVE\s+END\b/g, "DE"],
  [/\bOFFENSIVE\s+TACKLE\b/g, "OT"],
  [/\bOFFENSIVE\s+GUARD\b/g, "OG"],
  [/\bTACKLE\b/g, "T"],
  [/\bGUARD\b/g, "G"],
  [/\bCENTER\b/g, "C"],
];

/** Words that only qualify a position, so they must not count as one. */
const MODIFIERS = new Set(["OFFENSIVE", "LEFT", "RIGHT", "STRONG", "WEAK", "INSIDE", "OUTSIDE"]);

/**
 * True when every position listed is on the offensive line.
 *
 * A player listed "OL/DL" or "TE, OL" also plays somewhere that gets named,
 * so they stay normal. A blank position stays normal too: silence is not
 * evidence.
 */
export function isOffensiveLineman(position: string | null | undefined, sport: Sport | null | undefined): boolean {
  if (sport !== "football") return false;

  let text = (position ?? "").toUpperCase();
  if (text.trim().length === 0) return false;
  for (const [pattern, code] of SPELLED_OUT) text = text.replace(pattern, code);

  const tokens = text
    .split(/[,/\\|&+\s]+/)
    .map((token) => token.replace(/[^A-Z]/g, ""))
    .filter((token) => token.length > 0 && !MODIFIERS.has(token));

  if (tokens.length === 0) return false;
  return tokens.every((token) => OFFENSIVE_LINE.has(token));
}
