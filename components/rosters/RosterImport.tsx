"use client";

import type { ExtractResponse } from "@/lib/rosters/types";
import { ImportPanel } from "./ImportPanel";

export type ImportResult = ExtractResponse;

function isRoster(body: unknown): body is ImportResult & { pages?: number } {
  return typeof body === "object" && body !== null && Array.isArray((body as { players?: unknown }).players);
}

/**
 * Import a roster from any of the four formats (docs/V3_DEFINITION.md 6.2).
 * The result comes back through onImported for the review table.
 *
 * An account still waiting for approval sees this disabled with the note, and
 * can still type players in by hand below.
 */
export function RosterImport({ onImported }: { onImported: (result: ImportResult) => void }) {
  return (
    <ImportPanel
      kind="roster"
      endpoint="/api/rosters/extract"
      title="Import a roster"
      noun="roster"
      pastePlaceholder="Copy the roster table from a website and paste it here."
      isResult={isRoster}
      finishedProps={(body) => ({
        route: body.route,
        players_found: body.players.length,
        players_flagged: body.players.filter((player) => player.flags.length > 0).length,
        ...(body.pages ? { pages: body.pages } : {}),
      })}
      warningsOf={(body) => body.warnings}
      onResult={onImported}
    />
  );
}
