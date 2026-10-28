import type { ReactNode } from "react";
import { PANEL_LINE_PX, PANEL_WIDTH_PX } from "@/lib/panel/layout";

/**
 * The live screen between its top and bottom bars (Oct 28): the team panel in
 * a fixed 360px column on the left, and the stage in the rest. The panel is
 * handed in already built (components/livestats/LiveGame.tsx), so the card
 * path never imports it.
 *
 * The cards do not change at all: the stage is the same element with the
 * same contents whether the panel shows or not, and only its width differs,
 * so its own ResizeObserver sets the base size as it always has. Hidden, the
 * panel stays mounted (its measurements and its subscription survive a
 * toggle) and takes no room, and the stage is full width exactly as before.
 *
 * The alert rows (the silence alarm and the warnings) sit over the stage, not
 * the panel, so an alarm coming up never resizes the panel mid-game.
 */
export function StageRow({ panel, panelOn, children }: { panel?: ReactNode; panelOn: boolean; children?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1">
      {panel && (
        <aside
          hidden={!panelOn}
          aria-label="Teams"
          data-testid="panel-column"
          style={{ width: PANEL_WIDTH_PX, flex: "none", borderRight: `${PANEL_LINE_PX}px solid #D9DCE0`, overflow: "hidden" }}
        >
          {panel}
        </aside>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="stage-column">
        {children}
      </div>
    </div>
  );
}
