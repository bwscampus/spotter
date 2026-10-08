import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

// Inputs and selects (docs/UI_STYLE.md): 30px, a real label, and an error as a
// red border plus one red line under it saying the cause and the fix.

export const INPUT =
  "h-[30px] rounded-[3px] border border-line-strong bg-surface px-2 text-[13px] text-ink placeholder:text-disabled disabled:cursor-not-allowed disabled:border-line disabled:text-disabled";

export const LABEL = "text-[12px] font-semibold text-ink-2";

export function Input({ className = "", invalid = false, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input className={`${INPUT} ${invalid ? "border-red" : ""} ${className}`.trim()} aria-invalid={invalid || undefined} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${INPUT} cursor-pointer pr-1 ${className}`.trim()} {...props} />;
}

/** The one red line under a field in error. */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1 text-[12px] text-red">
      {children}
    </p>
  );
}
