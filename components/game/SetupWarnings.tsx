"use client";

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import type { SetupWarning } from "@/lib/game/setupWarnings";

/**
 * Setup's warnings (Nov 3, Jed: plain words). Each row is a short headline in
 * bold with its one fix at the right, and a small "Why?" under it that opens
 * the longer explanation. Built from lib/game/setupWarnings.ts, where the
 * words are tested. None of them stops a game from starting.
 */
export function SetupWarningList({
  warnings,
  onHide,
  hiding = null,
}: {
  warnings: SetupWarning[];
  /** Hides a player for this game only and loads the game again. Absent where there is nothing to reload. */
  onHide?: (playerId: string) => void;
  /** The player being hidden right now, while the game loads again. */
  hiding?: string | null;
}) {
  if (warnings.length === 0) return null;
  return (
    <ul className="rounded-[3px] border border-line" data-testid="setup-warnings">
      {warnings.map((warning) => (
        <WarningItem key={warning.key} warning={warning} onHide={onHide} hiding={hiding} />
      ))}
    </ul>
  );
}

function WarningItem({ warning, onHide, hiding }: { warning: SetupWarning; onHide?: (playerId: string) => void; hiding: string | null }) {
  const [open, setOpen] = useState(false);
  const whyId = `why-${warning.key}`;
  return (
    <li className="flex flex-col gap-1 border-b border-line px-3 py-2 last:border-b-0">
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-dot" />
        <span className="min-w-0 flex-1 font-semibold text-ink">{warning.headline}</span>
        {warning.fixes.length > 0 && (
          <span className="flex flex-wrap gap-2">
            {warning.fixes.map((fix) =>
              fix.kind === "link" ? (
                <ButtonLink key={fix.href} href={fix.href}>
                  {fix.label}
                </ButtonLink>
              ) : (
                onHide && (
                  <Button key={fix.playerId} disabled={hiding !== null} onClick={() => onHide(fix.playerId)}>
                    {hiding === fix.playerId ? "Hiding..." : fix.label}
                  </Button>
                )
              ),
            )}
          </span>
        )}
      </div>
      {warning.why && (
        <div className="flex flex-col gap-1 pl-5">
          <button
            type="button"
            className="w-fit cursor-pointer text-[14px] text-accent hover:underline"
            aria-expanded={open}
            aria-controls={whyId}
            onClick={() => setOpen(!open)}
          >
            Why?
          </button>
          <p id={whyId} hidden={!open} className="text-[14px] text-ink-2">
            {warning.why}
          </p>
        </div>
      )}
    </li>
  );
}
