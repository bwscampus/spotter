import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A warning (docs/UI_STYLE.md): 40px, an amber warning icon, one line of text cut
 * with an ellipsis (the whole of it in the title), then the fix at the right.
 */
export function WarningRow({ text, fix, className = "" }: { text: string; fix?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={`flex min-h-10 min-w-0 items-center gap-2 px-3 ${className}`.trim()}>
      <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-dot" />
      <span title={text} className="min-w-0 flex-1 truncate">
        {text}
      </span>
      {fix && <span className="shrink-0 text-[16px]">{fix}</span>}
    </div>
  );
}

/** An error: the warning row with a red alert icon and red text. */
export function ErrorRow({ text, fix, className = "" }: { text: string; fix?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={`flex min-h-10 min-w-0 items-center gap-2 px-3 text-red ${className}`.trim()}>
      <CircleAlert aria-hidden className="size-4 shrink-0 text-red" />
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

/** One muted line, and the next thing to do as a link. A picture (a mini card) only where the page puts one beside it. */
export function EmptyState({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`px-3 py-3 text-muted ${className}`.trim()}>{children}</p>;
}
