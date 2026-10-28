"use client";

/**
 * The top bar's Panel switch (Oct 28, docs/PANEL_SPEC.md): shows or hides the
 * team panel left of the stage, as P does. It gives the keyboard back on a
 * click, like every other control in the bar, so Enter and Space are never
 * this button's after it is used.
 */
export function PanelSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title="The team panel: each team's season and tonight's leaders (P)"
      onClick={(event) => {
        event.currentTarget.blur();
        onChange(!on);
      }}
      className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-neutral-300 bg-white/80 px-3 text-sm font-semibold text-neutral-800 hover:border-neutral-600"
    >
      Panel
      <span className={`text-xs font-bold uppercase ${on ? "text-green-700" : "text-neutral-500"}`}>{on ? "On" : "Off"}</span>
    </button>
  );
}
