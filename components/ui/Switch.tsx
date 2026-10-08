/**
 * An on/off switch (docs/UI_STYLE.md): a 38 by 20 rectangle with a 14px square
 * knob, and the word beside it, because colour never carries meaning alone.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What it switches, for a screen reader. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex cursor-pointer items-center gap-2 disabled:cursor-not-allowed"
    >
      <span
        aria-hidden
        className={`relative inline-block h-5 w-[38px] rounded-[3px] border transition-colors duration-100 ${
          checked ? "border-green bg-green" : "border-line-strong bg-surface"
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] ${checked ? "right-[2px] bg-surface" : "left-[2px] bg-muted"}`}
        />
      </span>
      <span className={checked ? "font-semibold text-ink" : "text-muted"}>{checked ? "On" : "Off"}</span>
    </button>
  );
}
