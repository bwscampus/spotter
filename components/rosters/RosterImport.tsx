"use client";

import type { ExtractResponse } from "@/lib/rosters/types";
import { ImportPanel } from "./ImportPanel";

export type ImportResult = ExtractResponse;

function isRoster(body: unknown): body is ImportResult & { pages?: number } {
  return typeof body === "object" && body !== null && Array.isArray((body as { players?: unknown }).players);
}

/**
 * Import a roster from any of the four formats (docs/V3_DEFINITION.md 6.2):
 * the first of the team page's three boxes in a row (Oct 29, `layout="column"`),
 * or one dashed bar that opens when clicked or a file is dropped on it. The
 * result comes back through onImported for the review table.
 */
export function RosterImport({
  onImported,
  open,
  onOpenChange,
  layout = "bar",
  showConsent,
}: {
  onImported: (result: ImportResult) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** "column" is the team page's first of three boxes in a row (Oct 29). */
  layout?: "bar" | "column";
  showConsent?: boolean;
}) {
  return (
    <ImportPanel
      kind="roster"
      endpoint="/api/rosters/extract"
      title={layout === "column" ? "Roster" : "Import a roster"}
      noun="roster"
      pastePlaceholder="Copy the roster table from a website and paste it here."
      layout={layout}
      barHint="Drop a roster PDF, CSV or photo here, or click to expand."
      open={open}
      onOpenChange={onOpenChange}
      showConsent={showConsent}
      isResult={isRoster}
      finishedProps={(body) => ({
        route: body.route,
        players_found: body.players.length,
        players_flagged: body.players.filter((player) => player.flags.length > 0).length,
        ...(body.pages ? { pages: body.pages } : {}),
      })}
      warningsOf={(body) => body.warnings}
      onResult={(body) => onImported(body)}
    />
  );
}
