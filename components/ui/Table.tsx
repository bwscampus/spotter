import type { ReactNode, ThHTMLAttributes } from "react";

// =============================================================================
// Tables (docs/UI_STYLE.md): a 32px header, sticky while the page scrolls, with
// a strong rule under it; 32px rows with a line under each and a hover, no
// zebra. Text left, numbers right and mono.
//
// The box scrolls sideways under 1024px. At 1024 and up it does not clip, so
// the header can stick to the page; a table that is always wide (the stats
// review) passes `wide` and scrolls in its own box at every width.
// =============================================================================

export const TABLE = "w-full border-collapse text-left text-[13px]";
export const TH =
  "sticky top-0 z-10 h-8 whitespace-nowrap border-b border-line-strong bg-surface px-2 text-left align-middle text-[12px] font-semibold text-ink-2";
export const TH_NUM = `${TH} text-right`;
export const TR = "h-8 border-b border-line transition-colors duration-100 hover:bg-surface-2";
export const TD = "px-2 align-middle";
export const TD_NUM = "px-2 text-right align-middle font-num text-[12px]";

export function TableBox({ children, wide = false, className = "" }: { children: ReactNode; wide?: boolean; className?: string }) {
  return (
    <div className={`${wide ? "overflow-x-auto" : "max-lg:overflow-x-auto"} rounded-[3px] border border-line bg-surface ${className}`.trim()}>
      {children}
    </div>
  );
}

export type SortDirection = "asc" | "desc";

/**
 * A sortable column's header: a button with ↕ in the disabled colour, or ↑/↓ in
 * ink on the sorted column, which also says so through aria-sort.
 */
export function SortHeader({
  label,
  sorted,
  onSort,
  numeric = false,
  ...props
}: {
  label: string;
  sorted: SortDirection | null;
  onSort: () => void;
  numeric?: boolean;
} & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}
      className={numeric ? TH_NUM : TH}
      {...props}
    >
      <button type="button" onClick={onSort} className="inline-flex cursor-pointer items-center gap-1 font-semibold">
        {label}
        <span aria-hidden className={sorted ? "text-ink" : "text-disabled"}>
          {sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}
        </span>
      </button>
    </th>
  );
}
