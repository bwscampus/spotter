// =============================================================================
// The live screen's team panel (docs/PANEL_SPEC.md): every size it is drawn
// at, and the one thing worked out from them, how many schedule rows fit a
// half. Pure, so the arithmetic is tested; the component reads these as
// inline styles (a size interpolated into a Tailwind class writes no CSS).
//
// The panel is a fixed column left of the stage, between the top bar and the
// bottom bar. Nothing in it scrolls, moves or resizes during a game, and
// nothing animates: values change in place.
// =============================================================================

// =============================================================================
// TUNING
// =============================================================================

/** The panel's width, its 1px line on the right included. */
export const PANEL_WIDTH_PX = 360;
/** The line between the panel and the stage. */
export const PANEL_LINE_PX = 1;

/** Each half's padding, top and bottom, then left and right. */
export const HALF_PAD_Y_PX = 14;
export const HALF_PAD_X_PX = 16;
/** Between the band, the schedule and the leaders. */
export const PART_GAP_PX = 10;

/** The band: the team's colour, AWAY or HOME over the school, the record over the league record. */
export const BAND_HEIGHT_PX = 60;
export const BAND_PAD_X_PX = 12;
export const BAND_GAP_PX = 12;
export const SIDE_LABEL_PX = 11;
export const SCHOOL_PX = 20;
/** The smallest the school's name steps down to before it wraps onto two lines. */
export const SCHOOL_MIN_PX = 12;
export const RECORD_PX = 28;
export const LEAGUE_PX = 12;

/** A section label ("SEASON", "TONIGHT"): 11px, weight 700, 0.08em, #555555, and the room under it. */
export const LABEL_PX = 11;
export const LABEL_ROW_PX = 18;

/** One played game. */
export const ROW_PX = 21;
export const ROW_GAP_PX = 4;
export const DATE_COL_PX = 50;
export const RESULT_COL_PX = 16;
export const SITE_COL_PX = 24;
export const SCORE_COL_PX = 52;
export const DATE_PX = 12;
export const RESULT_PX = 13;
export const SITE_PX = 12;
export const OPPONENT_PX = 14;
/** The smallest an opponent steps down to. Past that, and only then, it ends in an ellipsis with the full name in its title. */
export const OPPONENT_MIN_PX = 10;
export const SCORE_PX = 14;

/** The streak and next game line under the rows. */
export const STREAK_PX = 13;
export const STREAK_LINE_PX = 18;
export const STREAK_GAP_PX = 4;

/** The leaders: a 2×2 grid of 40px boxes, 12px between the columns. */
export const LEADER_BOX_PX = 40;
export const LEADER_ROW_GAP_PX = 4;
export const LEADER_COL_GAP_PX = 12;
export const LEADER_NUMBER_COL_PX = 58;
export const LEADER_INNER_GAP_PX = 8;
export const LEADER_NUMBER_PX = 26;
/** The smallest a big number steps down to, so a season's "2,431" still fits its 58px. */
export const LEADER_NUMBER_MIN_PX = 14;
export const LEADER_UNIT_PX = 10;
export const LEADER_CATEGORY_PX = 11;
/** The smallest the category line ("RUSH · 14 car, 1 TD") steps down to; past that it breaks after its comma. */
export const LEADER_CATEGORY_MIN_PX = 9;
/** The biggest it is on two lines, so two lines and the name still fit the 40px box. */
export const LEADER_CATEGORY_TWO_LINE_PX = 10;
export const LEADER_NAME_PX = 15;
/** The smallest a leader's name steps down to before it wraps (Jed, Oct 28: never cut off). */
export const LEADER_NAME_MIN_PX = 10;

/** Colours (docs/PANEL_SPEC.md). The live screen keeps its own look, outside the dashboard's tokens. */
export const PANEL_COLORS = {
  ink: "#111111",
  muted: "#5B636C",
  label: "#555555",
  line: "#EEF0F2",
  panelLine: "#D9DCE0",
  background: "#FFFFFF",
  win: "#145A2B",
  loss: "#B42318",
} as const;

// =============================================================================

/** The width inside a half's padding. */
export const HALF_INNER_PX = PANEL_WIDTH_PX - PANEL_LINE_PX - 2 * HALF_PAD_X_PX;

/** The leader section's height: its label and two rows of boxes. */
export const LEADERS_HEIGHT_PX = LABEL_ROW_PX + 2 * LEADER_BOX_PX + LEADER_ROW_GAP_PX;

/** How wide a leader's name may be: half the grid less the number column and the gap. */
export const LEADER_NAME_WIDTH_PX = Math.floor((HALF_INNER_PX - LEADER_COL_GAP_PX) / 2 - LEADER_NUMBER_COL_PX - LEADER_INNER_GAP_PX);

/** How wide an opponent may be: the row less its other columns and the gaps between them. */
export const OPPONENT_WIDTH_PX = HALF_INNER_PX - DATE_COL_PX - RESULT_COL_PX - SITE_COL_PX - SCORE_COL_PX - 4 * ROW_GAP_PX;

/** The band's width inside its padding. */
export const BAND_INNER_PX = HALF_INNER_PX - 2 * BAND_PAD_X_PX;

/**
 * How many played games fit a half of this height: everything else in the
 * half is a fixed size, so what is left over is rows. Worked out once, when
 * the panel's own box is laid out, never from what a row says.
 */
export function rowsThatFit(halfPx: number, { leaders }: { leaders: boolean }): number {
  const fixed =
    2 * HALF_PAD_Y_PX +
    BAND_HEIGHT_PX +
    PART_GAP_PX +
    LABEL_ROW_PX +
    STREAK_GAP_PX +
    STREAK_LINE_PX +
    (leaders ? PART_GAP_PX + LEADERS_HEIGHT_PX : 0);
  return Math.max(0, Math.floor((halfPx - fixed) / ROW_PX));
}
