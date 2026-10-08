import type { ReactNode } from "react";

/**
 * A warning (docs/UI_STYLE.md): 32px, a round amber dot, one line of text cut
 * with an ellipsis (the whole of it in the title), then the fix at the right.
 */
export function WarningRow({ text, fix, className = "" }: { text: string; fix?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={`flex min-h-8 min-w-0 items-center gap-2 px-3 ${className}`.trim()}>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-amber-dot" />
      <span title={text} className="min-w-0 flex-1 truncate">
        {text}
      </span>
      {fix && <span className="shrink-0 text-[13px]">{fix}</span>}
    </div>
  );
}

/** An error: the warning row with a square red dot and red text. */
export function ErrorRow({ text, fix, className = "" }: { text: string; fix?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={`flex min-h-8 min-w-0 items-center gap-2 px-3 text-red ${className}`.trim()}>
      <span aria-hidden className="h-2 w-2 shrink-0 bg-red" />
      <span title={text} className="min-w-0 flex-1 truncate">
        {text}
      </span>
      {fix && <span className="shrink-0">{fix}</span>}
    </div>
  );
}

/** A list of warning rows, each with a line under it. */
export function RowList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col divide-y divide-line ${className}`.trim()}>{children}</div>;
}

/** One muted line, and the next thing to do as a link. Never a picture. */
export function EmptyState({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`px-3 py-2 text-muted ${className}`.trim()}>{children}</p>;
}
