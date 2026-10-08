import Link from "next/link";
import type { ReactNode } from "react";

// =============================================================================
// The toolbar (docs/UI_STYLE.md): directly under the header on every page. The
// page title, or a breadcrumb ending in it, on the left with anything that
// describes the page; the page's actions on the right, the primary last.
// =============================================================================

export interface Crumb {
  label: string;
  href: string;
}

export function Toolbar({
  title,
  crumbs = [],
  children,
  actions,
}: {
  title: ReactNode;
  /** The pages above this one, each a link: "Teams / School Mascot". */
  crumbs?: Crumb[];
  /** Beside the title: a count, a matchup, links. */
  children?: ReactNode;
  /** At the right, primary last. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-[46px] flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-4 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h1 className="flex min-w-0 flex-wrap items-baseline gap-1 text-[15px] font-semibold text-ink">
          {crumbs.map((crumb) => (
            <span key={crumb.href} className="flex items-baseline gap-1 font-normal text-ink-2">
              <Link href={crumb.href} className="text-accent hover:underline">
                {crumb.label}
              </Link>
              <span aria-hidden className="text-muted">
                /
              </span>
            </span>
          ))}
          <span className="min-w-0">{title}</span>
        </h1>
        {children}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Beside the title: 12px muted meta, "Football, Varsity, 2026". */
export function ToolbarMeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`text-[12px] text-muted ${className}`.trim()}>{children}</span>;
}

/** The page under the toolbar: white, 16px padding, columns stacked below 1024px. */
export function PageBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-4 p-4 ${className}`.trim()}>{children}</div>;
}
