"use client";

import type { ExtractResponse } from "@/lib/rosters/types";
import { ImportPanel } from "./ImportPanel";

export type ImportResult = ExtractResponse;

function isRoster(body: unknown): body is ImportResult & { pages?: number } {
  return typeof body === "object" && body !== null && Array.isArray((body as { players?: unknown }).players);
}

/**
 * Import a roster from any of the four formats (docs/V3_DEFINITION.md 6.2),
 * folded to one dashed bar under the team's toolbar until it is opened or a
 * file is dropped on it. The result comes back through onImported for the
 * review table.
 */
export function RosterImport({
  onImported,
  open,
  onOpenChange,
  sport = null,
}: {
  onImported: (result: ImportResult) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** What the team already is. A volleyball team's import reads its season stats too (Jed, Oct 21). */
  sport?: string | null;
}) {
  return (
    <ImportPanel
      kind="roster"
      endpoint="/api/rosters/extract"
      // Sent only for volleyball, so every other sport's import is the request it always was.
      fields={sport === "volleyball" ? { sport } : undefined}
      title="Import a roster"
      noun="roster"
      pastePlaceholder="Copy the roster table from a website and paste it here."
      layout="bar"
      barHint={
        sport === "volleyball"
          ? "Drop a roster or stats PDF, CSV or photo here, or click to expand. Season stats are read with the players."
          : "Drop a roster PDF, CSV or photo here, or click to expand."
      }
      open={open}
      onOpenChange={onOpenChange}
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
