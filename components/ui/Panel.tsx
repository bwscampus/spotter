import type { ReactNode } from "react";

/** A panel heading's style: 14px, 600, uppercase, 0.04em, ink-2. */
export const PANEL_HEADING = "text-[14px] font-semibold uppercase tracking-[0.04em] text-ink-2";

/**
 * A panel (docs/UI_STYLE.md): a 1px border, a 40px head with the heading left
 * and at most one link right, then the content.
 */
export function Panel({
  heading,
  link,
  children,
  className = "",
  bodyClassName = "",
}: {
  heading: ReactNode;
  link?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`min-w-0 rounded-[3px] border border-line bg-surface ${className}`.trim()}>
      <div className="flex h-10 items-center gap-2 border-b border-line bg-surface-2 px-3">
        <h2 className={PANEL_HEADING}>{heading}</h2>
        {link && <div className="ml-auto text-[14px]">{link}</div>}
      </div>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** A 40px label-and-value row inside a panel. */
export function PanelRow({ label, children, className = "" }: { label: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-10 items-center gap-2 border-b border-line px-3 last:border-b-0 ${className}`.trim()}>
      <span className="min-w-0 truncate text-ink-2">{label}</span>
      <span className="ml-auto flex items-center gap-2">{children}</span>
    </div>
  );
}
