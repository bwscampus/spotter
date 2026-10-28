import { titleCase } from "@/lib/cards/cardFace";
import type { KeyedPlayer } from "@/lib/cards/playerKey";
import { fitText, NUMBER_CHARS, type Advances, type PanelMeasure, type TextFit } from "./fit";
import {
  BAND_GAP_PX,
  BAND_INNER_PX,
  HALF_INNER_PX,
  LEADER_NAME_MIN_PX,
  LEADER_NAME_PX,
  LEADER_NAME_WIDTH_PX,
  LEAGUE_PX,
  OPPONENT_MIN_PX,
  OPPONENT_PX,
  OPPONENT_WIDTH_PX,
  RECORD_PX,
  SCHOOL_MIN_PX,
  SCHOOL_PX,
  STREAK_PX,
} from "./layout";
import { streakLine, type ScheduleView } from "./view";

// =============================================================================
// Everything the panel fits to a box, fitted once when the game opens or the
// rosters are refreshed (Jed, Oct 28: measured "the way measureBigLines does,
// off the hot path, once per player when the game opens"): every surname on
// both rosters, both school names, every opponent and each half's streak line.
// Pure: the widths come from the measure handed in.
// =============================================================================

/** The streak line steps down to this before it ends in an ellipsis. */
export const STREAK_MIN_PX = 10;

export interface SideFits {
  school: TextFit;
  streak: TextFit;
}

export interface PanelFits {
  /** By the surname as the panel writes it (titleCase). */
  names: ReadonlyMap<string, TextFit>;
  opponents: ReadonlyMap<string, TextFit>;
  away: SideFits;
  home: SideFits;
  /** Each number character's width at 100px and weight 800, for the big numbers. */
  advances: Advances;
}

export interface PanelTexts {
  roster: readonly KeyedPlayer[];
  away: { school: string; view: ScheduleView };
  home: { school: string; view: ScheduleView };
}

function sideFits(side: PanelTexts["home"], measure: PanelMeasure): SideFits {
  // The record and the league line share the band's right; the school takes what is left.
  const right = Math.max(measure(side.view.record, 800, RECORD_PX), measure(side.view.league, 600, LEAGUE_PX));
  const schoolWidth = Math.max(40, BAND_INNER_PX - right - BAND_GAP_PX);
  return {
    school: fitText(side.school, measure, { widthPx: schoolWidth, maxPx: SCHOOL_PX, minPx: SCHOOL_MIN_PX, weight: 800, wrap: true }),
    // Measured at the bold weight: the streak is bold, the rest is lighter, so this errs wide.
    streak: fitText(streakLine(side.view), measure, { widthPx: HALF_INNER_PX, maxPx: STREAK_PX, minPx: STREAK_MIN_PX, weight: 700, wrap: false }),
  };
}

export function panelFits(texts: PanelTexts, measure: PanelMeasure): PanelFits {
  const names = new Map<string, TextFit>();
  for (const player of texts.roster) {
    const name = titleCase(player.last);
    if (!names.has(name)) {
      names.set(name, fitText(name, measure, { widthPx: LEADER_NAME_WIDTH_PX, maxPx: LEADER_NAME_PX, minPx: LEADER_NAME_MIN_PX, weight: 700, wrap: true }));
    }
  }
  const opponents = new Map<string, TextFit>();
  for (const row of [...texts.away.view.rows, ...texts.home.view.rows]) {
    if (!opponents.has(row.opponent)) {
      opponents.set(row.opponent, fitText(row.opponent, measure, { widthPx: OPPONENT_WIDTH_PX, maxPx: OPPONENT_PX, minPx: OPPONENT_MIN_PX, weight: 600, wrap: false }));
    }
  }
  const advances = new Map<string, number>();
  for (const char of NUMBER_CHARS) advances.set(char, measure(char, 800, 100));
  // Tabular digits all take the widest one's room.
  const digit = Math.max(...[..."0123456789"].map((char) => advances.get(char) ?? 0));
  for (const char of "0123456789") advances.set(char, digit);
  return { names, opponents, away: sideFits(texts.away, measure), home: sideFits(texts.home, measure), advances };
}
