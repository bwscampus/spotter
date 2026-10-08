"use client";

import { useEffect } from "react";
import { Button } from "./Button";

/**
 * A confirm drawn in place of whatever asked for it (docs/UI_STYLE.md): the
 * question, the destructive button, and Cancel. Escape cancels. No modal.
 */
export function InlineConfirm({
  question,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
  note = null,
}: {
  question: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /** Why the last attempt failed, in red under the buttons. */
  note?: string | null;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label={question}>
      <span className="font-semibold text-red">{question}</span>
      <Button variant="destructive" disabled={busy} onClick={onConfirm}>
        {busy ? "Deleting..." : confirmLabel}
      </Button>
      <Button disabled={busy} autoFocus onClick={onCancel}>
        Cancel
      </Button>
      {note && (
        <span role="alert" className="basis-full text-[12px] text-red">
          {note}
        </span>
      )}
    </span>
  );
}
