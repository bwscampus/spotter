"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A button on the live screen's top bar that opens a panel below it (Jed,
 * Oct 3: every control lives in one thin row at the top, so the cards have
 * the screen). It closes on a second click, a click anywhere else, or Escape.
 * The button hands the keyboard back after every click, so X and 1 to 3 still
 * take a card down.
 */
export function BarMenu({
  label,
  title,
  warn = false,
  wide = false,
  children,
}: {
  label: ReactNode;
  /** What the button is called for a screen reader and on hover. */
  title: string;
  /** A small amber dot on the button: something inside needs a look. */
  warn?: boolean;
  /** How wide the panel may get. The stats panel needs more room than a few settings. */
  wide?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-label={title}
        title={title}
        onClick={(event) => {
          event.currentTarget.blur();
          setOpen((was) => !was);
        }}
        className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-neutral-300 bg-white/80 px-3 text-sm font-semibold text-neutral-800 hover:border-neutral-600"
      >
        {label}
        {warn && <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={title}
          className={`absolute right-0 top-full z-30 mt-2 flex flex-col gap-4 rounded-lg border border-neutral-300 bg-white p-4 shadow-xl ${
            wide ? "max-h-[75dvh] w-[min(60rem,calc(100vw-2rem))]" : "w-max max-w-[min(34rem,calc(100vw-2rem))]"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
