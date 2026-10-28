import type { CSSProperties } from "react";
import type { SideLook } from "@/lib/game/colors";
import { fitCategory, numberPx, unmeasured, type Advances, type PanelMeasure, type TextFit } from "@/lib/panel/fit";
import type { SideFits } from "@/lib/panel/fits";
import {
  BAND_GAP_PX,
  BAND_HEIGHT_PX,
  BAND_PAD_X_PX,
  DATE_COL_PX,
  DATE_PX,
  HALF_PAD_X_PX,
  HALF_PAD_Y_PX,
  LABEL_PX,
  LABEL_ROW_PX,
  LEADER_BOX_PX,
  LEADER_CATEGORY_MIN_PX,
  LEADER_CATEGORY_PX,
  LEADER_CATEGORY_TWO_LINE_PX,
  LEADER_COL_GAP_PX,
  LEADER_INNER_GAP_PX,
  LEADER_NAME_PX,
  LEADER_NAME_WIDTH_PX,
  LEADER_NUMBER_COL_PX,
  LEADER_NUMBER_MIN_PX,
  LEADER_NUMBER_PX,
  LEADER_ROW_GAP_PX,
  LEADER_UNIT_PX,
  LEADERS_HEIGHT_PX,
  LEAGUE_PX,
  OPPONENT_PX,
  PANEL_COLORS,
  PART_GAP_PX,
  RECORD_PX,
  RESULT_COL_PX,
  RESULT_PX,
  ROW_GAP_PX,
  ROW_PX,
  SCHOOL_PX,
  SCORE_COL_PX,
  SCORE_PX,
  SIDE_LABEL_PX,
  SITE_COL_PX,
  SITE_PX,
  STREAK_GAP_PX,
  STREAK_LINE_PX,
  STREAK_PX,
} from "@/lib/panel/layout";
import type { LeaderBox } from "@/lib/panel/leaders";
import { NO_SCHEDULE_TEXT, type ScheduleView } from "@/lib/panel/view";

// =============================================================================
// One team's half of the panel (docs/PANEL_SPEC.md): the band in the team's
// colour, the season's played games newest first with the streak and the next
// game, and the four leaders. Every size is an inline style from
// lib/panel/layout.ts, and every box is fixed: what is written in it never
// changes its size, and nothing moves or animates.
// =============================================================================

const RESULT_COLOR = { W: PANEL_COLORS.win, L: PANEL_COLORS.loss, T: PANEL_COLORS.ink } as const;

const label: CSSProperties = {
  fontSize: LABEL_PX,
  fontWeight: 700,
  letterSpacing: "0.08em",
  color: PANEL_COLORS.label,
  lineHeight: `${LABEL_PX + 3}px`,
  whiteSpace: "nowrap",
};

const oneLine: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

/** Fitted text: each line its own block, so the browser never wraps it differently from the fit. */
function Fitted({ fit, style }: { fit: TextFit; style?: CSSProperties }) {
  if (fit.overflow) {
    return (
      <span title={fit.lines[0]} style={{ ...style, ...oneLine, display: "block", fontSize: fit.px }}>
        {fit.lines[0]}
      </span>
    );
  }
  return (
    <span style={{ ...style, display: "block", fontSize: fit.px }}>
      {fit.lines.map((line, index) => (
        <span key={index} style={{ display: "block", whiteSpace: fit.lines.length > 1 ? "nowrap" : "normal", overflowWrap: "anywhere" }}>
          {line}
        </span>
      ))}
    </span>
  );
}

export interface TeamHalfProps {
  side: "away" | "home";
  school: string;
  look: SideLook;
  view: ScheduleView;
  /** How many played games fit, worked out from the half's fixed height. */
  rows: number;
  /** Null for a sport without these categories: the schedule takes the whole half. */
  leaders: LeaderBox[] | null;
  leadersLabel: string;
  fits: SideFits | null;
  names: ReadonlyMap<string, TextFit> | null;
  opponents: ReadonlyMap<string, TextFit> | null;
  advances: Advances | null;
  /** The panel font's measure once it has loaded, for the category lines, whose numbers change during the game. */
  measure: PanelMeasure | null;
}

/** The category line: 11px, stepped down when its numbers grow too wide for the box, and past that broken after its comma. */
function categoryFit(text: string, measure: PanelMeasure | null): TextFit {
  if (!measure) return unmeasured(text, LEADER_CATEGORY_PX);
  return fitCategory(text, measure, {
    widthPx: LEADER_NAME_WIDTH_PX,
    maxPx: LEADER_CATEGORY_PX,
    minPx: LEADER_CATEGORY_MIN_PX,
    twoLineMaxPx: LEADER_CATEGORY_TWO_LINE_PX,
  });
}

/** One category line: the category at 700, its numbers at 600. */
function CategoryLine({ leader, measure }: { leader: LeaderBox; measure: PanelMeasure | null }) {
  const fit = categoryFit(leader.support ? `${leader.category} · ${leader.support}` : leader.category, measure);
  return (
    <span style={{ display: "block", fontSize: fit.px, lineHeight: `${Math.round(fit.px * 1.15)}px` }}>
      {fit.lines.map((line, index) => (
        <span key={index} style={{ display: "block", whiteSpace: "nowrap", fontWeight: 600 }}>
          {index === 0 ? (
            <>
              <span style={{ fontWeight: 700 }}>{leader.category}</span>
              {line.slice(leader.category.length)}
            </>
          ) : (
            line
          )}
        </span>
      ))}
    </span>
  );
}

export function TeamHalf({ side, school, look, view, rows, leaders, leadersLabel, fits, names, opponents, advances, measure }: TeamHalfProps) {
  const shown = view.rows.slice(0, rows);
  return (
    <section
      data-half={side}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: PART_GAP_PX,
        padding: `${HALF_PAD_Y_PX}px ${HALF_PAD_X_PX}px`,
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* The band: the team's colour from the game's side look, ink by the slab rule, and away's hatching as on its slabs. */}
      <div
        data-part="band"
        style={{
          flex: "none",
          height: BAND_HEIGHT_PX,
          display: "flex",
          alignItems: "center",
          gap: BAND_GAP_PX,
          padding: `0 ${BAND_PAD_X_PX}px`,
          backgroundColor: look.background,
          backgroundImage: look.hatch || undefined,
          color: look.ink,
        }}
      >
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <span style={{ display: "block", fontSize: SIDE_LABEL_PX, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.85, lineHeight: `${SIDE_LABEL_PX + 3}px` }}>
            {side === "away" ? "AWAY" : "HOME"}
          </span>
          <Fitted fit={fits?.school ?? unmeasured(school, SCHOOL_PX)} style={{ fontWeight: 800, lineHeight: 1.1 }} />
        </div>
        <div style={{ flex: "none", textAlign: "right" }}>
          <span style={{ display: "block", fontSize: RECORD_PX, fontWeight: 800, lineHeight: 1 }}>{view.record}</span>
          <span style={{ display: "block", fontSize: LEAGUE_PX, fontWeight: 600, lineHeight: `${LEAGUE_PX + 3}px`, minHeight: LEAGUE_PX + 3 }}>{view.league}</span>
        </div>
      </div>

      {/* The season: played games newest first, as many as fit, then the streak and the next game. */}
      <div data-part="schedule" style={{ flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: "none", height: LABEL_ROW_PX, display: "flex", justifyContent: "space-between" }}>
          <span style={label}>SEASON</span>
          {view.hasSchedule && <span style={{ ...label, fontWeight: 600, letterSpacing: 0 }}>newest first</span>}
        </div>
        {view.hasSchedule ? (
          <>
            {shown.map((row) => (
              <div
                key={row.key}
                data-part="game"
                style={{
                  flex: "none",
                  height: ROW_PX,
                  borderTop: `1px solid ${PANEL_COLORS.line}`,
                  display: "grid",
                  gridTemplateColumns: `${DATE_COL_PX}px ${RESULT_COL_PX}px ${SITE_COL_PX}px minmax(0, 1fr) ${SCORE_COL_PX}px`,
                  columnGap: ROW_GAP_PX,
                  alignItems: "center",
                }}
              >
                <span style={{ fontSize: DATE_PX, color: PANEL_COLORS.muted, ...oneLine }}>{row.date}</span>
                <span style={{ fontSize: RESULT_PX, fontWeight: 800, color: RESULT_COLOR[row.result] }}>{row.result}</span>
                <span style={{ fontSize: SITE_PX, color: PANEL_COLORS.muted }}>{row.site}</span>
                <Fitted fit={opponents?.get(row.opponent) ?? { px: OPPONENT_PX, lines: [row.opponent], overflow: true }} style={{ fontWeight: 600, lineHeight: 1.1 }} />
                <span style={{ fontSize: SCORE_PX, fontWeight: 700, textAlign: "right" }}>{row.score}</span>
              </div>
            ))}
            {(view.streak || view.next) && (
              <p
                data-part="streak"
                title={view.next ? `${view.streak}${view.streak ? " · " : ""}Next: ${view.next}` : view.streak}
                style={{ flex: "none", marginTop: STREAK_GAP_PX, height: STREAK_LINE_PX, lineHeight: `${STREAK_LINE_PX}px`, fontSize: fits?.streak.px ?? STREAK_PX, ...oneLine }}
              >
                {view.streak && <span style={{ fontWeight: 700 }}>{view.streak}</span>}
                {view.next && (
                  <>
                    <span style={{ color: PANEL_COLORS.muted }}>{view.streak ? " · Next: " : "Next: "}</span>
                    <span>{view.next}</span>
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <p style={{ flex: "none", fontSize: STREAK_PX, lineHeight: `${STREAK_LINE_PX}px`, color: PANEL_COLORS.muted }}>{NO_SCHEDULE_TEXT}</p>
        )}
      </div>

      {/* The leaders: PASS and RUSH, then REC and TKL. Left out for a sport without them. */}
      {leaders && (
        <div data-part="leaders" style={{ flex: "none", height: LEADERS_HEIGHT_PX }}>
          <div style={{ height: LABEL_ROW_PX }}>
            <span style={label}>{leadersLabel}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", columnGap: LEADER_COL_GAP_PX, rowGap: LEADER_ROW_GAP_PX }}>
            {leaders.map((leader) => (
              <div
                key={leader.category}
                data-leader={leader.category}
                style={{
                  height: LEADER_BOX_PX,
                  borderTop: `1px solid ${PANEL_COLORS.line}`,
                  display: "grid",
                  gridTemplateColumns: `${LEADER_NUMBER_COL_PX}px minmax(0, 1fr)`,
                  columnGap: LEADER_INNER_GAP_PX,
                  alignItems: "center",
                }}
              >
                <div style={{ textAlign: "right" }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: numberPx(leader.number, advances, LEADER_NUMBER_COL_PX, LEADER_NUMBER_PX, LEADER_NUMBER_MIN_PX),
                      fontWeight: 800,
                      lineHeight: `${LEADER_NUMBER_PX}px`,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {leader.number}
                  </span>
                  <span style={{ display: "block", fontSize: LEADER_UNIT_PX, fontWeight: 700, letterSpacing: "0.06em", color: PANEL_COLORS.muted, lineHeight: `${LEADER_UNIT_PX + 2}px` }}>
                    {leader.unit}
                  </span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <CategoryLine leader={leader} measure={measure} />
                  {leader.name && (
                    <Fitted fit={names?.get(leader.name) ?? unmeasured(leader.name, LEADER_NAME_PX)} style={{ fontWeight: 700, lineHeight: 1.05 }} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
