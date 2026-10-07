"use client";

import { useState } from "react";
import { downloadGameLog } from "@/lib/log/download";
import { clearGameLog, logWriter } from "@/lib/log/gameLog";

/** Said wherever the log can be downloaded. docs/V3_DEFINITION.md 9.3. */
export const LOG_STAYS_HERE = "This log stays in this browser. It only leaves if you download it.";

/**
 * This game's browser log: Download (a .json for the replay harness and a .csv
 * match log) and Clear (this game only). Outside the hot path entirely: it runs
 * on clicks, and reading IndexedDB is async.
 */
export function LogPanel({ gameId }: { gameId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setNote(null);
    const result = await downloadGameLog(gameId);
    setNote(
      result.ok
        ? `Downloaded ${result.records} records.`
        : result.reason === "empty"
          ? "Nothing in this game's log yet."
          : "Could not read the log in this browser.",
    );
    setBusy(false);
  };

  const clear = async () => {
    if (!window.confirm("Clear this game's log? Download it first if you need it.")) return;
    setBusy(true);
    try {
      await logWriter().flush();
      await clearGameLog(gameId);
      setNote("This game's log is cleared.");
    } catch {
      setNote("Could not clear the log in this browser.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex shrink-0 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Browser log</span>
      <div className="flex h-5 items-center gap-3 text-xs">
        <button
          type="button"
          aria-expanded={open}
          onClick={(event) => {
            event.currentTarget.blur();
            setOpen((was) => !was);
          }}
          className="cursor-pointer rounded border border-neutral-300 px-2 py-0.5 text-sm font-semibold text-neutral-800 hover:border-neutral-600"
        >
          Log
        </button>
        {open && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.currentTarget.blur();
                void download();
              }}
              className="cursor-pointer rounded border border-neutral-300 px-2 py-0.5 font-semibold text-neutral-800 hover:border-neutral-600 disabled:cursor-not-allowed disabled:text-neutral-400"
            >
              Download
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={(event) => {
                event.currentTarget.blur();
                void clear();
              }}
              className="cursor-pointer px-1 text-neutral-500 hover:text-neutral-700 disabled:cursor-not-allowed"
            >
              Clear
            </button>
          </>
        )}
      </div>
      <p className="h-4 max-w-96 truncate text-xs text-neutral-500" title={note ?? LOG_STAYS_HERE}>
        {open ? (note ?? LOG_STAYS_HERE) : " "}
      </p>
    </div>
  );
}
